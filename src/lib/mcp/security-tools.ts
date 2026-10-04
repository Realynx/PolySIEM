import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listSecurityTicketSummaries, securityTicketSummary } from "@/lib/ai/agent/assistant-read";
import { checkThreatIntel } from "@/lib/ai/agent/research";
import { lookupCensysHost } from "@/lib/services/censys";
import { lookupSecurityTrailsOperation } from "@/lib/services/securitytrails";
import { getIocMatches } from "@/lib/services/threat-intel";
import { createTicket, patchTicket } from "@/lib/services/tickets";
import { ticketCreateSchema, ticketPatchSchema } from "@/lib/validators/scan";
import { ApiError } from "@/lib/api";
import { investigateIp, securityReport } from "@/lib/mcp/analysis";
import { cursorInput, limitInput } from "@/lib/mcp/pagination";
import { runTool, type ToolExtra } from "@/lib/mcp/tool-results";

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
const CATEGORIES = ["anomaly", "ids-alert", "correlation", "recon", "auth", "traffic", "other"] as const;

function userIdOf(extra: ToolExtra): string | undefined {
  const id = extra.authInfo?.extra?.userId;
  return typeof id === "string" ? id : undefined;
}

export function registerSecurityReadTools(server: McpServer): void {
  server.registerTool(
    "get_security_score",
    {
      title: "Get security score and findings",
      description:
        "The live security advisor report (same as the Security page): 0-100 score, per-category subscores (exposure, firewall, access, hardening, documentation), severity counts and concrete findings with affected entities and remediation, worst first. " +
        "Filter with minSeverity/category and page with cursor. Dismissed findings are excluded unless includeDismissed=true.",
      inputSchema: {
        minSeverity: z.enum(["critical", "high", "medium", "low", "info"]).optional().describe("Only findings at or above this severity (default: all)"),
        category: z.enum(["exposure", "firewall", "access", "hardening", "documentation"]).optional().describe("Only this category"),
        includeDismissed: z.boolean().optional().describe("Also list findings an admin dismissed"),
        cursor: cursorInput,
        limit: limitInput,
      },
      annotations: readOnly,
    },
    async (args, extra) => runTool("read", extra, () => securityReport(args)),
  );

  server.registerTool(
    "list_security_tickets",
    {
      title: "List security tickets",
      description:
        "Threat-watch tickets raised by the AI log scanner or by people: title, summary, severity, status, referenced IPs/signatures/hosts, sightings and AI verdict. Most severe and recent first. Use get_entity type=ticket detail=full for evidence and remediation, and save_security_ticket to open, update or close one.",
      inputSchema: {
        status: z.enum(["open", "closed", "all"]).optional().describe("Default open"),
        severities: z.array(z.enum(SEVERITIES)).max(5).optional().describe("Only these severities"),
        query: z.string().trim().max(256).optional().describe("Text in title/summary"),
        limit: z.number().int().min(1).max(50).optional().describe("Max tickets (default 20)"),
      },
      annotations: readOnly,
    },
    async (args, extra) => runTool("read", extra, () => listSecurityTicketSummaries(args)),
  );

  server.registerTool(
    "investigate_ip",
    {
      title: "Investigate an IP address",
      description:
        "One-call dossier for an IP: what it is (owning host/VM/container, network/VLAN, DHCP/ARP, NIC vendor, internal vs external), firewall rules / port forwards / dynamic DNS that reference it, AlienVault OTX matches, related security tickets, and (unless includeLogs=false) an Elasticsearch activity summary (event types, ports, IDS signatures, peers). " +
        "Each section degrades independently, reporting `unavailable` instead of failing the call.",
      inputSchema: {
        ip: z.string().trim().min(3).max(64).describe("IPv4 or IPv6 address"),
        includeLogs: z.boolean().optional().describe("Query Elasticsearch too (default true)"),
        hours: z.number().int().min(1).max(168).optional().describe("Log look-back window in hours (default 24)"),
      },
      annotations: readOnly,
    },
    async (args, extra) => runTool("read", extra, () => investigateIp({ ...args, userId: userIdOf(extra) })),
  );

  server.registerTool(
    "check_threat_intel",
    {
      title: "Check threat intelligence",
      description:
        "AlienVault OTX threat intel. mode=indicator (default) checks whether an IP or domain appears in cached OTX pulses. mode=lab_matches scans recent logs for any OTX indicator that touched the lab and returns the matches. Uses only cached pulses and local logs, so it never spends third-party API quota.",
      inputSchema: {
        mode: z.enum(["indicator", "lab_matches"]).optional().describe("Default indicator"),
        indicator: z.string().trim().min(1).max(255).optional().describe("IP or domain (mode=indicator)"),
        hours: z.number().int().min(1).max(168).optional().describe("Log window for lab_matches (default 24)"),
      },
      annotations: readOnly,
    },
    async (args, extra) =>
      runTool("read", extra, async () => {
        if (args.mode === "lab_matches") return getIocMatches({ hours: args.hours ?? 24 }, userIdOf(extra));
        if (!args.indicator) throw new ApiError(400, "validation_error", "indicator is required when mode=indicator");
        return checkThreatIntel(args.indicator, userIdOf(extra));
      }),
  );

  server.registerTool(
    "lookup_external_intel",
    {
      title: "Look up public internet intel",
      description:
        "Query a third-party internet-intel service about a PUBLIC IP or domain. provider=censys: open services, certificates, ASN and location for a public IP. provider=securitytrails with dataset domain | subdomains | domain_whois | ip_whois. " +
        "Results are cached for four days; live cache misses count against the admin's rolling 24-hour AI/MCP quota, so prefer investigate_ip/check_threat_intel first.",
      inputSchema: {
        provider: z.enum(["censys", "securitytrails"]),
        query: z.string().trim().min(1).max(255).describe("Public IP (censys, ip_whois) or domain"),
        dataset: z.enum(["domain", "subdomains", "domain_whois", "ip_whois"]).optional().describe("SecurityTrails dataset (default domain)"),
        integrationId: z.string().trim().min(1).optional().describe("Specific integration id when several are configured"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args, extra) =>
      runTool("read", extra, () =>
        args.provider === "censys"
          ? lookupCensysHost(args.query, { source: "mcp", integrationId: args.integrationId })
          : lookupSecurityTrailsOperation(args.dataset ?? "domain", args.query, { source: "mcp", integrationId: args.integrationId }),
      ),
  );
}

export function registerSecurityWriteTools(server: McpServer): void {
  server.registerTool(
    "save_security_ticket",
    {
      title: "Create or update a security ticket",
      description:
        "Open a new security ticket (omit id; title, summary and severity required) or update one (pass id): change title/summary/severity/category on human-created tickets, or set status CLOSED with a resolution rationale (or OPEN to reopen) on any ticket. " +
        "AI-generated ticket content is read-only; close it instead. This only records PolySIEM state and never blocks or changes anything on the network.",
      inputSchema: {
        id: z.string().trim().min(1).max(128).optional().describe("Ticket id to update; omit to create"),
        title: z.string().trim().min(1).max(200).optional(),
        summary: z.string().trim().min(1).max(20_000).optional().describe("Markdown description of what was observed"),
        severity: z.enum(SEVERITIES).optional(),
        category: z.enum(CATEGORIES).optional().describe("Default other"),
        status: z.enum(["OPEN", "CLOSED"]).optional().describe("Close or reopen (updates only)"),
        resolution: z.string().trim().min(3).max(20_000).optional().describe("Required when closing: why it is benign or how it was handled"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args, extra) =>
      runTool("write_docs", extra, async (actor) => {
        const { id, ...fields } = args;
        const ticket = id
          ? await patchTicket(actor, id, ticketPatchSchema.parse(fields))
          : await createTicket(actor, ticketCreateSchema.parse(fields));
        return { action: id ? "updated" : "created", ticket: securityTicketSummary(ticket) };
      }),
  );
}
