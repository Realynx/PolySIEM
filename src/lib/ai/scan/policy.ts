import type { TicketEvidence, TicketSeverityValue } from "@/lib/types";

export const EVIDENCE_SAMPLE_CAP = 20;

export const SEVERITY_RANK: Record<TicketSeverityValue, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

/**
 * What a re-detected finding should do to the ticket matched by its mechanical
 * dedupe key, if any. There is deliberately no "reopen": once an operator closes
 * a ticket it is handled, so a later re-detection is only recorded — never
 * reopened.
 */
export type UpsertAction = "create" | "bump" | "suppress";

/**
 * Pure dedupe policy for the mechanical (dedupeKey) fallback path:
 * - no matching ticket        => create a new one;
 * - matching OPEN ticket       => bump it (absorb the re-detection);
 * - matching CLOSED ticket      => suppress: the operator closed it, so it stays
 *   closed. The caller still records that it's being seen again (timesSeen +
 *   lastSeenAt), but the ticket is NEVER reopened and no duplicate is spawned.
 */
export function decideUpsert(existing: { status: "OPEN" | "CLOSED" } | null): UpsertAction {
  if (!existing) return "create";
  return existing.status === "OPEN" ? "bump" : "suppress";
}

/**
 * How a finding should be written, resolving the model's `matchesExisting`
 * handle first and then falling back to the mechanical dedupe key. The
 * never-reopen guarantee is structural here — no branch ever reopens a closed
 * ticket:
 * - `create`        — brand-new ticket;
 * - `attach-open`   — merge evidence, refresh AI content, bump (open ticket);
 * - `attach-closed` — merge evidence + bump but keep the ticket CLOSED and its
 *   content untouched (model explicitly matched a closed ticket with new evidence);
 * - `suppress`      — bump counters only, keep CLOSED (mechanical dedupe hit on a
 *   closed ticket, weaker signal — just record it's still being seen).
 */
export type FindingAction = "create" | "attach-open" | "attach-closed" | "suppress";

export function planFinding(
  matched: { status: "OPEN" | "CLOSED" } | null,
  dedupeExisting: { status: "OPEN" | "CLOSED" } | null,
): FindingAction {
  // The model explicitly matched this finding to an existing ticket: attach,
  // preserving that ticket's status (open stays open; closed stays closed).
  if (matched) return matched.status === "OPEN" ? "attach-open" : "attach-closed";

  switch (decideUpsert(dedupeExisting)) {
    case "create":
      return "create";
    case "bump":
      return "attach-open";
    case "suppress":
      return "suppress";
  }
}

/** True when `incoming` is strictly more severe than `current`. */
export function isMoreSevere(incoming: TicketSeverityValue, current: TicketSeverityValue): boolean {
  return SEVERITY_RANK[incoming] > SEVERITY_RANK[current];
}

/** Merge new evidence samples into existing evidence, newest kept, capped. */
export function mergeEvidence(existing: TicketEvidence | null, incoming: TicketEvidence): TicketEvidence {
  const samples = [...incoming.samples, ...(existing?.samples ?? [])].slice(0, EVIDENCE_SAMPLE_CAP);
  return { ...incoming, samples };
}
