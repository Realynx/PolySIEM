import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ragSearch } from "@/lib/rag/search";
import { getEntityDetail } from "@/lib/mcp/entity-detail";
import { resolveEntity, searchEntities } from "@/lib/mcp/entity-resolve";
import { entityHref, entityTypeInput } from "@/lib/mcp/entity-types";
import { detailInput } from "@/lib/mcp/pagination";
import { runTool } from "@/lib/mcp/tool-results";

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const RAG_SOURCES = ["doc", "device", "vm", "container", "network", "service"] as const;

export function registerSearchTools(server: McpServer): void {
  server.registerTool(
    "search",
    {
      title: "Search everything",
      description:
        "Find entities when you do not know their id. mode=name (default) does a case-insensitive substring match on names/titles/CIDRs/fingerprints across every type (hosts, VMs, containers, networks, services, storage, docs, security tickets, workflows, SSH keys, firewall rules, port forwards, tunnels, connectors, edge servers, privacy routers, integrations, Wi-Fi) and resolves IP addresses to their owner. " +
        "mode=semantic runs vector (RAG) search over documentation and inventory text; use it for open questions like \"where is the backup job documented?\". Follow up with get_entity.",
      inputSchema: {
        query: z.string().trim().min(1).max(500).describe("Name fragment, IP address, or (semantic mode) a natural-language question"),
        mode: z.enum(["name", "semantic"]).optional().describe("name (default) or semantic"),
        types: z.array(entityTypeInput).max(21).optional().describe("Restrict name search to these entity types"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 20)"),
      },
      annotations: readOnly,
    },
    async (args, extra) =>
      runTool("read", extra, async () => {
        const limit = args.limit ?? 20;
        if (args.mode === "semantic") {
          const sourceTypes = (args.types ?? []).filter((t): t is (typeof RAG_SOURCES)[number] => (RAG_SOURCES as readonly string[]).includes(t));
          const res = await ragSearch(args.query, { limit: Math.min(limit, 20), sourceTypes: sourceTypes.length ? sourceTypes : undefined });
          return { mode: "semantic", model: res.model, results: res.results };
        }
        const hits = await searchEntities(args.query, args.types, limit);
        return {
          mode: "name",
          results: hits.map((hit) => ({ ...hit, href: entityHref(hit.type, hit.id) })),
          ...(hits.length === 0 ? { hint: "No name matches. Try mode=semantic, a shorter fragment, or an IP address." } : {}),
        };
      }),
  );

  server.registerTool(
    "get_entity",
    {
      title: "Get any entity",
      description:
        "Fetch one entity by id OR by name/slug/IP: resolves the reference across all types (or only `type` if given) and returns its details with a dashboard link and, for inventory, the documentation pages that link to it. " +
        "If the reference is ambiguous you get `candidates` instead; call again with the exact id and type. detail=summary (default) is compact; detail=full adds relations, full doc/ticket bodies, workflow graphs, switch ports and integration metadata (secrets are always removed).",
      inputSchema: {
        ref: z.string().trim().min(1).max(255).describe("Entity id, exact or partial name, doc slug, or IP address"),
        type: entityTypeInput.optional().describe("Entity type, when known (faster and unambiguous)"),
        detail: detailInput,
      },
      annotations: readOnly,
    },
    async (args, extra) =>
      runTool("read", extra, async () => {
        const { match, candidates } = await resolveEntity(args.ref, args.type);
        if (!match) {
          return candidates.length === 0
            ? { found: false, message: `Nothing matches "${args.ref}". Try search with mode=semantic.` }
            : { found: false, ambiguous: true, candidates: candidates.slice(0, 20) };
        }
        return { found: true, ...(await getEntityDetail(match.type, match.id, args.detail ?? "summary")) };
      }),
  );
}
