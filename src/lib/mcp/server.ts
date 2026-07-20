import "server-only";
import { z, ZodError } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { toJsonSafe } from "@/lib/serialize";
import type { AuditActor } from "@/lib/audit";
import type { TokenScope } from "@/lib/auth/api-token";
import { requireToolScope } from "@/lib/mcp/auth";
import { buildOverviewMarkdown } from "@/lib/mcp/overview";
import { extractRunId, loadSyncEngine } from "@/lib/mcp/engine";
import { searchAll } from "@/lib/services/search";
import { ragSearch } from "@/lib/rag/search";
import * as inventory from "@/lib/services/inventory";
import { createDoc, getDoc, listDocs, updateDoc } from "@/lib/services/docs";
import { listAiCredentials, readCredentialSecret } from "@/lib/services/ai-credentials";
import { assignTag, createTag } from "@/lib/services/tags";
import {
  createContainerSchema,
  createDeviceSchema,
  createNetworkSchema,
  createServiceSchema,
  createVmSchema,
  deviceKinds,
  listQuerySchema,
  updateFirewallRuleSchema,
  type ListQuery,
  type UpdateContainerInput,
  type UpdateDeviceInput,
  type UpdateNetworkInput,
  type UpdateServiceInput,
  type UpdateVmInput,
} from "@/lib/validators/inventory";
import { createDocSchema, tagSchema, updateDocSchema } from "@/lib/validators/docs";
import { validateGraph, blockingIssues } from "@/lib/workflows/engine";
import { actionCatalog } from "@/lib/workflows/registry";
import { createWorkflowSchema, workflowGraphSchema } from "@/lib/workflows/schemas";
import * as workflows from "@/lib/workflows/service";
import { executeWorkflow } from "@/lib/workflows/executor";
import type { EntityKind } from "@/lib/types";
import { lookupCensysHost } from "@/lib/services/censys";
import { lookupSecurityTrailsOperation } from "@/lib/services/securitytrails";

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(toJsonSafe(data), null, 2) }] };
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(err: unknown): CallToolResult {
  const payload =
    err instanceof ApiError
      ? { code: err.code, status: err.status, message: err.message }
      : err instanceof ZodError
        ? { code: "validation_error", status: 400, message: "Invalid tool arguments", issues: err.issues }
        : {
            code: "internal_error",
            status: 500,
            message: err instanceof Error ? err.message : String(err),
          };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: payload }, null, 2) }],
  };
}

/** Enforce the scope, run the handler, and shape JSON success/error output. */
async function run(
  scope: TokenScope,
  extra: ToolExtra,
  fn: (actor: AuditActor) => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const actor = requireToolScope(extra.authInfo, scope);
    return jsonResult(await fn(actor));
  } catch (err) {
    return errorResult(err);
  }
}

/** Like run(), but the handler builds the CallToolResult itself (markdown output). */
async function runRaw(
  scope: TokenScope,
  extra: ToolExtra,
  fn: (actor: AuditActor) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    const actor = requireToolScope(extra.authInfo, scope);
    return await fn(actor);
  } catch (err) {
    return errorResult(err);
  }
}

function toListQuery(args: { q?: string; page?: number; source?: string; status?: string }): ListQuery {
  // ListQuery defaults: page 1, pageSize 50.
  return listQuerySchema.parse({
    q: args.q,
    source: args.source,
    status: args.status,
    page: args.page ?? 1,
  });
}

// ---------------------------------------------------------------------------
// Shared input shapes
// ---------------------------------------------------------------------------

const ENTITY_KIND_VALUES = ["device", "vm", "container", "network", "service", "doc"] as const;
const CREATABLE_TYPES = ["device", "vm", "container", "network", "service"] as const;
type CreatableType = (typeof CREATABLE_TYPES)[number];

const pageInput = z.number().int().min(1).optional().describe("Page number (50 items per page, default 1)");
const qInput = z.string().max(255).optional().describe("Case-insensitive name filter");
const readOnly = { readOnlyHint: true } as const;

const INTEGRATION_STATUS_SELECT = {
  id: true,
  type: true,
  name: true,
  enabled: true,
  lastSyncAt: true,
  lastSyncStatus: true,
  lastSyncError: true,
} as const;

// ---------------------------------------------------------------------------
// Server assembly
// ---------------------------------------------------------------------------

export function registerPolySIEMServer(server: McpServer): void {
  // ----- read scope: overview -----

  server.registerResource(
    "overview",
    "polysiem://overview",
    {
      title: "Lab overview",
      description:
        "Markdown snapshot of the lab: instance name, entity counts, hosts with nested VMs/containers, networks, and integration health.",
      mimeType: "text/markdown",
    },
    async (uri, extra) => {
      requireToolScope(extra.authInfo, "read");
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: await buildOverviewMarkdown() }],
      };
    },
  );

  server.registerTool(
    "get_lab_overview",
    {
      title: "Get lab overview",
      description:
        "Returns a markdown snapshot of the whole lab: instance name, entity counts, hosts with their VMs/containers, networks (VLAN/CIDR/purpose), and integration health. Use this first to orient yourself.",
      annotations: readOnly,
    },
    async (extra) => runRaw("read", extra, async () => textResult(await buildOverviewMarkdown())),
  );

  server.registerTool(
    "censys_lookup_host",
    {
      title: "Look up a public host in Censys",
      description:
        "Returns internet-facing services, DNS names, owner/ASN, network, and location for a public IP. PolySIEM shares a four-day cache across MCP, AI, and workflows; only live cache misses count against the admin's rolling 24-hour AI/MCP limit.",
      inputSchema: {
        ip: z.string().min(1).describe("Public IPv4 or IPv6 address"),
        integrationId: z.string().min(1).optional().describe("Optional Censys integration id"),
      },
      annotations: readOnly,
    },
    async (args, extra) => run("read", extra, () => lookupCensysHost(args.ip, {
      source: "mcp",
      integrationId: args.integrationId,
    })),
  );

  server.registerTool(
    "securitytrails_lookup",
    {
      title: "Research a domain or IP in SecurityTrails",
      description:
        "Returns one bounded SecurityTrails dataset: current domain details, subdomains, domain WHOIS, or public-IP WHOIS. PolySIEM shares a four-day cache across MCP, AI, and workflows; only live AI/MCP cache misses count against the admin's rolling 24-hour SecurityTrails limit.",
      inputSchema: {
        kind: z
          .enum(["domain", "subdomains", "domain_whois", "ip_whois"])
          .describe("SecurityTrails dataset to query"),
        query: z
          .string()
          .trim()
          .min(1)
          .describe("Domain name for domain datasets, or a public IPv4 address for IP WHOIS"),
        integrationId: z
          .string()
          .min(1)
          .optional()
          .describe("Optional SecurityTrails integration id"),
      },
      annotations: readOnly,
    },
    async (args, extra) =>
      run("read", extra, () =>
        lookupSecurityTrailsOperation(args.kind, args.query, {
          source: "mcp",
          integrationId: args.integrationId,
        }),
      ),
  );

  // ----- read scope: search & inventory -----

  server.registerTool(
    "search_inventory",
    {
      title: "Search inventory",
      description:
        "Cross-entity name/title search over devices, VMs, containers, networks, services, and docs. Returns up to 8 matches per kind with ids and dashboard links. Use when you don't know an entity's id.",
      inputSchema: {
        query: z.string().min(1).max(255).describe("Search text (name/title substring)"),
        kinds: z
          .array(z.enum(ENTITY_KIND_VALUES))
          .optional()
          .describe("Restrict to these entity kinds (default: all)"),
      },
      annotations: readOnly,
    },
    async (args, extra) =>
      run("read", extra, () => searchAll(args.query, args.kinds as EntityKind[] | undefined)),
  );

  server.registerTool(
    "rag_search",
    {
      title: "RAG search",
      description:
        "Semantic vector search (RAG) over the lab's knowledge base — documentation pages plus synced inventory entities (devices, VMs, containers, networks, services). Embeds your query and returns the most similar text chunks with a cosine score, source, snippet, and dashboard link. Prefer this over search_inventory for open-ended 'what/why/how' questions where a literal name match won't do (e.g. \"what is dixie\", \"which network is the LocalServers VLAN\").",
      inputSchema: {
        query: z.string().min(1).max(1000).describe("Natural-language question or search text"),
        limit: z.number().int().min(1).max(20).optional().describe("Max results to return (default 8)"),
        sourceTypes: z
          .array(z.enum(["doc", "device", "vm", "container", "network", "service"]))
          .optional()
          .describe("Restrict to these source types (default: all)"),
      },
      annotations: readOnly,
    },
    async (args, extra) =>
      run("read", extra, () => ragSearch(args.query, { limit: args.limit, sourceTypes: args.sourceTypes })),
  );

  server.registerTool(
    "list_devices",
    {
      title: "List devices",
      description:
        "Paginated list of physical devices/hosts (servers, hypervisors, firewalls, switches, NAS). Returns items with tags and VM/container/service counts, plus a total.",
      inputSchema: {
        kind: z.enum(deviceKinds).optional().describe("Filter by device kind"),
        source: z.enum(["MANUAL", "PROXMOX", "OPNSENSE", "UNIFI", "CLOUDFLARE", "TAILSCALE", "EDGE_NAT_SERVER"]).optional().describe("Filter by record source"),
        status: z.enum(["ACTIVE", "STALE", "REMOVED"]).optional().describe("Filter by lifecycle status (default: not REMOVED)"),
        q: qInput,
        page: pageInput,
      },
      annotations: readOnly,
    },
    async (args, extra) => run("read", extra, () => inventory.listDevices(toListQuery(args), args.kind)),
  );

  server.registerTool(
    "get_device",
    {
      title: "Get device",
      description:
        "Full detail for one device by id: VMs, containers, network interfaces with IPs, services, storage pools, tags, and owning integration.",
      inputSchema: { id: z.string().min(1).describe("Device id") },
      annotations: readOnly,
    },
    async (args, extra) => run("read", extra, () => inventory.getDevice(args.id)),
  );

  server.registerTool(
    "list_ssh_keys",
    {
      title: "List SSH keys",
      description:
        "Documented SSH public keys with fingerprints and where each is authorized (machine, account, install method). Public keys only — PolySIEM never stores private key material.",
      annotations: readOnly,
    },
    async (extra) =>
      run("read", extra, async () => {
        const keys = await prisma.sshKey.findMany({
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            keyType: true,
            bits: true,
            fingerprint: true,
            publicKey: true,
            comment: true,
            ownerLabel: true,
            purpose: true,
            createdAt: true,
            deployments: {
              select: {
                entityType: true,
                username: true,
                method: true,
                notes: true,
                hostLabel: true,
                device: { select: { id: true, name: true } },
                vm: { select: { id: true, name: true } },
                container: { select: { id: true, name: true } },
              },
            },
          },
        });
        return { keys, total: keys.length };
      }),
  );

  server.registerTool(
    "list_vms",
    {
      title: "List virtual machines",
      description: "Paginated list of virtual machines with host reference and tags, plus a total.",
      inputSchema: {
        hostId: z.string().min(1).optional().describe("Filter to VMs on this device id"),
        q: qInput,
        page: pageInput,
      },
      annotations: readOnly,
    },
    async (args, extra) => run("read", extra, () => inventory.listVms(toListQuery(args), args.hostId)),
  );

  server.registerTool(
    "get_vm",
    {
      title: "Get virtual machine",
      description:
        "Full detail for one VM by id: host, nested containers, interfaces with IPs, services, tags, and owning integration.",
      inputSchema: { id: z.string().min(1).describe("VM id") },
      annotations: readOnly,
    },
    async (args, extra) => run("read", extra, () => inventory.getVm(args.id)),
  );

  server.registerTool(
    "list_containers",
    {
      title: "List containers",
      description:
        "Paginated list of containers (LXC/Docker/Podman) with host/VM references and tags, plus a total.",
      inputSchema: {
        hostId: z.string().min(1).optional().describe("Filter to containers on this device id"),
        q: qInput,
        page: pageInput,
      },
      annotations: readOnly,
    },
    async (args, extra) => run("read", extra, () => inventory.listContainers(toListQuery(args), args.hostId)),
  );

  server.registerTool(
    "get_container",
    {
      title: "Get container",
      description:
        "Full detail for one container by id: host, parent VM, interfaces with IPs, services, tags, and owning integration.",
      inputSchema: { id: z.string().min(1).describe("Container id") },
      annotations: readOnly,
    },
    async (args, extra) => run("read", extra, () => inventory.getContainer(args.id)),
  );

  server.registerTool(
    "list_networks",
    {
      title: "List networks",
      description:
        "Paginated list of networks/VLANs with tags and counts of IPs, interfaces, and DHCP leases, plus a total.",
      inputSchema: { q: qInput, page: pageInput },
      annotations: readOnly,
    },
    async (args, extra) => run("read", extra, () => inventory.listNetworks(toListQuery(args))),
  );

  server.registerTool(
    "get_network",
    {
      title: "Get network",
      description:
        "Full detail for one network by id: IP addresses, attached interfaces (with owning device/VM/container), DHCP leases, tags, and owning integration.",
      inputSchema: { id: z.string().min(1).describe("Network id") },
      annotations: readOnly,
    },
    async (args, extra) => run("read", extra, () => inventory.getNetwork(args.id)),
  );

  server.registerTool(
    "list_services",
    {
      title: "List services",
      description:
        "Paginated list of services (apps/endpoints) with their host device/VM/container references and tags, plus a total.",
      inputSchema: { q: qInput, page: pageInput },
      annotations: readOnly,
    },
    async (args, extra) => run("read", extra, () => inventory.listServices(toListQuery(args))),
  );

  server.registerTool(
    "list_storage_pools",
    {
      title: "List storage pools",
      description:
        "Paginated list of storage pools (zfs/lvm/dir/nfs/cifs) with capacity figures and owning device, plus a total.",
      inputSchema: { q: qInput, page: pageInput },
      annotations: readOnly,
    },
    async (args, extra) => run("read", extra, () => inventory.listStoragePools(toListQuery(args))),
  );

  server.registerTool(
    "get_firewall_rules",
    {
      title: "Get firewall rules",
      description:
        "OPNsense firewall rules (optionally filtered by interface or action) plus the full firewall alias list for resolving source/destination specs. Read-only; only the PolySIEM annotation field is ever writable.",
      inputSchema: {
        interface: z.string().max(64).optional().describe("Filter by interface name (e.g. lan, wan)"),
        action: z.enum(["PASS", "BLOCK", "REJECT"]).optional().describe("Filter by rule action"),
      },
      annotations: readOnly,
    },
    async (args, extra) =>
      run("read", extra, async () => {
        const [rules, aliases] = await Promise.all([
          inventory.listFirewallRules({ interfaceName: args.interface, action: args.action }),
          inventory.listFirewallAliases(),
        ]);
        return { rules, aliases };
      }),
  );

  server.registerTool(
    "get_dhcp_leases",
    {
      title: "Get DHCP leases",
      description:
        "DHCP leases synced from OPNsense (IP, MAC, hostname, static flag), optionally filtered to one network.",
      inputSchema: {
        networkId: z.string().min(1).optional().describe("Filter to leases on this network id"),
      },
      annotations: readOnly,
    },
    async (args, extra) => run("read", extra, () => inventory.listDhcpLeases(args.networkId)),
  );

  // ----- read scope: docs / integrations -----

  server.registerTool(
    "list_docs",
    {
      title: "List documentation pages",
      description:
        "All documentation pages (id, title, slug, parentId, author, tags, updatedAt) sorted by title. Content is not included; fetch a page with get_doc.",
      annotations: readOnly,
    },
    async (extra) => run("read", extra, () => listDocs()),
  );

  server.registerTool(
    "get_doc",
    {
      title: "Get documentation page",
      description:
        "One documentation page by slug or id, including markdown content, parent, children, author, and tags.",
      inputSchema: { slugOrId: z.string().min(1).describe("Page slug or id") },
      annotations: readOnly,
    },
    async (args, extra) => run("read", extra, () => getDoc(args.slugOrId)),
  );

  server.registerTool(
    "get_integration_status",
    {
      title: "Get integration status",
      description:
        "Health of configured integrations (Proxmox/OPNsense/Elasticsearch): enabled flag, last sync time, last sync status, and last error. Never exposes credentials.",
      annotations: readOnly,
    },
    async (extra) =>
      run("read", extra, () =>
        prisma.integrationConfig.findMany({ orderBy: { name: "asc" }, select: INTEGRATION_STATUS_SELECT }),
      ),
  );

  server.registerTool(
    "get_sync_run",
    {
      title: "Get sync run",
      description:
        "One sync run by id: status (RUNNING/SUCCESS/PARTIAL/FAILED), trigger, timing, per-entity stats, and error. Use after trigger_sync to check progress.",
      inputSchema: { runId: z.string().min(1).describe("SyncRun id") },
      annotations: readOnly,
    },
    async (args, extra) =>
      run("read", extra, async () => {
        const runRecord = await prisma.syncRun.findUnique({
          where: { id: args.runId },
          include: { integration: { select: { id: true, name: true, type: true } } },
        });
        if (!runRecord) throw new ApiError(404, "not_found", "Sync run not found");
        return runRecord;
      }),
  );

  // ----- write_docs scope -----

  server.registerTool(
    "create_doc",
    {
      title: "Create documentation page",
      description:
        "Create a markdown documentation page (createdVia: mcp). Slug is derived from the title. Returns the created page including its slug and id.",
      inputSchema: {
        title: z.string().min(1).max(255).describe("Page title"),
        content: z.string().max(500_000).describe("Markdown content"),
        parentId: z.string().min(1).optional().describe("Parent page id to nest under"),
      },
    },
    async (args, extra) =>
      run("write_docs", extra, (actor) =>
        createDoc(actor, createDocSchema.parse({ title: args.title, content: args.content, parentId: args.parentId }), {
          authorId: actor.userId,
          createdVia: "mcp",
        }),
      ),
  );

  server.registerTool(
    "update_doc",
    {
      title: "Update documentation page",
      description:
        "Update the title and/or content of an existing documentation page addressed by slug or id. Returns the updated page.",
      inputSchema: {
        slugOrId: z.string().min(1).describe("Page slug or id"),
        title: z.string().min(1).max(255).optional().describe("New title"),
        content: z.string().max(500_000).optional().describe("New markdown content (replaces existing)"),
      },
    },
    async (args, extra) =>
      run("write_docs", extra, (actor) => {
        if (args.title === undefined && args.content === undefined) {
          throw new ApiError(400, "no_fields", "Provide title and/or content to update");
        }
        return updateDoc(actor, args.slugOrId, updateDocSchema.parse({ title: args.title, content: args.content }));
      }),
  );

  server.registerTool(
    "create_entity",
    {
      title: "Create inventory entity",
      description:
        "Create a MANUAL inventory entity. type selects the entity; fields is the entity payload validated against the matching schema. " +
        "device: {name, kind?, description?, manufacturer?, model?, location?, cpuModel?, cpuCores?, memoryBytes?, osName?, osVersion?}. " +
        "vm: {name, description?, hostId?, powerState?, cpuCores?, memoryBytes?, diskBytes?, osName?}. " +
        "container: {name, runtime?, description?, hostId?, vmId?, powerState?, cpuCores?, memoryBytes?, diskBytes?, osName?}. " +
        "network: {name, description?, vlanId?, cidr?, gateway?, domain?, purpose?}. " +
        "service: {name, description?, url?, port?, protocol?, deviceId?, vmId?, containerId?}.",
      inputSchema: {
        type: z.enum(CREATABLE_TYPES).describe("Entity type to create"),
        fields: z.record(z.string(), z.unknown()).describe("Entity fields (see description for the shape per type)"),
      },
    },
    async (args, extra) =>
      run("write_docs", extra, (actor) => {
        const type = args.type as CreatableType;
        switch (type) {
          case "device":
            return inventory.createDevice(actor, createDeviceSchema.parse(args.fields));
          case "vm":
            return inventory.createVm(actor, createVmSchema.parse(args.fields));
          case "container":
            return inventory.createContainer(actor, createContainerSchema.parse(args.fields));
          case "network":
            return inventory.createNetwork(actor, createNetworkSchema.parse(args.fields));
          case "service":
            return inventory.createService(actor, createServiceSchema.parse(args.fields));
        }
      }),
  );

  const DOC_FIELDS_BY_TYPE: Record<CreatableType, ReadonlyArray<"description" | "location" | "purpose">> = {
    device: ["description", "location"],
    vm: ["description"],
    container: ["description"],
    network: ["description", "purpose"],
    service: ["description"],
  };

  server.registerTool(
    "update_entity_docs",
    {
      title: "Update entity documentation fields",
      description:
        "Update the human documentation fields of an inventory entity. These fields survive integration syncs. " +
        "Supported per type — device: description, location; network: description, purpose; vm/container/service: description. " +
        "Integration-owned fields cannot be edited; the service rejects them.",
      inputSchema: {
        type: z.enum(CREATABLE_TYPES).describe("Entity type"),
        id: z.string().min(1).describe("Entity id"),
        description: z.string().max(50_000).nullable().optional().describe("Free-text description (null clears)"),
        location: z.string().max(255).nullable().optional().describe("Physical location (devices only)"),
        purpose: z.string().max(64).nullable().optional().describe("Network purpose label (networks only)"),
      },
    },
    async (args, extra) =>
      run("write_docs", extra, (actor) => {
        const type = args.type as CreatableType;
        const allowed = DOC_FIELDS_BY_TYPE[type];
        const provided = (["description", "location", "purpose"] as const).filter(
          (k) => args[k] !== undefined,
        );
        if (provided.length === 0) {
          throw new ApiError(400, "no_fields", "Provide at least one of: description, location, purpose");
        }
        const illegal = provided.filter((k) => !allowed.includes(k));
        if (illegal.length > 0) {
          throw new ApiError(
            400,
            "invalid_field",
            `Field(s) ${illegal.join(", ")} are not supported for ${type}. Supported: ${allowed.join(", ")}.`,
          );
        }
        // args are already validated against this tool's inputSchema; do NOT
        // re-parse through the partial'd create schemas — in zod v4 their
        // .default() fields (e.g. device.kind) would be re-applied and clobber
        // unrelated columns.
        const input = Object.fromEntries(provided.map((k) => [k, args[k]]));
        switch (type) {
          case "device":
            return inventory.updateDevice(actor, args.id, input as UpdateDeviceInput);
          case "vm":
            return inventory.updateVm(actor, args.id, input as UpdateVmInput);
          case "container":
            return inventory.updateContainer(actor, args.id, input as UpdateContainerInput);
          case "network":
            return inventory.updateNetwork(actor, args.id, input as UpdateNetworkInput);
          case "service":
            return inventory.updateService(actor, args.id, input as UpdateServiceInput);
        }
      }),
  );

  server.registerTool(
    "set_firewall_annotation",
    {
      title: "Set firewall rule annotation",
      description:
        "Set the PolySIEM-owned operator note on a firewall rule (the only writable firewall field; it survives OPNsense syncs). Pass null to clear. Never changes the rule itself.",
      inputSchema: {
        ruleId: z.string().min(1).describe("Firewall rule id"),
        annotation: z.string().max(10_000).nullable().describe("Operator note (null clears)"),
      },
    },
    async (args, extra) =>
      run("write_docs", extra, (actor) =>
        inventory.updateFirewallRuleAnnotation(
          actor,
          args.ruleId,
          updateFirewallRuleSchema.parse({ annotation: args.annotation }),
        ),
      ),
  );

  server.registerTool(
    "add_tag",
    {
      title: "Add tag to entity",
      description:
        "Assign a tag to an entity (device/vm/container/network/service/doc). The tag is created if it does not exist (get-or-create by name). Idempotent per entity.",
      inputSchema: {
        entityType: z.enum(ENTITY_KIND_VALUES).describe("Entity type"),
        entityId: z.string().min(1).describe("Entity id"),
        tagName: z.string().min(1).max(48).describe("Tag name (created if missing)"),
      },
    },
    async (args, extra) =>
      run("write_docs", extra, async (actor) => {
        const tag = await createTag(actor, tagSchema.parse({ name: args.tagName }));
        return assignTag(actor, {
          tagId: tag.id,
          entityType: args.entityType as EntityKind,
          entityId: args.entityId,
        });
      }),
  );

  // ----- trigger_sync scope -----

  server.registerTool(
    "trigger_sync",
    {
      title: "Trigger integration sync",
      description:
        "Trigger a read-only inventory sync from remote systems into PolySIEM. Live-query integrations such as Elasticsearch, OTX, Censys, and SecurityTrails have no sync run.",
      inputSchema: {
        integrationId: z.string().min(1).optional().describe("Integration id (omit to sync all enabled)"),
      },
    },
    async (args, extra) =>
      run("trigger_sync", extra, async () => {
        const engine = await loadSyncEngine();
        let targets: { id: string; name: string; type: string }[];
        if (args.integrationId) {
          const integ = await prisma.integrationConfig.findUnique({
            where: { id: args.integrationId },
            select: { id: true, name: true, type: true },
          });
          if (!integ) throw new ApiError(404, "not_found", "Integration not found");
          if (
            ["ELASTICSEARCH", "OTX", "CENSYS", "SECURITYTRAILS"].includes(
              integ.type,
            )
          ) {
            throw new ApiError(400, "not_syncable", `${integ.type} integrations are queried live and have no sync`);
          }
          targets = [integ];
        } else {
          targets = await prisma.integrationConfig.findMany({
            where: {
              enabled: true,
              type: {
                notIn: ["ELASTICSEARCH", "OTX", "CENSYS", "SECURITYTRAILS"],
              },
            },
            select: { id: true, name: true, type: true },
          });
        }
        const runs = [];
        for (const target of targets) {
          const result = await engine.runSync(target.id, "mcp");
          runs.push({
            integrationId: target.id,
            integration: target.name,
            type: target.type,
            runId: extractRunId(result),
          });
        }
        return { triggered: runs.length, runs };
      }),
  );

  // ----- workflows -----

  const workflowGraphInput = workflowGraphSchema.describe(
    "Workflow graph: { nodes: [{id, kind, label, position:{x,y}, config}], edges: [{id, source, target, branch}] }. " +
      "Exactly one trigger.manual node; condition outgoing edges carry branch \"true\"/\"false\" (null otherwise). " +
      "String config values may use {{input.<paramKey>}} and {{nodes.<nodeId>.<outputKey>}} template refs.",
  );

  /** Validate a graph and reject (422) when it has blocking issues; returns all issues (warnings included). */
  function assertValidGraph(graph: z.infer<typeof workflowGraphSchema>) {
    const issues = validateGraph(graph, actionCatalog());
    const blocking = blockingIssues(issues);
    if (blocking.length > 0) {
      throw new ApiError(
        422,
        "invalid_graph",
        `Workflow graph failed validation: ${blocking
          .map((i) => (i.nodeId ? `[${i.nodeId}] ${i.message}` : i.message))
          .join("; ")}`,
      );
    }
    return issues;
  }

  server.registerTool(
    "list_workflows",
    {
      title: "List workflows",
      description:
        "All automation workflows with id, name, description, enabled flag, node/edge counts, and last run status. Fetch a full graph with get_workflow.",
      annotations: readOnly,
    },
    async (extra) =>
      run("read", extra, async () => {
        const items = await workflows.listWorkflows();
        return items.map(({ graph, ...rest }) => ({
          ...rest,
          nodeCount: graph.nodes.length,
          edgeCount: graph.edges.length,
        }));
      }),
  );

  server.registerTool(
    "get_workflow",
    {
      title: "Get workflow",
      description:
        "One workflow by id including its full graph (nodes with kind/config/position, edges with branches) and last run status.",
      inputSchema: { id: z.string().min(1).describe("Workflow id") },
      annotations: readOnly,
    },
    async (args, extra) => run("read", extra, () => workflows.getWorkflow(args.id)),
  );

  server.registerTool(
    "get_workflow_catalog",
    {
      title: "Get workflow node catalog",
      description:
        "Every node type a workflow graph can use: kind, title, description, category, config field specs (key/type/required/templateable/options), and output specs (secret outputs are redacted from stored runs). Read this before authoring or editing a graph.",
      annotations: readOnly,
    },
    async (extra) => run("read", extra, async () => actionCatalog()),
  );

  server.registerTool(
    "create_workflow",
    {
      title: "Create workflow",
      description:
        "Create an automation workflow from a graph. The graph is validated against the node catalog first — blocking issues reject the call; the response includes any non-blocking warnings. Use get_workflow_catalog for the available node kinds and their config fields.",
      inputSchema: {
        name: z.string().min(1).max(128).describe("Workflow name"),
        description: z.string().max(10_000).optional().describe("What the workflow does"),
        graph: workflowGraphInput,
      },
    },
    async (args, extra) =>
      run("write_docs", extra, async (actor) => {
        const input = createWorkflowSchema.parse({
          name: args.name,
          description: args.description,
          graph: args.graph,
        });
        const issues = assertValidGraph(input.graph);
        const workflow = await workflows.createWorkflow(actor, input);
        return { workflow, issues };
      }),
  );

  server.registerTool(
    "update_workflow",
    {
      title: "Update workflow",
      description:
        "Update a workflow's name, description, enabled flag, and/or graph. A provided graph is validated first — blocking issues reject the call; the response includes any non-blocking warnings.",
      inputSchema: {
        id: z.string().min(1).describe("Workflow id"),
        name: z.string().min(1).max(128).optional().describe("New name"),
        description: z.string().max(10_000).nullable().optional().describe("New description (null clears)"),
        enabled: z.boolean().optional().describe("Enable/disable running"),
        graph: workflowGraphInput.optional(),
      },
    },
    async (args, extra) =>
      run("write_docs", extra, async (actor) => {
        if (
          args.name === undefined &&
          args.description === undefined &&
          args.enabled === undefined &&
          args.graph === undefined
        ) {
          throw new ApiError(400, "no_fields", "Provide at least one of: name, description, enabled, graph");
        }
        const graph = args.graph === undefined ? undefined : workflowGraphSchema.parse(args.graph);
        const issues = graph === undefined ? [] : assertValidGraph(graph);
        // Build the patch directly from provided args (no partial() re-parse —
        // zod v4 would re-apply defaults for absent keys).
        const workflow = await workflows.updateWorkflow(actor, args.id, {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
          ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
          ...(graph !== undefined ? { graph } : {}),
        });
        return { workflow, issues };
      }),
  );

  server.registerTool(
    "validate_workflow",
    {
      title: "Validate workflow",
      description:
        "Validate a stored workflow's graph against the node catalog. Returns every issue found; issues whose message starts with \"Warning: \" (e.g. unknown template refs) do not block execution.",
      inputSchema: { id: z.string().min(1).describe("Workflow id") },
      annotations: readOnly,
    },
    async (args, extra) => run("read", extra, () => workflows.validateWorkflowGraph(args.id)),
  );

  server.registerTool(
    "run_workflow",
    {
      title: "Run workflow",
      description:
        "Execute a workflow synchronously with the given trigger input (keys = the trigger.manual params). Returns the run with per-step status, outputs, and errors. Secret outputs (e.g. generated private keys) are ALWAYS redacted in this response — they are only available once, via the web UI run dialog.",
      inputSchema: {
        id: z.string().min(1).describe("Workflow id"),
        input: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Trigger input values keyed by param key (see the workflow's trigger.manual params)"),
      },
    },
    async (args, extra) =>
      run("trigger_sync", extra, async (actor) => {
        // Deliberately drop result.secrets: MCP clients never receive secret outputs.
        const result = await executeWorkflow(actor, args.id, args.input ?? {});
        return result.run;
      }),
  );

  // ----- credentials scope: AI credential store -----

  server.registerTool(
    "list_ai_credentials",
    {
      title: "List AI credentials",
      description:
        "Credentials the PolySIEM admin has explicitly shared with AI assistants: name, description, username, and URL — never the secret. Use this to discover what is available, then fetch one secret on demand with get_ai_credential.",
      annotations: readOnly,
    },
    async (extra) =>
      run("credentials", extra, async () => {
        const items = await listAiCredentials();
        return {
          credentials: items.map(({ name, description, username, url, updatedAt }) => ({
            name,
            description,
            username,
            url,
            updatedAt,
          })),
          total: items.length,
        };
      }),
  );

  server.registerTool(
    "get_ai_credential",
    {
      title: "Get AI credential",
      description:
        "Fetch ONE credential by name, including its decrypted secret. Every call is audit-logged. Fetch a secret on demand right before you need it and NEVER persist it — do not write it to files, documentation, code, chat summaries, or memory of any kind.",
      inputSchema: {
        name: z.string().min(1).max(64).describe("Credential name (see list_ai_credentials)"),
      },
    },
    async (args, extra) => run("credentials", extra, (actor) => readCredentialSecret(args.name, actor)),
  );
}
