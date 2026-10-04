import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/*
 * Reusable task prompts. They only orchestrate the read/write tools above, so
 * they inherit the server's scope rules (no infrastructure changes).
 */

function userPrompt(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "security_review",
    {
      title: "Security review of my lab",
      description: "Walk the security score, internet exposure, segmentation and open tickets, then write prioritized recommendations.",
      argsSchema: {
        focus: z.string().max(200).optional().describe("Optional focus, e.g. 'exposure' or 'IoT VLAN'"),
      },
    },
    (args) =>
      userPrompt(
        [
          "Do a security review of my homelab using the PolySIEM MCP tools.",
          args.focus ? `Focus especially on: ${args.focus}.` : "",
          "1. get_lab_overview to orient yourself.",
          "2. get_security_score (minSeverity medium) and summarise the score and the worst findings.",
          "3. get_exposure: list everything reachable from the internet, flag unproxied hostnames, undocumented NAT targets and unrestricted forwards.",
          "4. check_access for the segmentation boundaries that matter (internet → management, IoT/guest → servers, servers → management).",
          "5. list_security_tickets for open HIGH/CRITICAL tickets and check_threat_intel mode=lab_matches.",
          "Finish with a prioritised list: each item gives the risk, the evidence (ids), and the concrete fix the owner should make by hand. You cannot and must not change infrastructure; offer to record the review with write_doc or open tickets with save_security_ticket.",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
  );

  server.registerPrompt(
    "investigate_ip",
    {
      title: "Investigate an IP",
      description: "Identify an address, its exposure, threat-intel status and recent activity, and give a verdict.",
      argsSchema: { ip: z.string().min(3).max(64).describe("IPv4 or IPv6 address") },
    },
    (args) =>
      userPrompt(
        [
          `Investigate ${args.ip} using the PolySIEM MCP tools.`,
          `1. investigate_ip ip=${args.ip} for identity, firewall/NAT context, OTX, related tickets and log activity.`,
          "2. If it is internal, get_topology on the owning asset and check_access from internet to it. If it is external and public, consider lookup_external_intel (uses a rate-limited quota).",
          "3. If the logs are unclear, list_log_fields then search_logs for the specific events.",
          "Report: what the address is, what it did, whether it is malicious/suspicious/benign with confidence, and recommended next steps. Offer to record the result with save_security_ticket or add_note.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "document_host",
    {
      title: "Document this host",
      description: "Gather everything PolySIEM knows about a host/VM/container and write or refresh its documentation page.",
      argsSchema: { host: z.string().min(1).max(255).describe("Host, VM or container name or id") },
    },
    (args) =>
      userPrompt(
        [
          `Write documentation for "${args.host}" using the PolySIEM MCP tools.`,
          `1. get_entity ref="${args.host}" detail=full (resolve ambiguity by asking me).`,
          "2. get_topology for its networks, reachability and ingress; list_inventory type=service hostId=<id> for its services; list_ssh_keys for keys authorised on it.",
          "3. Read any linked documentation pages (get_entity type=doc detail=full).",
          "4. write_doc a page titled after the host covering purpose, hardware/resources, OS, networks and IPs, services and ports, exposure, access (SSH keys), dependencies and open questions. Embed {{node:<kind>:<id>}} tokens for the host and related inventory. Update the existing page instead of creating a duplicate.",
          "Do not invent facts: mark unknowns as open questions.",
        ].join("\n"),
      ),
  );
}
