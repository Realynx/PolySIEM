/**
 * AI agent contract — the FROZEN shared shapes between the LangChain agent
 * runtime (src/lib/ai/agent/**, API routes) and the UIs that consume it (the
 * threat-ticket "Investigate" panel and the global chat dock).
 *
 * Client-safe: no server-only imports. Both the engine agent and the UI agents
 * build against this file in parallel — changes are additive-only.
 */

// ---------- research tools (metadata surfaced to the UI as tool-call chips) ----------

/** Stable kinds of tool the agent can call; used only for UI iconography/labels. */
export type AgentToolKind =
  | "lookup_ip_identity"
  | "query_logs"
  | "discover_elasticsearch_fields"
  | "search_elasticsearch"
  | "check_threat_intel"
  | "get_firewall_context"
  | "get_related_threats"
  | "reverse_dns"
  | "whois_asn"
  | "ip_reputation"
  | "search_inventory"
  | "get_lab_overview"
  | "get_asset_topology"
  | "get_entity"
  | "list_security_tickets"
  | "get_security_ticket"
  | "get_integration_health"
  | "list_workflows"
  | "run_workflow"
  | "write_doc"
  | "ask_question"
  | "trigger_sync"
  | "other";

/** A single tool invocation, streamed to the UI as it happens. */
export interface AgentToolCall {
  id: string;
  kind: AgentToolKind;
  /** Raw tool name as registered with LangChain (may be finer-grained than kind). */
  name: string;
  /** JSON-safe arguments the model passed. */
  args: Record<string, unknown>;
  /** Short human summary for the chip, e.g. "Identity of 10.0.3.16". */
  label: string;
  status: "running" | "success" | "error";
  /** Compact JSON-safe result preview (redacted; never secrets). */
  resultPreview?: string;
}

// ---------- documentation interview ----------

/** What the operator wants the guided documentation interview to produce. */
export type DocInterviewGoal = "document" | "services" | "both";

/** A service the interviewer proposes adding after the operator reviews it. */
export interface InterviewServiceCandidate {
  name: string;
  url: string | null;
  port: number | null;
  protocol: "http" | "https" | "tcp" | "udp" | null;
  description: string | null;
  target: {
    kind: "device" | "vm" | "container";
    id: string;
    name: string;
  };
  /** Why this candidate is credible; it must trace to synced data or an answer. */
  evidence: string;
}

export interface InterviewServicePlan {
  services: InterviewServiceCandidate[];
  notes: string[];
}

// ---------- investigation report (persisted on the ticket) ----------

export type ThreatVerdict =
  "benign" | "suspicious" | "malicious" | "compromised" | "inconclusive";

/** What one IP turned out to be, after research. */
export interface IpFindings {
  ip: string;
  /** "internal" (matches a synced network) | "external" | "unknown". */
  scope: "internal" | "external" | "unknown";
  /** Identity: the machine/vendor this address belongs to, if known. */
  identity: string | null;
  /** rDNS PTR, if resolved. */
  reverseDns: string | null;
  /** Owning org / ASN / country from RDAP-WHOIS, for external IPs. */
  asn: string | null;
  /** One-line reputation verdict from threat intel + external reputation. */
  reputation: string | null;
  /** What this IP was observed doing in the logs, in plain language. */
  activity: string | null;
}

/** One actionable remediation step the admin can take. */
export interface ResolutionStep {
  order: number;
  action: string;
  /** Why this step matters / what it addresses. */
  rationale: string;
  /** True for steps that change infra state (vs. investigate/monitor). */
  changesState: boolean;
  /** Optional concrete command or PolySIEM workflow the admin could run. */
  command?: string;
}

/** The full structured output of an investigation, persisted on a ticket. */
export interface InvestigationReport {
  /** Executive summary paragraph. */
  summary: string;
  verdict: ThreatVerdict;
  /** 0–100 model-estimated confidence in the verdict. */
  confidence: number;
  ips: IpFindings[];
  /** Ordered remediation plan. */
  resolution: ResolutionStep[];
  /** Model + tool-calls trail for provenance. */
  meta: {
    model: string;
    toolCalls: AgentToolCall[];
    generatedAt: string;
    /** External services actually contacted this run (rDNS, RDAP, reputation). */
    externalSourcesUsed: string[];
  };
}

// ---------- background investigation lifecycle ----------

/** Lifecycle of a ticket's background investigation. */
export type InvestigationStatus = "queued" | "running" | "success" | "failed";

/**
 * Live progress of an in-flight (or last) background investigation, persisted
 * on the ticket so any client can poll and render it — even one that never
 * started the run. Cleared to null once a final report is stored on success.
 */
export interface InvestigationProgress {
  status: InvestigationStatus;
  /** When this run was enqueued. */
  startedAt: string;
  /** Tool-call trail so far (redacted previews). */
  toolCalls: AgentToolCall[];
  /** Streaming analysis text accumulated so far. */
  partialText: string;
  /** Failure message when status === "failed". */
  error: string | null;
}

// ---------- investigate API ----------
// Ticket investigations run in the BACKGROUND (server-side), decoupled from the
// request that starts them — they survive navigation and complete even if no
// client is watching. Clients poll ticket state (GET /api/logs/tickets or the
// status route) and update whenever `investigationStatus` / `investigation`
// change.
//
// POST /api/ai/investigate  (admin)
//   body: { ticketId }                       -> enqueues a background run, returns
//                                               { data: { status: InvestigationStatus } } immediately.
//                                               Re-posting while "queued"/"running" is a no-op.
//   body: { ips: string[]; context? }        -> ad-hoc (no ticket): streams SSE synchronously
//                                               (AgentStreamEvent) as before; not persisted.
// GET  /api/ai/investigate?ticketId=...  (admin)
//   -> { data: { status, progress: InvestigationProgress | null,
//                report: InvestigationReport | null, investigatedAt: string | null } }
//   Poll target for a ticket's investigation. Robustness contract: a run that
//   does real work then hits a model/structured-output failure must still finish
//   with a synthesized report from the gathered tool results — it must never
//   discard the work and end merely "failed" when partial findings exist.

// ---------- chat API ----------
// POST /api/ai/chat  (session user; writes/infra tools admin-gated server-side)
//   body: { messages: ChatMessage[]; context?: ChatContext }
//   Streams Server-Sent Events (AgentStreamEvent).

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Present on assistant turns that used tools, for re-render of history. */
  toolCalls?: AgentToolCall[];
}

/** Inventory kinds the get_entity tool accepts, mirrored for page context. */
export type ChatSubjectEntityKind =
  | "device"
  | "vm"
  | "container"
  | "network"
  | "service"
  | "doc";

/** Optional page context so "investigate this" works without restating it. */
export interface ChatContext {
  /** Where the user opened the dock, e.g. "/logs/threats". */
  path?: string;
  /** A focused subject the chat should assume, e.g. an IP or ticket id. */
  subject?: {
    kind: "ip" | "ticket" | "entity";
    value: string;
    label?: string;
    /** For kind "entity": which get_entity kind `value` is an id for. */
    entityKind?: ChatSubjectEntityKind;
  };
}

// ---------- shared SSE event protocol (investigate + chat) ----------

export type AgentStreamEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; call: AgentToolCall }
  | { type: "tool_result"; call: AgentToolCall }
  | { type: "report"; report: InvestigationReport } // investigate only
  | { type: "done"; content: string; toolCalls: AgentToolCall[] }
  | { type: "error"; message: string };

/** SSE framing: each event is a line `data: <json AgentStreamEvent>\n\n`. */
export const AGENT_SSE_CONTENT_TYPE = "text/event-stream; charset=utf-8";
