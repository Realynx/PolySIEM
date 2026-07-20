import "server-only";
import { prisma } from "@/lib/db";
import {
  threatTicketConfigSchema,
  ticketMatches,
  type ThreatTicketConfig,
} from "./threat-trigger-logic";
import type { TriggerState } from "./trigger-state";
import type { WorkflowNodeSpec } from "./types";

/**
 * I/O half of the threat-center trigger: finds tickets opened since the cursor
 * that pass the node's filters.
 *
 * The cursor is the `createdAt` of the newest ticket already handled and the
 * query uses a strict `>`, so it is exact — no timestamp skew needed (unlike
 * the Elasticsearch triggers, whose range filter is inclusive).
 *
 * On the very first evaluation there is no cursor. Rather than firing for every
 * ticket in the backlog, the trigger arms itself: it records "now" and fires
 * for tickets opened after that.
 */

/** Most tickets one poll will fire for, so a burst can't stampede the engine. */
const MAX_TICKETS_PER_POLL = 25;

export interface ThreatTicketPayload extends Record<string, unknown> {
  ticketId: string;
  title: string;
  severity: string;
  category: string;
  status: string;
  summary: string;
  createdBy: string;
  timesSeen: number;
  createdAt: string;
  url: string;
  firedAt: string;
}

export interface ThreatEvaluation {
  /** One payload per matching ticket — the scheduler starts a run for each. */
  payloads: ThreatTicketPayload[];
  nextState: TriggerState;
  /** Tickets seen this poll before filtering, for the scheduler's log line. */
  scanned: number;
}

export async function evaluateThreatTrigger(
  node: WorkflowNodeSpec,
  state: TriggerState,
  now: Date = new Date(),
): Promise<ThreatEvaluation> {
  const config: ThreatTicketConfig = threatTicketConfigSchema.parse(node.config);

  const cursorMs = state.cursorTs ? Date.parse(state.cursorTs) : NaN;
  if (!Number.isFinite(cursorMs)) {
    // First run: arm at "now" without replaying history.
    return { payloads: [], nextState: { ...state, cursorTs: now.toISOString() }, scanned: 0 };
  }

  const tickets = await prisma.securityTicket.findMany({
    where: { createdAt: { gt: new Date(cursorMs) } },
    orderBy: { createdAt: "asc" },
    take: MAX_TICKETS_PER_POLL,
  });
  if (tickets.length === 0) return { payloads: [], nextState: state, scanned: 0 };

  // Advance past everything examined, matching or not — an unmatched ticket
  // must not be re-examined forever.
  const newest = tickets[tickets.length - 1].createdAt.toISOString();
  const payloads = tickets.filter((t) => ticketMatches(t, config)).map<ThreatTicketPayload>((t) => ({
    ticketId: t.id,
    title: t.title,
    severity: t.severity,
    category: t.category,
    status: t.status,
    summary: t.summary,
    createdBy: t.createdBy,
    timesSeen: t.timesSeen,
    createdAt: t.createdAt.toISOString(),
    url: `/logs/threats?ticket=${t.id}`,
    firedAt: now.toISOString(),
  }));

  return { payloads, nextState: { ...state, cursorTs: newest }, scanned: tickets.length };
}
