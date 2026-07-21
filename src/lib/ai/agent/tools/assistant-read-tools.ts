import "server-only";

import { z } from "zod";
import type { ToolContext } from "@/lib/ai/agent/types";
import { makeTool, type AnyTool } from "@/lib/ai/agent/tools/factory";
import {
  getAssetTopology,
  getIntegrationHealth,
  getLabOverview,
  getSecurityTicketContext,
  listSecurityTicketSummaries,
} from "@/lib/ai/agent/assistant-read";
import { searchAll } from "@/lib/services/search";
import * as inventory from "@/lib/services/inventory";
import { getDoc, listDocs } from "@/lib/services/docs";
import * as workflows from "@/lib/workflows/service";
import { listQuerySchema } from "@/lib/validators/inventory";
import type { EntityKind } from "@/lib/types";

const ENTITY_KINDS = ["device", "vm", "container", "network", "service", "doc"] as const;

/** Read-only assistant operations over application services. */
export function assistantReadTools(ctx: ToolContext): AnyTool[] {
  return [
    makeTool(
      ctx,
      "search_inventory",
      "Cross-entity name/title search over devices, VMs, containers, networks, services, and docs. Use when you don't know an entity's id.",
      z.object({
        query: z.string().min(1).max(255).describe("Search text"),
        kinds: z.array(z.enum(ENTITY_KINDS)).optional().describe("Restrict to these entity kinds"),
      }),
      (args) => searchAll(args.query, args.kinds as EntityKind[] | undefined),
    ),
    makeTool(
      ctx,
      "get_lab_overview",
      "Orient to the lab with a bounded overview of inventory counts, hosts and guests, VLANs/CIDRs, and integration state. Use first for broad whole-lab questions.",
      z.object({}),
      () => getLabOverview(),
    ),
    makeTool(
      ctx,
      "get_asset_topology",
      "Get one inventory asset's compact network footprint: VLAN placement, host/guest relationships, firewall reachability, NAT or tunnel ingress, Cloudflare published routes, gateways, and switch links. Resolve the exact entity id with search_inventory first.",
      z.object({ entityId: z.string().min(1).max(128).describe("Exact inventory entity id") }),
      (args) => getAssetTopology(args.entityId),
    ),
    makeTool(
      ctx,
      "get_entity",
      "Fetch full detail for one entity by kind and id (device, vm, container, network, service, or doc).",
      z.object({
        kind: z.enum(ENTITY_KINDS).describe("Entity kind"),
        id: z.string().min(1).describe("Entity id (or slug/id for docs)"),
      }),
      (args) => {
        switch (args.kind) {
          case "device": return inventory.getDevice(args.id);
          case "vm": return inventory.getVm(args.id);
          case "container": return inventory.getContainer(args.id);
          case "network": return inventory.getNetwork(args.id);
          case "service": return inventory.getService(args.id);
          case "doc": return getDoc(args.id);
        }
      },
    ),
    makeTool(
      ctx,
      "list_networks",
      "List networks/VLANs with CIDR, VLAN id, and counts.",
      z.object({ q: z.string().max(255).optional().describe("Name/CIDR filter") }),
      (args) => inventory.listNetworks(listQuerySchema.parse({ q: args.q, page: 1 })),
    ),
    makeTool(
      ctx,
      "get_firewall_rules",
      "List OPNsense firewall rules (optionally filtered by interface/action) plus the alias list for resolving specs.",
      z.object({
        interface: z.string().max(64).optional().describe("Filter by interface (e.g. lan, wan)"),
        action: z.enum(["PASS", "BLOCK", "REJECT"]).optional().describe("Filter by rule action"),
      }),
      async (args) => {
        const [rules, aliases] = await Promise.all([
          inventory.listFirewallRules({ interfaceName: args.interface, action: args.action }),
          inventory.listFirewallAliases(),
        ]);
        return { rules, aliases };
      },
    ),
    makeTool(
      ctx,
      "list_docs",
      "List all documentation pages (id, title, slug, tags). Content is fetched separately with get_doc.",
      z.object({}),
      () => listDocs(),
    ),
    makeTool(
      ctx,
      "get_doc",
      "Fetch one documentation page (markdown content included) by slug or id.",
      z.object({ slugOrId: z.string().min(1).describe("Page slug or id") }),
      (args) => getDoc(args.slugOrId),
    ),
    makeTool(
      ctx,
      "list_workflows",
      "List automation workflows with id, name, description, enabled flag, node/edge counts, and last run status.",
      z.object({}),
      async () => {
        const items = await workflows.listWorkflows();
        return items.map(({ graph, ...rest }) => ({
          ...rest,
          nodeCount: graph.nodes.length,
          edgeCount: graph.edges.length,
        }));
      },
    ),
    makeTool(
      ctx,
      "list_security_tickets",
      "List bounded open or closed security issue summaries by severity and text. Use for security posture, active incidents, or questions such as 'is anything suspicious?'.",
      z.object({
        status: z.enum(["open", "closed", "all"]).optional(),
        severities: z.array(z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"])).max(5).optional(),
        query: z.string().max(256).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      (args) => listSecurityTicketSummaries(args),
    ),
    makeTool(
      ctx,
      "get_security_ticket",
      "Get one security ticket's references, capped human-readable evidence messages, AI verdict, and remediation context. Raw evidence JSON and tool transcripts are intentionally omitted.",
      z.object({ id: z.string().min(1).max(128).describe("Security ticket id") }),
      (args) => getSecurityTicketContext(args.id),
    ),
    makeTool(
      ctx,
      "get_integration_health",
      "Read enabled and sync state plus sanitized errors for configured integrations. Never returns endpoint URLs, settings, or credentials.",
      z.object({}),
      () => getIntegrationHealth(),
    ),
  ];
}
