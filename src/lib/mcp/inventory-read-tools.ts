import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@/lib/db";
import {
  EDGE_LIST_KINDS,
  FIREWALL_LIST_KINDS,
  INVENTORY_LIST_TYPES,
  NETWORK_LIST_KINDS,
  listEdge,
  listFirewall,
  listInventory,
  listNetworkRecords,
} from "@/lib/mcp/listings";
import { cursorInput, detailInput, limitInput, pageArray } from "@/lib/mcp/pagination";
import { runTool } from "@/lib/mcp/tool-results";
import { deviceKinds } from "@/lib/validators/inventory";

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const idInput = z.string().trim().min(1).max(128);
const qInput = z.string().trim().max(255).optional();

export function registerInventoryReadTools(server: McpServer): void {
  server.registerTool(
    "list_inventory",
    {
      title: "List inventory",
      description:
        "Page through one inventory type: device (physical hosts: hypervisors, firewalls, switches, NAS), vm, container (LXC/Docker), service (apps/endpoints), storage_pool, switch (parsed switch configs) or wireless_network (SSIDs). " +
        "Filters: q (name substring), hostId (VMs/containers/services/storage on a host), kind (device kind), source, status (default excludes REMOVED), powerState, tag. Returns {items,total,nextCursor}. Use get_entity for one item's full detail.",
      inputSchema: {
        type: z.enum(INVENTORY_LIST_TYPES).describe("Inventory type to list"),
        q: qInput.describe("Case-insensitive name substring"),
        hostId: idInput.optional().describe("Only items on this device (or, for services, this device/VM/container) id"),
        kind: z.enum(deviceKinds).optional().describe("Device kind (type=device only)"),
        source: z.enum(["MANUAL", "PROXMOX", "OPNSENSE", "UNIFI", "CLOUDFLARE", "TAILSCALE", "EDGE_NAT_SERVER"]).optional().describe("Record source"),
        status: z.enum(["ACTIVE", "STALE", "REMOVED"]).optional().describe("Lifecycle status (default: everything except REMOVED)"),
        powerState: z.enum(["RUNNING", "STOPPED", "PAUSED", "UNKNOWN"]).optional().describe("VM/container power state"),
        tag: z.string().trim().max(48).optional().describe("Only items carrying this tag"),
        detail: detailInput,
        cursor: cursorInput,
        limit: limitInput,
      },
      annotations: readOnly,
    },
    async (args, extra) => runTool("read", extra, () => listInventory(args)),
  );

  server.registerTool(
    "list_network",
    {
      title: "List network data",
      description:
        "Page through layer-3 data: networks (VLANs with CIDR, gateway, purpose, counts), ip_addresses (documented IPs with owning host/VM/container), dhcp_leases (OPNsense/UniFi leases), arp (ARP/NDP neighbours seen on the wire, incl. undocumented devices), gateways (WAN gateways and their status) or dyndns (dynamic DNS hostnames). " +
        "q matches name/IP/MAC/hostname/vendor. networkId restricts addresses, leases and ARP to one network. To identify a single IP use get_entity or investigate_ip instead.",
      inputSchema: {
        kind: z.enum(NETWORK_LIST_KINDS).describe("What to list"),
        networkId: idInput.optional().describe("Restrict to one network id"),
        q: qInput.describe("Substring match on name, IP, MAC, hostname or vendor"),
        cursor: cursorInput,
        limit: limitInput,
      },
      annotations: readOnly,
    },
    async (args, extra) => runTool("read", extra, () => listNetworkRecords(args)),
  );

  server.registerTool(
    "list_firewall",
    {
      title: "List firewall policy",
      description:
        "Page through synced firewall policy: rules (OPNsense and Proxmox guest-firewall rules with action, interface, source/dest specs, ports and the PolySIEM annotation), aliases (resolve alias names used in rule specs) or port_forwards (WAN NAT into the lab). " +
        "Read-only: PolySIEM never pushes firewall changes. To answer \"can X reach Y?\" use check_access; for the internet-facing surface use get_exposure.",
      inputSchema: {
        kind: z.enum(FIREWALL_LIST_KINDS).describe("What to list"),
        interface: z.string().trim().max(64).optional().describe("Interface name, e.g. lan, wan, opt3"),
        action: z.enum(["PASS", "BLOCK", "REJECT"]).optional().describe("Rule action (rules only)"),
        source: z.enum(["OPNSENSE", "PROXMOX"]).optional().describe("Rule origin (rules only)"),
        enabledOnly: z.boolean().optional().describe("Hide disabled rules/forwards"),
        q: qInput.describe("Substring match on description, specs, annotation, alias name/content or NAT target IP"),
        cursor: cursorInput,
        limit: limitInput,
      },
      annotations: readOnly,
    },
    async (args, extra) => runTool("read", extra, () => listFirewall(args)),
  );

  server.registerTool(
    "list_edge",
    {
      title: "List edge, tunnels and overlays",
      description:
        "Page through the lab's ingress/egress plumbing: edge_servers (Edge NAT relay VPSes with relay/connector counts), connectors (WireGuard reverse-tunnel connectors with status, handshakes and per-edge tunnel addresses), port_relays (public port → connector/target rules on edge servers), " +
        "privacy_routers (policy-routing boxes with VPN exits and ordered routing rules), tunnels (Cloudflare/other tunnels with ingress hostnames and DNS resolution), tailscale or cloudflare (last synced account snapshots). Private keys and tokens are never included.",
      inputSchema: {
        kind: z.enum(EDGE_LIST_KINDS).describe("What to list"),
        edgeServerId: idInput.optional().describe("Restrict connectors/port_relays to one edge server (integration id)"),
        q: qInput.describe("Name substring (tunnels also match an exact ingress hostname)"),
        cursor: cursorInput,
        limit: limitInput,
      },
      annotations: readOnly,
    },
    async (args, extra) => runTool("read", extra, () => listEdge(args)),
  );

  server.registerTool(
    "list_ssh_keys",
    {
      title: "List SSH keys",
      description:
        "Documented SSH public keys: type, bits, fingerprint, owner, purpose and where each key is authorized (machine, account, install method). Public information only; PolySIEM never stores private key material for documented keys.",
      inputSchema: {
        q: qInput.describe("Substring match on name, fingerprint, owner or comment"),
        cursor: cursorInput,
        limit: limitInput,
      },
      annotations: readOnly,
    },
    async (args, extra) =>
      runTool("read", extra, async () => {
        const ci = (v: string) => ({ contains: v, mode: "insensitive" as const });
        const keys = await prisma.sshKey.findMany({
          where: args.q ? { OR: [{ name: ci(args.q) }, { fingerprint: ci(args.q) }, { ownerLabel: ci(args.q) }, { comment: ci(args.q) }] } : {},
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            keyType: true,
            bits: true,
            fingerprint: true,
            comment: true,
            ownerLabel: true,
            purpose: true,
            deployments: {
              select: {
                username: true,
                method: true,
                hostLabel: true,
                device: { select: { id: true, name: true } },
                vm: { select: { id: true, name: true } },
                container: { select: { id: true, name: true } },
              },
            },
          },
        });
        const items = keys.map(({ deployments, ...key }) => ({
          ...key,
          authorizedOn: deployments.map((d) => ({
            target: d.device?.name ?? d.vm?.name ?? d.container?.name ?? d.hostLabel ?? "unknown",
            targetId: d.device?.id ?? d.vm?.id ?? d.container?.id ?? null,
            user: d.username,
            method: d.method,
          })),
        }));
        return pageArray(items, args);
      }),
  );

  server.registerTool(
    "list_docs",
    {
      title: "List documentation pages",
      description:
        "Page through documentation pages (id, title, slug, parentId, tags, updatedAt) sorted by title; content is not included. Use get_entity with type=doc and detail=full to read a page, search mode=semantic to find pages by meaning, and write_doc to create or edit.",
      inputSchema: {
        q: qInput.describe("Title substring"),
        parentId: idInput.optional().describe("Only direct children of this page id"),
        cursor: cursorInput,
        limit: limitInput,
      },
      annotations: readOnly,
    },
    async (args, extra) =>
      runTool("read", extra, async () => {
        const docs = await prisma.docPage.findMany({
          where: {
            ...(args.q ? { title: { contains: args.q, mode: "insensitive" as const } } : {}),
            ...(args.parentId ? { parentId: args.parentId } : {}),
          },
          orderBy: { title: "asc" },
          select: { id: true, title: true, slug: true, parentId: true, updatedAt: true, createdVia: true, tags: { select: { tag: { select: { name: true } } } } },
        });
        return pageArray(docs.map((d) => ({ ...d, tags: d.tags.map((t) => t.tag.name) })), args);
      }),
  );
}
