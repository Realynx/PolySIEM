import type { ActionDefinition } from "../registry";
import {
  SEVERITY_MATCH_MODES,
  THREAT_TICKET_KIND,
  TICKET_CATEGORIES,
  TICKET_SEVERITIES,
  TICKET_SOURCES,
  threatTicketConfigSchema,
} from "../threat-trigger-logic";

const SEVERITY_MATCH_LABELS: Record<(typeof SEVERITY_MATCH_MODES)[number], string> = {
  "at-or-above": "at or above the selected severity",
  exactly: "exactly the selected severity",
};

/**
 * trigger.threat-ticket — starts the workflow when the threat center opens a
 * NEW ticket that passes the severity filter.
 *
 * The scheduler evaluates this once a minute and starts one run per matching
 * ticket, so a workflow can notify, investigate, or block per finding. Because
 * tickets dedupe on `dedupeKey` (a recurring issue bumps `timesSeen` instead of
 * inserting a row), a repeat of the same finding does not re-fire.
 *
 * Payload is supplied by the scheduler, so run() passes it through; a manual
 * run has no ticket, and returns an empty payload so the graph can still be
 * exercised end to end.
 */
export const triggerThreatTicket: ActionDefinition = {
  meta: {
    kind: THREAT_TICKET_KIND,
    title: "Threat ticket trigger",
    description:
      "Starts the workflow when the threat center opens a new ticket, filtered by severity — e.g. only HIGH and CRITICAL. One run per ticket. Repeat sightings of the same finding bump the existing ticket instead of firing again.",
    category: "trigger",
    inputs: [
      {
        key: "severity",
        label: "Severity",
        type: "select",
        required: true,
        defaultValue: "MEDIUM",
        // Highest first: the common choice is at the top.
        options: [...TICKET_SEVERITIES].reverse().map((s) => ({ value: s, label: s })),
        help: "Which severity band decides whether the trigger fires.",
      },
      {
        key: "severityMatch",
        label: "Fire when severity is",
        type: "select",
        required: true,
        defaultValue: "at-or-above",
        options: SEVERITY_MATCH_MODES.map((m) => ({ value: m, label: SEVERITY_MATCH_LABELS[m] })),
        help: "“At or above” is the usual choice; “exactly” routes a single band to its own workflow.",
      },
      {
        key: "category",
        label: "Category",
        type: "select",
        required: false,
        defaultValue: "any",
        options: TICKET_CATEGORIES.map((c) => ({ value: c, label: c === "any" ? "any category" : c })),
        help: "Restrict to one kind of finding, e.g. ids-alert or auth.",
      },
      {
        key: "createdBy",
        label: "Opened by",
        type: "select",
        required: false,
        defaultValue: "any",
        options: TICKET_SOURCES.map((s) => ({
          value: s,
          label: s === "any" ? "anyone" : s === "ai" ? "the AI scanner" : "a user",
        })),
      },
    ],
    outputs: [
      { key: "ticketId", label: "Ticket id" },
      { key: "title", label: "Title" },
      { key: "severity", label: "Severity" },
      { key: "category", label: "Category" },
      { key: "status", label: "Status" },
      { key: "summary", label: "Summary" },
      { key: "createdBy", label: "Opened by" },
      { key: "timesSeen", label: "Times seen" },
      { key: "createdAt", label: "Opened at (ISO time)" },
      { key: "url", label: "Link to the ticket" },
      { key: "firedAt", label: "Fired at (ISO time)" },
    ],
  },
  configSchema: threatTicketConfigSchema,
  async run({ config, ctx }) {
    threatTicketConfigSchema.parse(config); // re-check for an actionable error
    const supplied = ctx.input;
    if (supplied && typeof supplied.ticketId === "string" && supplied.ticketId !== "") {
      ctx.log(`Threat ticket ${supplied.severity ?? ""} — ${supplied.title ?? supplied.ticketId}`);
      return { ...supplied };
    }

    // Manual run: no ticket started this, so emit an empty shape rather than
    // inventing one. Downstream steps still resolve their templates.
    ctx.log("Run started by hand — no threat ticket attached; emitting empty ticket fields", "WARN");
    return {
      ticketId: "",
      title: "",
      severity: "",
      category: "",
      status: "",
      summary: "",
      createdBy: "",
      timesSeen: 0,
      createdAt: "",
      url: "",
      firedAt: new Date().toISOString(),
    };
  },
};
