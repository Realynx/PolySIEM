import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireToolScope } from "@/lib/mcp/auth";
import { runRawTool as runRaw, runTool as run, textResult } from "@/lib/mcp/tool-results";
import { buildOverviewMarkdown } from "@/lib/mcp/overview";
import { lookupCensysHost } from "@/lib/services/censys";
import { lookupSecurityTrailsOperation } from "@/lib/services/securitytrails";

const readOnly = { readOnlyHint: true } as const;

export function registerOverviewTools(server: McpServer): void {
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
}
