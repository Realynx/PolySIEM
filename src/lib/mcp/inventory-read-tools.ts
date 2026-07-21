import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/db";
import { runTool as run } from "@/lib/mcp/tool-results";
import { searchAll } from "@/lib/services/search";
import { ragSearch } from "@/lib/rag/search";
import * as inventory from "@/lib/services/inventory";
import { deviceKinds, listQuerySchema, type ListQuery } from "@/lib/validators/inventory";
import type { EntityKind } from "@/lib/types";

const ENTITY_KIND_VALUES = ["device", "vm", "container", "network", "service", "doc"] as const;
const pageInput = z.number().int().min(1).optional().describe("Page number (50 items per page, default 1)");
const qInput = z.string().max(255).optional().describe("Case-insensitive name filter");
const readOnly = { readOnlyHint: true } as const;

function toListQuery(args: { q?: string; page?: number; source?: string; status?: string }): ListQuery {
  return listQuerySchema.parse({
    q: args.q,
    source: args.source,
    status: args.status,
    page: args.page ?? 1,
  });
}

export function registerInventoryReadTools(server: McpServer): void {
  server.registerTool(
    "search_inventory",
    {
      title: "Search inventory",
      description:
        "Cross-entity name/title search over devices, VMs, containers, networks, services, and docs. Returns up to 8 matches per kind with ids and dashboard links. Use when you don't know an entity's id.",
      inputSchema: {
        query: z.string().min(1).max(255).describe("Search text (name/title substring)"),
        kinds: z.array(z.enum(ENTITY_KIND_VALUES)).optional().describe("Restrict to these entity kinds (default: all)"),
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
      inputSchema: { networkId: z.string().min(1).optional().describe("Filter to leases on this network id") },
      annotations: readOnly,
    },
    async (args, extra) => run("read", extra, () => inventory.listDhcpLeases(args.networkId)),
  );
}
