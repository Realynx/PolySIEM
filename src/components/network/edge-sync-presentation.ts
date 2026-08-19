/**
 * Plain-language presentation for the edge networks surfaces.
 *
 * The data model tracks reconciliation with revisions and sha256 ruleset
 * hashes. Those are debugging aids: no operator decision depends on them. What
 * an operator actually needs is one sentence — *is what I configured live, and
 * what happens if it is not* — plus the one button that resolves it. This module
 * turns the bookkeeping into that sentence, and keeps the raw evidence together
 * in `edgeSyncFacts()` for the details disclosure.
 *
 * Shared by the desktop panel and the mobile edge pages so both read the same
 * words for the same state.
 */

import { formatRelative } from "@/lib/format";
import {
  connectorDisplayName,
  connectorRouteWarning,
  connectorTunnelAddressFor,
  edgeReconciliation,
  isManualConnector,
  isRuleApplied,
  ruleRouteMode,
  type ConnectorDto,
  type EdgeNatRule,
  type EdgeNatServer,
} from "./edge-networks-types";

// ---------------------------------------------------------------------------
// Sync state, in words
// ---------------------------------------------------------------------------

export type EdgeSyncTone = "synced" | "staged" | "drifted" | "unknown" | "disabled" | "cleanup";

export interface EdgeSyncSummary {
  tone: EdgeSyncTone;
  /** The state, as one scannable line. Never a hash or a revision number. */
  headline: string;
  /** The consequence of being in that state. */
  detail: string;
  /** Label for the single primary action, or null when there is none to offer. */
  actionLabel: string | null;
  /** True when pressing that action is the expected next step, not a re-run. */
  actionUrgent: boolean;
}

/** Rules that are enabled but not confirmed in the last successful apply. */
function stagedRuleCount(server: EdgeNatServer): number {
  const lastAppliedAt = server.settings?.lastAppliedAt;
  return server.rules.filter((rule) => rule.enabled && !isRuleApplied(rule, lastAppliedAt)).length;
}

function stagedHeadline(server: EdgeNatServer): string {
  const staged = stagedRuleCount(server);
  if (staged === 0) return "Saved changes have not been pushed to the edge yet";
  return `${staged} route${staged === 1 ? "" : "s"} staged · not pushed to the edge yet`;
}

function disabledSummary(server: EdgeNatServer, appliedRuleCount: number | null): EdgeSyncSummary {
  const cleanup = edgeReconciliation(server).cleanupRequired === true;
  if (!cleanup) {
    return {
      tone: "disabled",
      headline: "Management is off · the edge reports no PolySIEM rules",
      detail: "Nothing PolySIEM manages is forwarding here. The server stays listed so the cleanup stays auditable.",
      actionLabel: null,
      actionUrgent: false,
    };
  }
  const count = appliedRuleCount === null ? "Previously applied" : `${appliedRuleCount}`;
  return {
    tone: "cleanup",
    headline: `Management is off, but ${count} rule${appliedRuleCount === 1 ? "" : "s"} may still be forwarding`,
    detail: "Turning management off does not remove rules from the edge. Clearing sends an empty managed ruleset and waits for the server to confirm it.",
    actionLabel: "Clear remote rules",
    actionUrgent: true,
  };
}

function appliedAgoClause(server: EdgeNatServer, observedAt: string | null | undefined): string {
  const stamp = server.settings?.lastAppliedAt ?? observedAt;
  return stamp ? ` · pushed ${formatRelative(stamp)}` : "";
}

/**
 * The one line that replaces the revision/hash grid. Every branch says what is
 * true now and what happens next; none of them names a hash.
 */
export function edgeSyncSummary(server: EdgeNatServer): EdgeSyncSummary {
  const state = edgeReconciliation(server);
  if (!server.enabled) return disabledSummary(server, state.appliedRuleCount ?? null);
  if (state.drift === "drifted") {
    return {
      tone: "drifted",
      headline: "The edge is running something other than what is saved here",
      detail: "Its ruleset changed outside PolySIEM. Applying replaces it with the saved rules.",
      actionLabel: "Re-apply saved rules",
      actionUrgent: true,
    };
  }
  if (state.drift === "pending" || server.settings?.pendingChanges === true || stagedRuleCount(server) > 0) {
    return {
      tone: "staged",
      headline: stagedHeadline(server),
      detail: "Traffic keeps following the last applied ruleset until you apply.",
      actionLabel: "Apply changes",
      actionUrgent: true,
    };
  }
  if (state.drift === "in_sync") {
    return {
      tone: "synced",
      headline: `In sync${appliedAgoClause(server, state.observedAt)}`,
      detail: "The edge is running exactly the routes saved here.",
      actionLabel: "Re-apply",
      actionUrgent: false,
    };
  }
  return {
    tone: "unknown",
    headline: "PolySIEM has not confirmed what the edge is running",
    detail: "No successful apply has been recorded yet. Applying pushes the saved routes and records the result.",
    actionLabel: "Apply rules",
    actionUrgent: true,
  };
}

// ---------------------------------------------------------------------------
// The bookkeeping, demoted to a disclosure
// ---------------------------------------------------------------------------

export interface EdgeSyncFact {
  label: string;
  /** Display value — already shortened for hashes. */
  value: string;
  mono?: boolean;
  /** Full value behind a shortened display, for a copy button. */
  copy?: string;
}

export function shortRulesetHash(value?: string | null): string {
  if (!value) return "Unknown";
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function revisionText(value?: string | number | null): string {
  return value === null || value === undefined ? "Unknown" : String(value);
}

function countText(value?: number | null): string {
  return value === null || value === undefined ? "Unknown" : String(value);
}

/**
 * Everything the old `Desired vs. remote-applied state` block showed, plus the
 * flags that were cluttering the identity row. Nothing here was deleted — it
 * simply stopped being the headline.
 */
export function edgeSyncFacts(server: EdgeNatServer): EdgeSyncFact[] {
  const state = edgeReconciliation(server);
  const settings = server.settings ?? {};
  const forwarding = settings.syncedSnapshot?.ipForwarding ?? settings.enableIpForwarding;
  const facts: EdgeSyncFact[] = [
    { label: "Saved revision", value: revisionText(state.desiredRevision) },
    { label: "Revision on the edge", value: revisionText(state.appliedRevision) },
    { label: "Saved ruleset hash", value: shortRulesetHash(state.desiredHash), mono: true, copy: state.desiredHash ?? undefined },
    { label: "Ruleset hash on the edge", value: shortRulesetHash(state.appliedHash), mono: true, copy: state.appliedHash ?? undefined },
    { label: "Rules saved here", value: countText(state.desiredRuleCount) },
    { label: "Rules confirmed on the edge", value: countText(state.appliedRuleCount) },
    { label: "Remote state observed", value: state.observedAt ? formatRelative(state.observedAt) : "Never" },
    { label: "IP forwarding on the edge", value: forwarding ? "Enabled" : "Enabled by the next apply" },
  ];
  if (settings.hostKeyFingerprint) {
    facts.push({ label: "Pinned host key", value: settings.hostKeyFingerprint, mono: true, copy: settings.hostKeyFingerprint });
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Route rows
// ---------------------------------------------------------------------------

/**
 * Admin/management ports that are a genuine problem when nothing limits who can
 * reach them. Everything outside this list is ordinary published traffic and is
 * styled as such — amber has to keep meaning something.
 */
const SENSITIVE_PUBLIC_PORTS: Readonly<Record<number, string>> = {
  21: "FTP", 22: "SSH", 23: "Telnet", 135: "MS RPC", 139: "NetBIOS", 445: "SMB",
  1433: "SQL Server", 1521: "Oracle DB", 2375: "Docker API", 2376: "Docker API",
  3306: "MySQL", 3389: "RDP", 5432: "PostgreSQL", 5900: "VNC", 5984: "CouchDB",
  5985: "WinRM", 5986: "WinRM", 6379: "Redis", 6443: "Kubernetes API", 8006: "Proxmox",
  9200: "Elasticsearch", 11211: "Memcached", 27017: "MongoDB",
};

const ANY_SOURCE_CIDRS = new Set(["0.0.0.0/0", "::/0"]);

export interface EdgeRouteRisk {
  /** Short chip text. Says what is exposed, not just that something is wrong. */
  label: string;
  /** The full sentence: what is reachable, by whom, and the fix. */
  detail: string;
}

export function isUnrestrictedSource(rule: Pick<EdgeNatRule, "sourceCidr">): boolean {
  const source = rule.sourceCidr?.trim();
  return !source || ANY_SOURCE_CIDRS.has(source);
}

/** The admin service a public port is conventionally, or null for ordinary traffic. */
export function sensitivePortService(port: number | string): string | null {
  const numeric = typeof port === "number" ? port : Number.parseInt(port, 10);
  return Number.isFinite(numeric) ? SENSITIVE_PUBLIC_PORTS[numeric] ?? null : null;
}

/** Null for every ordinary route — including every unrestricted non-admin port. */
export function edgeRouteRisk(rule: EdgeNatRule): EdgeRouteRisk | null {
  if (!rule.enabled || !isUnrestrictedSource(rule)) return null;
  const service = sensitivePortService(rule.publicPort);
  if (!service) return null;
  return {
    label: `${service} open to the internet`,
    detail: `Port ${rule.publicPort} is a ${service} admin port and no source range limits it, so any address on the internet can reach ${rule.targetAddress}:${rule.targetPort}. Set an allowed source CIDR on this rule.`,
  };
}

export type EdgeRouteRowState = "live" | "staged" | "disabled" | "failed";

export function edgeRouteRowState(rule: EdgeNatRule, lastAppliedAt?: string | null): EdgeRouteRowState {
  if (rule.error) return "failed";
  if (!rule.enabled) return "disabled";
  return isRuleApplied(rule, lastAppliedAt) ? "live" : "staged";
}

/**
 * The state the table as a whole is in. A row in this state says nothing the
 * card header has not already said, so it gets no badge — which is the point:
 * a column whose value is identical on every row carries zero information.
 */
export function edgeRoutesBaselineState(
  rules: readonly EdgeNatRule[],
  lastAppliedAt?: string | null,
): EdgeRouteRowState {
  let live = 0;
  let staged = 0;
  for (const rule of rules) {
    const state = edgeRouteRowState(rule, lastAppliedAt);
    if (state === "live") live += 1;
    if (state === "staged") staged += 1;
  }
  return staged > live ? "staged" : "live";
}

export interface EdgeRouteRowBadge {
  label: string;
  variant: "secondary" | "outline" | "destructive";
}

/** A badge ONLY when this row differs from the card. Otherwise null. */
export function edgeRouteRowBadge(
  state: EdgeRouteRowState,
  baseline: EdgeRouteRowState,
): EdgeRouteRowBadge | null {
  if (state === "failed") return { label: "Failed", variant: "destructive" };
  if (state === "disabled") return { label: "Disabled", variant: "outline" };
  if (state === baseline) return null;
  return state === "staged"
    ? { label: "Not applied yet", variant: "outline" }
    : { label: "Already live", variant: "secondary" };
}

export interface EdgeRoutePath {
  kind: "direct" | "connector";
  /** "Direct from the edge" or "via <connector>". */
  label: string;
  /** The connector's tunnel address ON THIS EDGE, when there is one. */
  address: string | null;
  /**
   * Set only for a hand-configured peer, where PolySIEM's reach ends at the
   * tunnel. Ordinary operating information — not a warning.
   */
  note: string | null;
  /** The long-form explanation of that note, for a title/tooltip. */
  noteDetail: string | null;
}

/** How a published port reaches its target, as the middle column of the table. */
export function edgeRoutePath(
  rule: EdgeNatRule,
  connectors: readonly ConnectorDto[],
  integrationId: string,
): EdgeRoutePath {
  if (ruleRouteMode(rule) !== "connector") {
    return { kind: "direct", label: "Direct from the edge", address: null, note: null, noteDetail: null };
  }
  const connector = connectors.find(
    (entry) => entry.id === rule.connectorId || entry.connectorId === rule.connectorId,
  );
  const manual = connector ? isManualConnector(connector) : false;
  const warning = connector ? connectorRouteWarning(connector, rule, integrationId) : null;
  return {
    kind: "connector",
    label: `via ${connectorDisplayName(connectors, rule.connectorId) ?? "connector"}`,
    address: connector ? connectorTunnelAddressFor(connector, integrationId) : null,
    note: manual ? "peer forwards it on" : null,
    noteDetail: warning?.detail ?? null,
  };
}

// ---------------------------------------------------------------------------
// Fleet-level copy
// ---------------------------------------------------------------------------

/** Disabled servers whose last known remote state still holds managed rules. */
export function edgeServersNeedingCleanup(servers: readonly EdgeNatServer[]): EdgeNatServer[] {
  return servers.filter((server) => !server.enabled && edgeReconciliation(server).cleanupRequired === true);
}

/** The concept the old always-on diagram taught, as collapsed reference copy. */
export const EDGE_TRAFFIC_PATH_STEPS: ReadonlyArray<{ title: string; detail: string }> = [
  {
    title: "The internet reaches the edge server",
    detail: "Clients connect to the edge server's public address, so the home WAN address never appears in a published rule.",
  },
  {
    title: "One rule per published port",
    detail: "Nothing is exposed until a rule exists and has been applied. An allowed source CIDR narrows who may enter it.",
  },
  {
    title: "The edge forwards to a private target",
    detail: "Directly, when the edge can already reach the target — or over the tunnel to a connector inside your network, which makes the last hop.",
  },
];

export const EDGE_TRAFFIC_PATH_CAVEAT =
  "This protects the forwarding path, not every possible identity leak. Application responses, DNS, WebRTC, and logs still need their own review.";
