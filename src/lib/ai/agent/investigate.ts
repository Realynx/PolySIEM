/**
 * Ticket-seeded investigation helpers, shared by the /api/ai/investigate route,
 * the background worker, and the scan-engine auto-investigate hook.
 *
 * `enqueueInvestigation` is the single entry point for BACKGROUND runs: it
 * flips the ticket to "queued" and kicks the in-process worker. It is
 * idempotent while a run is queued/running, so the POST route and the scanner
 * can both call it safely.
 */
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { runInvestigation, type AgentRunOptions, type InvestigateInput } from "@/lib/ai/agent/runtime";
import { findRelatedThreats, summarizeRelated } from "@/lib/ai/agent/related";
import { kickWorker } from "@/lib/ai/agent/worker";
import type {
  InvestigationProgress,
  InvestigationReport,
  InvestigationStatus,
} from "@/lib/ai/agent/contract";
import type { TicketEvidence, TicketRefs } from "@/lib/types";

/** Build the agent seed (IPs, context, evidence) from a stored ticket. */
export async function seedFromTicket(ticketId: string): Promise<InvestigateInput> {
  const ticket = await prisma.securityTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new ApiError(404, "not_found", "Ticket not found");

  const refs = (ticket.sourceRefs as TicketRefs | null) ?? {};
  const ips = [...new Set([...(refs.srcIps ?? []), ...(refs.destIps ?? [])])];

  const evidence = (ticket.evidence as TicketEvidence | null) ?? null;
  const seedEvidence = evidence?.samples
    ?.slice(0, 12)
    .map((s) => `- ${s.timestamp} ${s.message}`)
    .join("\n");

  // Correlation-aware seed: pull other tickets that share an IP/signature so
  // the agent starts with the broader threat picture (it can call
  // get_related_threats for more).
  const related = await findRelatedThreats({
    ips,
    signatures: refs.signatures ?? [],
    excludeTicketId: ticketId,
    limit: 6,
  }).catch(() => []);
  const relatedText = summarizeRelated(related);

  const context = [
    `Ticket: ${ticket.title}`,
    `Severity: ${ticket.severity} | Category: ${ticket.category}`,
    `Summary: ${ticket.summary}`,
    ticket.suggestions ? `Existing suggestions: ${ticket.suggestions}` : "",
    refs.signatures?.length ? `Signatures: ${refs.signatures.join("; ")}` : "",
    relatedText
      ? `Related detected threats (other tickets — correlate with these; call get_related_threats for more):\n${relatedText}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { ips, context, seedEvidence };
}

/** Persist a report onto a ticket (used by the synchronous auto-investigate hook). */
export async function persistInvestigation(ticketId: string, report: InvestigationReport): Promise<void> {
  await prisma.securityTicket.update({
    where: { id: ticketId },
    data: {
      investigation: report as unknown as Prisma.InputJsonValue,
      investigatedAt: new Date(),
      investigationStatus: "success",
      investigationProgress: Prisma.DbNull,
      investigationError: null,
    },
  });
}

/**
 * Enqueue a BACKGROUND investigation for a ticket and return the resulting
 * status. Idempotent: re-enqueuing while a run is "queued" or "running" is a
 * no-op that returns the current status. Kicks the in-process worker so the
 * run proceeds decoupled from the caller.
 */
export async function enqueueInvestigation(
  ticketId: string,
  opts?: { actorUserId?: string },
): Promise<{ status: InvestigationStatus }> {
  const ticket = await prisma.securityTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, investigationStatus: true },
  });
  if (!ticket) throw new ApiError(404, "not_found", "Ticket not found");

  const current = ticket.investigationStatus;
  if (current === "queued" || current === "running") {
    return { status: current as InvestigationStatus };
  }

  const now = new Date();
  await prisma.securityTicket.update({
    where: { id: ticketId },
    data: {
      investigationStatus: "queued",
      investigationStartedAt: now,
      investigationError: null,
      investigationProgress: {
        status: "queued",
        startedAt: now.toISOString(),
        toolCalls: [],
        partialText: "",
        error: null,
      } as unknown as Prisma.InputJsonValue,
    },
  });
  await audit(
    { type: opts?.actorUserId ? "user" : "system", userId: opts?.actorUserId },
    "ai.investigate.enqueue",
    { type: "ticket", id: ticketId },
    {},
  );
  kickWorker();
  return { status: "queued" };
}

export interface InvestigationStateResponse {
  status: InvestigationStatus | null;
  progress: InvestigationProgress | null;
  report: InvestigationReport | null;
  investigatedAt: string | null;
}

/** The GET /api/ai/investigate poll payload for a ticket. */
export async function getInvestigationState(ticketId: string): Promise<InvestigationStateResponse> {
  const ticket = await prisma.securityTicket.findUnique({
    where: { id: ticketId },
    select: {
      investigationStatus: true,
      investigationProgress: true,
      investigation: true,
      investigatedAt: true,
    },
  });
  if (!ticket) throw new ApiError(404, "not_found", "Ticket not found");
  return {
    status: (ticket.investigationStatus as InvestigationStatus | null) ?? null,
    progress: (ticket.investigationProgress as InvestigationProgress | null) ?? null,
    report: (ticket.investigation as InvestigationReport | null) ?? null,
    investigatedAt: ticket.investigatedAt?.toISOString() ?? null,
  };
}

/**
 * Run an investigation for a ticket to completion, draining the event stream
 * and persisting the report. Legacy synchronous helper kept for the existing
 * auto-investigate hook; new background runs go through
 * {@link enqueueInvestigation}. Best-effort: returns the report or null.
 */
export async function investigateTicketToCompletion(
  ticketId: string,
  opts: AgentRunOptions,
): Promise<InvestigationReport | null> {
  const input = await seedFromTicket(ticketId);
  let report: InvestigationReport | null = null;
  const gen = runInvestigation(input, { ...opts, ticketId });
  for await (const event of gen) {
    if (event.type === "report") report = event.report;
  }
  if (report) {
    await persistInvestigation(ticketId, report);
    await audit(
      { type: opts.userId ? "user" : "system", userId: opts.userId },
      "ai.investigate.auto",
      { type: "ticket", id: ticketId },
      { verdict: report.verdict, confidence: report.confidence, ips: input.ips },
    );
  }
  return report;
}
