/**
 * Cross-ticket correlation: find OTHER security tickets that share an IP or
 * signature with the current investigation, plus a little general context from
 * the most recent open tickets. Powers the `get_related_threats` agent tool
 * and seeds each ticket investigation so the agent starts correlation-aware.
 *
 * The Prisma query lives here (server-only); the ref-intersection and row
 * shaping are pure helpers so they can be unit-tested against fixtures.
 */
import "server-only";
import { prisma } from "@/lib/db";
import type { TicketRefs } from "@/lib/types";

/** Compact projection of a related ticket surfaced to the agent. */
export interface RelatedThreatRow {
  id: string;
  title: string;
  severity: string;
  status: string;
  category: string;
  summary: string;
  refs: TicketRefs | null;
  lastSeenAt: string;
  /** True when this ticket shares an IP/signature with the query (vs. general context). */
  matched: boolean;
}

export interface RelatedThreatsParams {
  ips?: string[];
  signatures?: string[];
  /** The current ticket, excluded from the results. */
  excludeTicketId?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;
/** Recent tickets scanned in-process for ref intersection (JSON refs aren't index-queryable). */
const SCAN_POOL = 200;
const SUMMARY_CAP = 240;

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)));
}

function lower(values: readonly (string | null | undefined)[]): string[] {
  return values.filter((v): v is string => Boolean(v)).map((v) => v.toLowerCase());
}

/**
 * Does a ticket's refs intersect the query? IPs match exactly (case-insensitive);
 * signatures match either-direction substring so a rule name and a shortened
 * form still correlate. Pure — safe to unit-test.
 */
export function refsIntersect(
  refs: TicketRefs | null | undefined,
  needles: { ips: string[]; signatures: string[] },
): boolean {
  if (!refs) return false;
  const wantIps = new Set(lower(needles.ips));
  if (wantIps.size) {
    const ticketIps = lower([...(refs.srcIps ?? []), ...(refs.destIps ?? [])]);
    if (ticketIps.some((ip) => wantIps.has(ip))) return true;
  }
  const wantSigs = lower(needles.signatures);
  if (wantSigs.length) {
    const ticketSigs = lower(refs.signatures ?? []);
    for (const want of wantSigs) {
      for (const have of ticketSigs) {
        if (have === want || have.includes(want) || want.includes(have)) return true;
      }
    }
  }
  return false;
}

/** A ticket row shape sufficient for {@link toRelatedRow}. */
export interface TicketRowInput {
  id: string;
  title: string;
  severity: string;
  status: string;
  category: string;
  summary: string;
  sourceRefs: unknown;
  lastSeenAt: Date;
}

/** Shape a ticket row into a compact related-threat row. Pure. */
export function toRelatedRow(ticket: TicketRowInput, matched: boolean): RelatedThreatRow {
  const summary = ticket.summary.length > SUMMARY_CAP ? `${ticket.summary.slice(0, SUMMARY_CAP)}…` : ticket.summary;
  return {
    id: ticket.id,
    title: ticket.title,
    severity: ticket.severity,
    status: ticket.status,
    category: ticket.category,
    summary,
    refs: (ticket.sourceRefs as TicketRefs | null) ?? null,
    lastSeenAt: ticket.lastSeenAt.toISOString(),
    matched,
  };
}

/**
 * Rank a pool of tickets against the query: intersecting tickets first (any
 * status), then the most recent OPEN tickets as general context, capped at
 * `limit`. Pure so the ordering/selection is testable without a database.
 */
export function selectRelated(
  pool: TicketRowInput[],
  needles: { ips: string[]; signatures: string[] },
  limit: number,
): RelatedThreatRow[] {
  const matched: RelatedThreatRow[] = [];
  const context: RelatedThreatRow[] = [];
  for (const ticket of pool) {
    if (refsIntersect(ticket.sourceRefs as TicketRefs | null, needles)) {
      matched.push(toRelatedRow(ticket, true));
    } else if (ticket.status === "OPEN") {
      context.push(toRelatedRow(ticket, false));
    }
  }
  return [...matched, ...context].slice(0, limit);
}

/**
 * Query other tickets that correlate with the given IPs/signatures. Fetches a
 * bounded recent pool (JSON `sourceRefs` can't be intersected in SQL), then
 * ranks it in-process.
 */
export async function findRelatedThreats(params: RelatedThreatsParams): Promise<RelatedThreatRow[]> {
  const limit = clampLimit(params.limit);
  const needles = {
    ips: (params.ips ?? []).map((s) => s.trim()).filter(Boolean),
    signatures: (params.signatures ?? []).map((s) => s.trim()).filter(Boolean),
  };

  const pool = await prisma.securityTicket.findMany({
    where: params.excludeTicketId ? { id: { not: params.excludeTicketId } } : {},
    orderBy: { lastSeenAt: "desc" },
    take: SCAN_POOL,
    select: {
      id: true,
      title: true,
      severity: true,
      status: true,
      category: true,
      summary: true,
      sourceRefs: true,
      lastSeenAt: true,
    },
  });

  return selectRelated(pool, needles, limit);
}

/**
 * Render related tickets as a short plain-text block for the agent's seed
 * context. Empty string when there is nothing to correlate.
 */
export function summarizeRelated(rows: RelatedThreatRow[]): string {
  if (rows.length === 0) return "";
  return rows
    .map((r) => {
      const refs = [
        ...(r.refs?.srcIps ?? []),
        ...(r.refs?.destIps ?? []),
        ...(r.refs?.signatures ?? []),
      ]
        .slice(0, 4)
        .join(", ");
      const tag = r.matched ? "shared indicator" : "recent";
      return `- [${r.severity}/${r.status}] ${r.title} (${r.category}, ${tag})${refs ? ` — refs: ${refs}` : ""}`;
    })
    .join("\n");
}
