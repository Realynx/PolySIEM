/**
 * Threat-center trigger logic — PURE, so the severity rules stay unit testable
 * and the action definition can share them with the scheduler.
 *
 * Fires when the AI scanner (or a user) opens a NEW threat ticket. Tickets
 * dedupe on `dedupeKey`: a recurring issue bumps `timesSeen` on the existing
 * row rather than inserting a new one, so "new row" really does mean "new
 * problem" and the trigger will not re-fire for the same finding.
 */

import { z } from "zod";

export const THREAT_TICKET_KIND = "trigger.threat-ticket";

/** Ordered low -> high; the index is the comparable rank. */
export const TICKET_SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type TicketSeverity = (typeof TICKET_SEVERITIES)[number];

/** Categories the scanner assigns (see SecurityTicket.category in schema.prisma). */
export const TICKET_CATEGORIES = [
  "any",
  "anomaly",
  "ids-alert",
  "correlation",
  "recon",
  "auth",
  "traffic",
  "other",
] as const;

export const SEVERITY_MATCH_MODES = ["at-or-above", "exactly"] as const;
export type SeverityMatchMode = (typeof SEVERITY_MATCH_MODES)[number];

export const TICKET_SOURCES = ["any", "ai", "user"] as const;

export function severityRank(severity: string): number {
  const index = (TICKET_SEVERITIES as readonly string[]).indexOf(severity);
  return index === -1 ? 0 : index;
}

export const threatTicketConfigSchema = z.object({
  severity: z.enum(TICKET_SEVERITIES).default("MEDIUM"),
  severityMatch: z.enum(SEVERITY_MATCH_MODES).default("at-or-above"),
  category: z.enum(TICKET_CATEGORIES).default("any"),
  createdBy: z.enum(TICKET_SOURCES).default("any"),
  // Graph-validation parity with the other triggers: the payload comes from
  // the ticket, not from user-entered run parameters.
  params: z.array(z.unknown()).default([]),
});

export type ThreatTicketConfig = z.infer<typeof threatTicketConfigSchema>;

/** The ticket fields the decision needs — a narrow view of SecurityTicket. */
export interface TicketLike {
  severity: string;
  category: string;
  createdBy: string;
}

/**
 * Whether one ticket passes the trigger's filters. Severity is the headline
 * control: "at-or-above" is the usual intent ("page me for HIGH and CRITICAL"),
 * "exactly" exists for routing a single band to its own workflow.
 */
export function ticketMatches(ticket: TicketLike, config: ThreatTicketConfig): boolean {
  const matchesSeverity =
    config.severityMatch === "exactly"
      ? ticket.severity === config.severity
      : severityRank(ticket.severity) >= severityRank(config.severity);
  if (!matchesSeverity) return false;
  if (config.category !== "any" && ticket.category !== config.category) return false;
  if (config.createdBy !== "any" && ticket.createdBy !== config.createdBy) return false;
  return true;
}

/** Human-readable description of the severity filter, for logs and node cards. */
export function describeSeverityFilter(config: ThreatTicketConfig): string {
  return config.severityMatch === "exactly"
    ? `severity exactly ${config.severity}`
    : `severity ${config.severity} or higher`;
}
