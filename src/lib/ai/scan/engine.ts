import "server-only";
import type { AiScanRun } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getAiScanConfig, type AiScanConfig } from "@/lib/settings";
import { generateJson, isMockMode } from "@/lib/ai/ollama";
import { resolveLogSource } from "@/lib/services/logs";
import { collectScope, type ScanScope, type ScopeDigest } from "@/lib/ai/scan/collect";
import {
  buildScanPrompt,
  EXISTING_TICKET_CAP,
  scoreTicketRelevance,
  SCAN_SYSTEM_PROMPT,
  type ExistingTicketContext,
  type NetworkContext,
} from "@/lib/ai/scan/prompts";
import { dedupeKeyFor, parseFindings } from "@/lib/ai/scan/parse";
import { EVIDENCE_SAMPLE_CAP, isMoreSevere, mergeEvidence, planFinding } from "@/lib/ai/scan/policy";
import type { ScanFinding } from "@/lib/validators/scan";
import type { AiScanRunStats, TicketEvidence, TicketRefs, TicketSeverityValue } from "@/lib/types";

/** Days of recently-closed tickets fed to the model as context (with resolutions). */
const CLOSED_CONTEXT_WINDOW_DAYS = 45;

/** Fields of an existing ticket needed to build prompt context and attach evidence. */
interface ContextTicket {
  id: string;
  dedupeKey: string | null;
  title: string;
  status: "OPEN" | "CLOSED";
  severity: TicketSeverityValue;
  summary: string;
  resolution: string | null;
  sourceRefs: unknown;
  evidence: unknown;
}

/**
 * Candidate tickets for prompt context: every OPEN ticket plus CLOSED tickets
 * from the recent window that carry a resolution (so the model can reuse the
 * operator's reasoning). Ordered most-severe / most-recent first; hard-capped
 * before per-scope prioritization.
 */
async function fetchContextTickets(now: Date): Promise<ContextTicket[]> {
  const closedSince = new Date(now.getTime() - CLOSED_CONTEXT_WINDOW_DAYS * 86_400_000);
  const rows = await prisma.securityTicket.findMany({
    where: {
      OR: [
        { status: "OPEN" },
        { status: "CLOSED", closedAt: { gte: closedSince }, resolution: { not: null } },
      ],
    },
    select: {
      id: true,
      dedupeKey: true,
      title: true,
      status: true,
      severity: true,
      summary: true,
      resolution: true,
      sourceRefs: true,
      evidence: true,
    },
    orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }],
    take: 200,
  });
  return rows as ContextTicket[];
}

/**
 * Per-scope: prioritize the candidate tickets by ref-overlap with this digest,
 * cap to the token budget, assign stable handles, and return both the compact
 * prompt context and a handle→ticket map (also keyed by dedupeKey) for attach.
 */
function buildScopeContext(candidates: ContextTicket[], digestText: string): {
  contexts: ExistingTicketContext[];
  byHandle: Map<string, ContextTicket>;
} {
  const selected = candidates
    .map((ticket, i) => ({ ticket, i, score: scoreTicketRelevance(ticket.sourceRefs as TicketRefs | null, digestText) }))
    // Tickets whose refs overlap the current digest first; ties keep DB order.
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, EXISTING_TICKET_CAP);

  const contexts: ExistingTicketContext[] = [];
  const byHandle = new Map<string, ContextTicket>();
  selected.forEach(({ ticket }, idx) => {
    const handle = `T${idx + 1}`;
    contexts.push({
      handle,
      title: ticket.title,
      status: ticket.status,
      severity: ticket.severity,
      summary: ticket.summary,
      refs: (ticket.sourceRefs as TicketRefs | null) ?? null,
      resolution: ticket.status === "CLOSED" ? ticket.resolution : null,
    });
    byHandle.set(handle.toUpperCase(), ticket);
    if (ticket.dedupeKey) byHandle.set(ticket.dedupeKey.toUpperCase(), ticket);
  });
  return { contexts, byHandle };
}

/** Resolve a model-provided `matchesExisting` handle to a context ticket, tolerantly. */
function resolveMatch(handle: string | null | undefined, byHandle: Map<string, ContextTicket>): ContextTicket | null {
  if (!handle) return null;
  const key = handle.trim().toUpperCase();
  return key ? byHandle.get(key) ?? null : null;
}

function evidenceFor(finding: ScanFinding, digest: ScopeDigest, fromMs: number, toMs: number): TicketEvidence {
  // Prefer samples mentioning an IP/signature/host the finding references.
  const needles = [
    ...(finding.refs?.srcIps ?? []),
    ...(finding.refs?.destIps ?? []),
    ...(finding.refs?.signatures ?? []),
    ...(finding.refs?.hosts ?? []),
  ].map((n) => n.toLowerCase());
  const matching = needles.length
    ? digest.samples.filter((sample) => needles.some((needle) => sample.message.toLowerCase().includes(needle)))
    : [];
  const samples = (matching.length ? matching : digest.samples).slice(0, EVIDENCE_SAMPLE_CAP);
  return {
    samples,
    scope: digest.scope,
    timeRange: { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
  };
}

interface ApplyResult {
  created: number;
  updated: number;
  /** Set when a brand-new ticket was created — used by the auto-investigate hook. */
  createdTicket?: { id: string; severity: TicketSeverityValue };
}

/**
 * Upsert one finding. The model's `matchesExisting` handle is resolved FIRST:
 * when it resolves, the finding attaches to that exact ticket (open stays open,
 * closed STAYS closed — never reopened). Otherwise it falls back to the
 * mechanical dedupe key under the never-reopen policy. Never creates a second
 * ticket for something already flagged as matching an existing one.
 */
async function applyFinding(
  finding: ScanFinding,
  digest: ScopeDigest,
  runId: string,
  fromMs: number,
  toMs: number,
  byHandle: Map<string, ContextTicket>,
): Promise<ApplyResult> {
  const now = new Date();
  const evidence = evidenceFor(finding, digest, fromMs, toMs);

  // Resolve an explicit match first; only hit the dedupe index when there isn't one.
  const matched = resolveMatch(finding.matchesExisting, byHandle);
  const dedupeKey = dedupeKeyFor(digest.scope, finding.dedupe);
  const dedupeExisting = matched ? null : await prisma.securityTicket.findUnique({ where: { dedupeKey } });
  const action = planFinding(
    matched ? { status: matched.status } : null,
    dedupeExisting ? { status: dedupeExisting.status } : null,
  );

  if (action === "create") {
    const createdTicket = await prisma.securityTicket.create({
      data: {
        title: finding.title,
        summary: finding.summary,
        severity: finding.severity,
        category: finding.category,
        createdBy: "ai",
        dedupeKey,
        evidence: evidence as object,
        suggestions: finding.suggestions,
        sourceRefs: finding.refs as object | undefined,
        scanRunId: runId,
        lastSeenAt: now,
      },
      select: { id: true, severity: true },
    });
    return { created: 1, updated: 0, createdTicket: { id: createdTicket.id, severity: createdTicket.severity } };
  }

  const target = (matched ?? dedupeExisting)!;

  if (action === "suppress") {
    // Closed + only a mechanical dedupe hit: record it's still being seen, stay closed.
    await prisma.securityTicket.update({
      where: { id: target.id },
      data: { timesSeen: { increment: 1 }, lastSeenAt: now },
    });
    return { created: 0, updated: 0 };
  }

  const raiseSeverity = isMoreSevere(finding.severity, target.severity as TicketSeverityValue)
    ? finding.severity
    : undefined;
  const mergedEvidence = mergeEvidence(target.evidence as TicketEvidence | null, evidence);

  if (action === "attach-closed") {
    // Explicit match to a CLOSED ticket: attach the new evidence but keep it
    // CLOSED and DON'T rewrite the operator's content/resolution. Only escalate
    // severity if the finding is strictly worse.
    await prisma.securityTicket.update({
      where: { id: target.id },
      data: {
        timesSeen: { increment: 1 },
        lastSeenAt: now,
        evidence: mergedEvidence as object,
        ...(raiseSeverity ? { severity: raiseSeverity } : {}),
      },
    });
    return { created: 0, updated: 1 };
  }

  // attach-open: absorb the re-detection into the open ticket and refresh AI content.
  await prisma.securityTicket.update({
    where: { id: target.id },
    data: {
      timesSeen: { increment: 1 },
      lastSeenAt: now,
      summary: finding.summary,
      suggestions: finding.suggestions,
      evidence: mergedEvidence as object,
      sourceRefs: (finding.refs ?? target.sourceRefs) as object | undefined,
      scanRunId: runId,
      ...(raiseSeverity ? { severity: raiseSeverity } : {}),
    },
  });
  return { created: 0, updated: 1 };
}

function enabledScopes(cfg: AiScanConfig): ScanScope[] {
  const scopes: ScanScope[] = [];
  if (cfg.scopes.suricata) scopes.push("suricata");
  if (cfg.scopes.cloudflared) scopes.push("cloudflared");
  if (cfg.scopes.general) scopes.push("general");
  return scopes;
}

/**
 * Execute one AI scan: collect a digest per enabled scope, ask the model for
 * findings, and upsert tickets. Scopes fail independently — one bad scope
 * yields a PARTIAL run, not a lost one.
 */
export async function runScan(trigger: "manual" | "interval"): Promise<AiScanRun> {
  const cfg = await getAiScanConfig();
  if (!cfg.baseUrl) throw new ApiError(400, "scan_not_configured", "Configure the Ollama base URL first.");
  if (!cfg.model && !isMockMode(cfg.baseUrl)) {
    throw new ApiError(400, "scan_not_configured", "Choose an Ollama model to scan with first.");
  }
  const scopes = enabledScopes(cfg);
  if (scopes.length === 0) throw new ApiError(400, "scan_not_configured", "Enable at least one scan scope.");

  const esCfg = await resolveLogSource(cfg.integrationId || undefined);
  const toMs = Date.now();
  const fromMs = toMs - cfg.lookbackMinutes * 60_000;
  const model = cfg.model || "demo-model:latest";

  const run = await prisma.aiScanRun.create({
    data: { trigger, model, timeRangeFrom: new Date(fromMs), timeRangeTo: new Date(toMs) },
  });

  const networks: NetworkContext[] = await prisma.network.findMany({
    where: { status: "ACTIVE" },
    select: { name: true, cidr: true, vlanId: true },
  });

  // Existing tickets fed to the model as context so it attaches to / respects
  // them instead of duplicating. Fetched once; prioritized per scope below.
  const contextCandidates = await fetchContextTickets(new Date());

  const stats: AiScanRunStats = { docsScanned: 0, ticketsCreated: 0, ticketsUpdated: 0, scopesRun: [] };
  const errors: string[] = [];
  const newHighTickets: string[] = [];

  for (const scope of scopes) {
    try {
      const digest = await collectScope(scope, esCfg, cfg, fromMs, toMs);
      stats.docsScanned! += digest.docCount;
      if (scope === "suricata") stats.suricataAlerts = digest.docCount;
      stats.scopesRun!.push(scope);
      if (digest.docCount === 0 && digest.samples.length === 0) continue; // nothing to analyze

      const { contexts, byHandle } = buildScopeContext(contextCandidates, digest.text);
      const raw = await generateJson({
        baseUrl: cfg.baseUrl,
        model,
        system: SCAN_SYSTEM_PROMPT,
        prompt: buildScanPrompt(digest, networks, contexts),
      });
      for (const finding of parseFindings(raw)) {
        const result = await applyFinding(finding, digest, run.id, fromMs, toMs, byHandle);
        stats.ticketsCreated! += result.created;
        stats.ticketsUpdated! += result.updated;
        if (result.createdTicket && (result.createdTicket.severity === "CRITICAL" || result.createdTicket.severity === "HIGH")) {
          newHighTickets.push(result.createdTicket.id);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${scope}: ${message}`);
    }
  }

  // Optional: auto-investigate new HIGH/CRITICAL tickets (off by default). Runs
  // after the scan so it never slows ticket creation; failures are swallowed.
  if (cfg.autoInvestigate && newHighTickets.length > 0) {
    const { investigateTicketToCompletion } = await import("@/lib/ai/agent/investigate");
    for (const ticketId of newHighTickets) {
      try {
        await investigateTicketToCompletion(ticketId, { role: "ADMIN" });
      } catch (err) {
        errors.push(`auto-investigate ${ticketId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const status = errors.length === 0 ? "SUCCESS" : errors.length === scopes.length ? "FAILED" : "PARTIAL";
  const finished = await prisma.aiScanRun.update({
    where: { id: run.id },
    data: {
      status,
      finishedAt: new Date(),
      stats: stats as object,
      error: errors.length ? errors.join("\n") : null,
    },
  });
  await audit({ type: "system" }, "scan.complete", { type: "ai_scan_run", id: run.id }, {
    trigger,
    status,
    ...stats,
  });
  return finished;
}
