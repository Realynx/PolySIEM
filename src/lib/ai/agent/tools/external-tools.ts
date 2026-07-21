import "server-only";

import { z } from "zod";
import { noteExternal, type ToolContext } from "@/lib/ai/agent/types";
import { makeTool, type AnyTool } from "@/lib/ai/agent/tools/factory";
import { ipReputationLookup, reverseDnsLookup, whoisAsnLookup } from "@/lib/ai/agent/external";
import { lookupCensysHost } from "@/lib/services/censys";
import { lookupSecurityTrailsOperation } from "@/lib/services/securitytrails";

/** Network research tools that may call third-party services. */
export function externalTools(ctx: ToolContext): AnyTool[] {
  return [
    makeTool(
      ctx,
      "reverse_dns",
      "Reverse-DNS (PTR) lookup for an IP address. Time-bounded; returns null if there is no PTR record.",
      z.object({ ip: z.string().min(1).describe("The IP address to resolve") }),
      (args) => reverseDnsLookup(args.ip.trim(), ctx),
    ),
    makeTool(
      ctx,
      "whois_asn",
      "RDAP-WHOIS lookup (keyless) for a PUBLIC IP: owning organisation, ASN, and country. Private/RFC1918 addresses are skipped. Use for external IPs to learn who owns them.",
      z.object({ ip: z.string().min(1).describe("The public IP address to look up") }),
      (args) => whoisAsnLookup(args.ip.trim(), ctx),
    ),
    makeTool(
      ctx,
      "ip_reputation",
      "Optional AbuseIPDB reputation for a PUBLIC IP (confidence score + report count). Returns 'no reputation provider configured' when no API key is set. Private addresses are skipped.",
      z.object({ ip: z.string().min(1).describe("The public IP address to score") }),
      (args) => ipReputationLookup(args.ip.trim(), ctx),
    ),
    makeTool(
      ctx,
      "censys_lookup_host",
      "Credit-aware Censys lookup for a PUBLIC IP: internet-facing services, DNS names, owner/ASN, network, and location. Results are shared and cached for four days; live cache misses are limited by the administrator's rolling 24-hour AI/MCP budget.",
      z.object({
        ip: z.string().min(1).describe("The public IPv4 or IPv6 address to inspect"),
        integrationId: z.string().min(1).optional().describe("Optional Censys integration id; defaults to the first enabled connection"),
      }),
      async (args) => {
        const result = await lookupCensysHost(args.ip, { source: "ai", integrationId: args.integrationId });
        if (!result.cached) noteExternal(ctx, "Censys Platform");
        return result;
      },
    ),
    makeTool(
      ctx,
      "securitytrails_lookup",
      "Credit-aware SecurityTrails research for a domain or public IP. Choose one explicit dataset: current domain details, subdomains, domain WHOIS, or IP WHOIS. Results are shared and cached for four days; live AI/MCP cache misses use the administrator's rolling 24-hour SecurityTrails budget.",
      z.object({
        kind: z.enum(["domain", "subdomains", "domain_whois", "ip_whois"]).describe("SecurityTrails dataset to query"),
        query: z.string().trim().min(1).describe("Domain name for domain datasets, or a public IPv4 address for IP WHOIS"),
        integrationId: z.string().min(1).optional().describe("Optional SecurityTrails integration id; defaults to the first enabled connection"),
      }),
      async (args) => {
        const result = await lookupSecurityTrailsOperation(args.kind, args.query, {
          source: "ai",
          integrationId: args.integrationId,
        });
        if (!result.cached) noteExternal(ctx, "SecurityTrails");
        return result;
      },
    ),
  ];
}
