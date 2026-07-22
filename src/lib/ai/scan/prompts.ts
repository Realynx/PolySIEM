import type { ScopeDigest } from "@/lib/ai/scan/collect";
import type { TicketRefs, TicketSeverityValue } from "@/lib/types";

/** Minimal inventory context so the model can tell internal from external IPs. */
export interface NetworkContext {
  name: string;
  cidr: string | null;
  vlanId: number | null;
}

/**
 * Compact view of an already-existing ticket, fed to the model so it can avoid
 * duplicating open tickets and respect the reasoning behind closed ones.
 */
export interface ExistingTicketContext {
  /** Stable short handle the model echoes back as `matchesExisting` (e.g. "T1"). */
  handle: string;
  title: string;
  status: "OPEN" | "CLOSED";
  severity: TicketSeverityValue;
  /** One-line gist of the ticket. */
  summary: string;
  refs: TicketRefs | null;
  /** Closing note / reasoning for CLOSED tickets — null for open ones. */
  resolution: string | null;
}

/** DB-facing shape used to choose which tickets fit in a scope prompt. */
export interface TicketContextCandidate {
  title: string;
  status: "OPEN" | "CLOSED";
  summary: string;
  resolution: string | null;
  sourceRefs: unknown;
}

/** Max existing tickets rendered into a prompt (token budget). */
export const EXISTING_TICKET_CAP = 20;
/** Max chars kept from a ticket's summary / resolution when rendering. */
const CONTEXT_FIELD_CHAR_CAP = 240;

const RELEVANCE_STOP_WORDS = new Set([
  "about", "after", "again", "alert", "alerts", "been", "before", "being", "closed", "from", "into",
  "issue", "logs", "more", "network", "observed", "same", "security", "seen", "that", "their", "this",
  "ticket", "traffic", "using", "when", "with",
]);

export const SCAN_SYSTEM_PROMPT =
  "You are a security analyst reviewing logs for a self-hosted home lab (Proxmox cluster, OPNsense firewall, " +
  "Suricata IDS, Elasticsearch). You receive a pre-aggregated digest of one log scope for a time window, plus a " +
  "list of tickets that already exist for this lab. " +
  "Identify noteworthy anomalies and security-relevant events, correlate related entries, and ignore routine noise " +
  "(ordinary service restarts, single transient errors, expected internal traffic). " +
  "Respond with JSON only, in this exact shape:\n" +
  '{"findings": [{"title": "...", "severity": "critical|high|medium|low|info", ' +
  '"category": "ids-alert|anomaly|correlation|recon|auth|traffic|other", ' +
  '"summary": "what happened in plain language, referencing the concrete IPs, hosts and signatures involved", ' +
  '"suggestions": "numbered, concrete response steps a homelab admin can take", ' +
  '"dedupe": "short-stable-slug-identifying-the-underlying-issue (same issue => same slug on every scan)", ' +
  '"matchesExisting": "handle of an existing ticket this finding is about, or null", ' +
  '"refs": {"srcIps": [], "destIps": [], "signatures": [], "hosts": []}}]}\n' +
  'Return {"findings": []} when nothing rises above routine noise. Do not invent events that are not in the digest. ' +
  "Use the existing tickets to avoid duplicates and repeat work:\n" +
  "- If a finding is about the same underlying issue as an existing ticket, set \"matchesExisting\" to that ticket's " +
  "handle. Only include such a finding when there is NEW evidence worth attaching (e.g. it is still happening, or is " +
  "now worse) — otherwise omit it. Never emit a second finding for an issue an open ticket already covers.\n" +
  "- Respect CLOSED tickets: their resolution is the operator's conclusion (often \"benign\" or \"handled\"). Do NOT " +
  "re-report an issue a closed ticket already dismissed unless the new evidence is materially different or clearly " +
  "MORE severe than when it was closed. When you do override a closed resolution, set \"matchesExisting\" to that " +
  "ticket and briefly say in the summary why the closed conclusion no longer holds. Otherwise treat it as settled.\n" +
  "Severity guidance: critical = active compromise indicators; high = likely attack needing prompt action; " +
  "medium = suspicious and worth investigating; low = notable but probably benign; info = observation only.";

function clipField(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > CONTEXT_FIELD_CHAR_CAP ? `${trimmed.slice(0, CONTEXT_FIELD_CHAR_CAP)}…` : trimmed;
}

/** Flatten a ticket's refs into a compact "src X; dst Y; sig Z; host H" string. */
function renderRefs(refs: TicketRefs | null): string {
  if (!refs) return "";
  const parts: string[] = [];
  if (refs.srcIps?.length) parts.push(`src ${refs.srcIps.slice(0, 5).join(", ")}`);
  if (refs.destIps?.length) parts.push(`dst ${refs.destIps.slice(0, 5).join(", ")}`);
  if (refs.signatures?.length) parts.push(`sig ${refs.signatures.slice(0, 3).join(", ")}`);
  if (refs.hosts?.length) parts.push(`host ${refs.hosts.slice(0, 5).join(", ")}`);
  return parts.join("; ");
}

/**
 * Relevance score of an existing ticket to the current digest. Exact refs
 * dominate, while shared terms from its title, summary, and closure rationale
 * let recurring traffic match even when an address has changed.
 */
export function scoreTicketRelevance(
  refs: TicketRefs | null,
  digestText: string,
  rationaleText = "",
): number {
  const haystack = digestText.toLowerCase();
  const needles = [
    ...(refs?.srcIps ?? []),
    ...(refs?.destIps ?? []),
    ...(refs?.signatures ?? []),
    ...(refs?.hosts ?? []),
  ];
  const indicatorScore = needles.reduce((score, needle) => {
    const value = needle.trim().toLowerCase();
    return score + (value && haystack.includes(value) ? 100 : 0);
  }, 0);

  // Titles, summaries, and especially close rationales often contain the
  // stable service/signature name even when an IP changes between scans.
  const terms = rationaleText.toLowerCase().match(/[a-z0-9][a-z0-9._:-]{2,}/g) ?? [];
  const rationaleScore = [...new Set(terms)].filter(
    (term) => term.length >= 4 && !RELEVANCE_STOP_WORDS.has(term) && haystack.includes(term),
  ).length;
  return indicatorScore + rationaleScore;
}

/**
 * Select a relevance-ranked prompt subset while reserving equal room for open
 * work and closed operator decisions. Unused room from either side is filled
 * by the next strongest candidate overall.
 */
export function selectTicketContextCandidates<T extends TicketContextCandidate>(
  candidates: T[],
  digestText: string,
  cap = EXISTING_TICKET_CAP,
): T[] {
  const ranked = candidates
    .map((ticket, i) => ({
      ticket,
      i,
      score: scoreTicketRelevance(
        ticket.sourceRefs as TicketRefs | null,
        digestText,
        `${ticket.title}\n${ticket.summary}\n${ticket.resolution ?? ""}`,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const perStatusCap = Math.floor(cap / 2);
  const selectedSet = new Set([
    ...ranked.filter(({ ticket }) => ticket.status === "OPEN").slice(0, perStatusCap),
    ...ranked.filter(({ ticket }) => ticket.status === "CLOSED").slice(0, perStatusCap),
  ]);
  for (const candidate of ranked) {
    if (selectedSet.size >= cap) break;
    selectedSet.add(candidate);
  }
  return ranked.filter((candidate) => selectedSet.has(candidate)).map(({ ticket }) => ticket);
}

/** Render the existing-ticket block, capped at EXISTING_TICKET_CAP entries. */
export function renderExistingTickets(tickets: ExistingTicketContext[], cap = EXISTING_TICKET_CAP): string {
  if (tickets.length === 0) return "No existing tickets.";
  const lines = tickets.slice(0, cap).map((t) => {
    const refs = renderRefs(t.refs);
    const bits = [
      `- [${t.handle}] ${t.status} sev ${t.severity} "${clipField(t.title)}"`,
      refs ? `refs: ${refs}` : "",
      `summary: ${clipField(t.summary)}`,
      t.status === "CLOSED" ? `resolution: ${t.resolution ? clipField(t.resolution) : "(none recorded)"}` : "",
    ].filter(Boolean);
    return bits.join(" | ");
  });
  return lines.join("\n");
}

/** Render the per-scope user prompt: internal-network context + existing tickets + the digest. */
export function buildScanPrompt(
  digest: ScopeDigest,
  networks: NetworkContext[],
  existingTickets: ExistingTicketContext[] = [],
): string {
  const networkLines = networks
    .filter((n) => n.cidr)
    .slice(0, 30)
    .map((n) => `- ${n.name}${n.vlanId !== null ? ` (VLAN ${n.vlanId})` : ""}: ${n.cidr}`);

  return [
    `Log scope: ${digest.scope}`,
    "",
    networkLines.length
      ? `Known internal networks (addresses inside these ranges are internal hosts):\n${networkLines.join("\n")}`
      : "No internal network inventory available — treat RFC1918 addresses as internal.",
    "",
    "Existing tickets (reuse these via matchesExisting instead of creating duplicates; respect CLOSED resolutions):",
    renderExistingTickets(existingTickets),
    "",
    "Digest:",
    digest.text,
  ].join("\n");
}
