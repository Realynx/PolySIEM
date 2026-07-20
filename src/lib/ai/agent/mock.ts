/**
 * Deterministic mock agent for mock:// mode — a canned but believable
 * investigation / chat so both features are demoable end-to-end without a live
 * tool-calling model. Mirrors the streaming shape of the real runtime: it
 * emits token / tool_call / tool_result events and (for investigate) a
 * terminal report, exactly like the live path.
 */
import "server-only";
import { isPrivateAddress, parseCidr } from "@/lib/topology/access";
import type {
  AgentStreamEvent,
  AgentToolCall,
  InvestigationReport,
  IpFindings,
  ChatMessage,
} from "@/lib/ai/agent/contract";

const MOCK_MODEL = "mock-agent:demo";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let seq = 0;
function callId(): string {
  seq += 1;
  return `mock-${Date.now()}-${seq}`;
}

async function* streamText(text: string): AsyncGenerator<AgentStreamEvent> {
  for (const word of text.split(" ")) {
    yield { type: "token", text: `${word} ` };
    await delay(12);
  }
}

function isPublic(ip: string): boolean {
  return parseCidr(ip) !== null && !isPrivateAddress(ip);
}

function mockFinding(ip: string): IpFindings {
  if (isPublic(ip)) {
    return {
      ip,
      scope: "external",
      identity: "external host (not part of this lab)",
      reverseDns: `${ip.replace(/\./g, "-")}.example-isp.net`,
      asn: "EXAMPLE-ISP (AS64500, US)",
      reputation: "AbuseIPDB confidence 62%, 14 reports — likely scanner",
      activity: "Repeated inbound connection attempts to exposed service ports flagged by Suricata.",
    };
  }
  return {
    ip,
    scope: "internal",
    identity: "internal host on the trusted VLAN",
    reverseDns: null,
    asn: null,
    reputation: "not a known IOC",
    activity: "Normal internal traffic; appears in DHCP leases and neighbor table.",
  };
}

async function* mockToolRun(
  kind: AgentToolCall["kind"],
  name: string,
  label: string,
  args: Record<string, unknown>,
  preview: string,
): AsyncGenerator<AgentStreamEvent, AgentToolCall> {
  const base: AgentToolCall = { id: callId(), kind, name, args, label, status: "running" };
  yield { type: "tool_call", call: base };
  await delay(120);
  const done: AgentToolCall = { ...base, status: "success", resultPreview: preview };
  yield { type: "tool_result", call: done };
  return done;
}

/** Canned investigation stream for a set of IPs. */
export async function* mockInvestigate(
  ips: string[],
  context?: string,
): AsyncGenerator<AgentStreamEvent, void> {
  const toolCalls: AgentToolCall[] = [];
  const targets = ips.length ? ips : ["1.1.1.1"];

  yield* streamText("Starting investigation of the involved addresses.");

  for (const ip of targets) {
    toolCalls.push(
      yield* mockToolRun("lookup_ip_identity", "lookup_ip_identity", `Identity of ${ip}`, { ip }, `scope=${isPublic(ip) ? "external" : "internal"}`),
    );
    toolCalls.push(
      yield* mockToolRun("query_logs", "query_logs", `Logs for ${ip}`, { term: ip, hours: 24 }, "sampled 47 events"),
    );
    if (isPublic(ip)) {
      toolCalls.push(
        yield* mockToolRun("check_threat_intel", "check_threat_intel", `Threat intel for ${ip}`, { indicator: ip }, "known IOC in 2 pulses"),
      );
      toolCalls.push(
        yield* mockToolRun("whois_asn", "whois_asn", `WHOIS for ${ip}`, { ip }, "EXAMPLE-ISP (AS64500, US)"),
      );
    }
  }

  yield* streamText("Assembling the findings and remediation plan.");

  const findings = targets.map(mockFinding);
  const hasExternalThreat = findings.some((f) => f.scope === "external");

  const report: InvestigationReport = {
    summary:
      `Investigated ${targets.length} address${targets.length === 1 ? "" : "es"}${context ? ` in the context of: ${context}` : ""}. ` +
      (hasExternalThreat
        ? "At least one external host is exhibiting scanning behaviour against exposed services; internal hosts appear to be the targets rather than the source."
        : "All addresses resolve to internal infrastructure with benign activity."),
    verdict: hasExternalThreat ? "suspicious" : "benign",
    confidence: hasExternalThreat ? 72 : 88,
    ips: findings,
    resolution: hasExternalThreat
      ? [
          {
            order: 1,
            action: "Confirm the firewall blocks inbound WAN access to the probed service ports.",
            rationale: "Prevents the external scanner from reaching internal services.",
            changesState: false,
          },
          {
            order: 2,
            action: "Add the offending external IP(s) to a block alias on the firewall.",
            rationale: "Stops repeated probing from the same source.",
            changesState: true,
            command: "Firewall > Aliases > add to blocklist",
          },
          {
            order: 3,
            action: "Monitor the targeted internal host for any successful inbound connection.",
            rationale: "Detects whether any probe succeeded before the block.",
            changesState: false,
          },
        ]
      : [
          {
            order: 1,
            action: "No action required; continue monitoring.",
            rationale: "Activity is consistent with normal internal operation.",
            changesState: false,
          },
        ],
    meta: {
      model: MOCK_MODEL,
      toolCalls,
      generatedAt: new Date().toISOString(),
      externalSourcesUsed: hasExternalThreat ? ["reverse-dns", "rdap"] : [],
    },
  };

  yield { type: "report", report };
  yield { type: "done", content: report.summary, toolCalls };
}

/** Canned chat stream. */
export async function* mockChat(messages: ChatMessage[]): AsyncGenerator<AgentStreamEvent, void> {
  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const toolCalls: AgentToolCall[] = [];

  const ipMatch = last.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
  if (ipMatch) {
    toolCalls.push(
      yield* mockToolRun("lookup_ip_identity", "lookup_ip_identity", `Identity of ${ipMatch[1]}`, { ip: ipMatch[1] }, `scope=${isPublic(ipMatch[1]) ? "external" : "internal"}`),
    );
  } else if (last.trim()) {
    toolCalls.push(
      yield* mockToolRun("search_inventory", "search_inventory", `Search "${last.slice(0, 32)}"`, { query: last }, "3 matches"),
    );
  }

  const reply = ipMatch
    ? `${ipMatch[1]} resolves to an ${isPublic(ipMatch[1]) ? "external host outside the lab" : "internal host on the trusted VLAN"}. This is a mock response for demo mode.`
    : "This is a mock assistant response for demo mode. Configure a tool-capable Ollama model to enable the live agent.";

  yield* streamText(reply);
  yield { type: "done", content: reply, toolCalls };
}
