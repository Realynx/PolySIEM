/**
 * Pure helpers for the BACKGROUND investigation lifecycle — the poll-state
 * machine, the "any active investigation" list selector, and status→badge
 * presentation. No React, no server imports, so it's fully unit-testable and
 * shared by the panel, the list badges, and the polling hook.
 */

import type { InvestigationStatus } from "@/lib/ai/agent/contract";
import type { SecurityTicketDto } from "@/lib/types";

/**
 * Is this investigation still in flight? "queued"/"running" are the states we
 * keep polling and show an "investigating" cue for; "success"/"failed"/null are
 * terminal (or never-run) and warrant no polling.
 */
export function isInvestigationActive(status: InvestigationStatus | null | undefined): boolean {
  return status === "queued" || status === "running";
}

/**
 * True when ANY ticket in the list has a live (queued/running) investigation —
 * the gate for background list polling. Tolerates an undefined list (loading).
 */
export function hasActiveInvestigation(tickets: SecurityTicketDto[] | undefined | null): boolean {
  return tickets?.some((t) => isInvestigationActive(t.investigationStatus)) ?? false;
}

/** Badge presentation for a ticket's investigation status. */
export interface InvestigationStatusMeta {
  /** Short human label for a badge/chip. */
  label: string;
  /** Longer label for headings/active views. */
  longLabel: string;
  /** Badge classes in the app's outline-badge idiom (dark/light safe tokens). */
  className: string;
  /** Active (queued/running) states get a spinner and drive polling. */
  active: boolean;
}

export const INVESTIGATION_STATUS_META: Record<InvestigationStatus, InvestigationStatusMeta> = {
  queued: {
    label: "queued",
    longLabel: "Queued — starting investigation…",
    className: "border-primary/40 bg-primary/10 text-primary",
    active: true,
  },
  running: {
    label: "investigating",
    longLabel: "Investigating…",
    className: "border-primary/40 bg-primary/10 text-primary",
    active: true,
  },
  success: {
    label: "investigated",
    longLabel: "Investigation complete",
    className: "border-success/40 bg-success/10 text-success",
    active: false,
  },
  failed: {
    label: "failed",
    longLabel: "Investigation failed",
    className: "border-destructive/50 bg-destructive/10 text-destructive",
    active: false,
  },
};

/** Presentation for a status, or null when there's nothing to show (idle). */
export function investigationStatusMeta(
  status: InvestigationStatus | null | undefined,
): InvestigationStatusMeta | null {
  if (!status) return null;
  return INVESTIGATION_STATUS_META[status] ?? null;
}
