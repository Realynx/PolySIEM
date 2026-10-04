/**
 * Relay-server presentation: the guided setup checklist, the at-a-glance health
 * of one relay server, and the Internet → relay → tunnel → connector → service
 * path those two are drawn on.
 *
 * Vocabulary. A relay server works like a TURN relay: every packet passes
 * through it and is forwarded with nftables DNAT + masquerade, over a WireGuard
 * "relay tunnel" to a connector at home when the target is not directly
 * reachable. There is no STUN-style discovery and no hole punching. The data
 * model still calls these "edge" servers and "NAT rules"; only the words the
 * operator reads change here.
 *
 * Pure and React-free so the desktop card and the mobile page render the same
 * words for the same state.
 */

import { formatRelative } from "@/lib/format";
import {
  connectorLinkFor,
  connectorsLinkedTo,
  edgeInstallStep,
  edgeServerState,
  ruleRouteMode,
  type ConnectorDto,
  type EdgeNatServer,
  type WireguardTunnelDto,
} from "./edge-networks-types";
import { edgeSyncSummary } from "./edge-sync-presentation";

/** One line that tells a newcomer what this whole page is. */
export const RELAY_EXPLAINER =
  "Works like a TURN relay: all traffic passes through your relay server and is forwarded with nftables NAT. No hole punching, no STUN.";

/** The longer version, for the "How relaying works" disclosure. */
export const RELAY_EXPLAINER_DETAIL =
  "Your home network never opens an inbound port. A connector at home dials out to the relay server over WireGuard and holds that tunnel open; the relay server accepts public traffic on the ports you choose and hands it down the tunnel. Services the relay server can already reach (over Tailscale, say) can skip the tunnel and be relayed directly.";

// ---------------------------------------------------------------------------
// Shared tones
// ---------------------------------------------------------------------------

/** ok = working · warn = needs a look · bad = broken · idle = not set up / not used. */
export type RelayTone = "ok" | "warn" | "bad" | "idle";

/**
 * A WireGuard peer re-handshakes about every two minutes while the tunnel
 * carries traffic or keepalives. Older than this and the peer has most likely
 * gone away.
 */
export const HANDSHAKE_FRESH_SECONDS = 180;

function timeOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/** The newest of several timestamps, or null when none parse. */
export function freshestTimestamp(values: ReadonlyArray<string | null | undefined>): string | null {
  let best: { value: string; time: number } | null = null;
  for (const value of values) {
    const time = timeOf(value);
    if (time !== null && value && (best === null || time > best.time)) best = { value, time };
  }
  return best?.value ?? null;
}

export function handshakeTone(at: string | null | undefined, now: number = Date.now()): RelayTone {
  const time = timeOf(at);
  if (time === null) return "warn";
  return (now - time) / 1000 <= HANDSHAKE_FRESH_SECONDS ? "ok" : "warn";
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface RelayContext {
  /** Connectors already fetched for this relay server (may include unlinked ones). */
  connectors: readonly ConnectorDto[];
  /** The live tunnel settings when fetched; falls back to the overview copy. */
  tunnel?: WireguardTunnelDto | null;
  now?: number;
}

function tunnelOf(server: EdgeNatServer, context: RelayContext): WireguardTunnelDto | null {
  return context.tunnel ?? server.settings?.wireguard ?? null;
}

/** On = enabled and keyed. The overview copy carries a public key but no `hasPrivateKey`. */
export function relayTunnelOn(tunnel: WireguardTunnelDto | null | undefined): boolean {
  if (!tunnel?.enabled) return false;
  return tunnel.hasPrivateKey ?? Boolean(tunnel.publicKey);
}

function linkedConnectors(server: EdgeNatServer, context: RelayContext): ConnectorDto[] {
  return connectorsLinkedTo(context.connectors, server.id);
}

function isConnectorUp(connector: ConnectorDto): boolean {
  return connector.status === "connected" || connector.status === "configured";
}

/** The freshest WireGuard handshake any connector has made with THIS relay server. */
export function relayHandshakeAt(server: EdgeNatServer, context: RelayContext): string | null {
  const tunnel = tunnelOf(server, context);
  const stamps = linkedConnectors(server, context).map(
    (connector) => connectorLinkFor(connector, server.id)?.lastHandshakeAt ?? connector.lastHandshakeAt,
  );
  return freshestTimestamp([tunnel?.lastHandshakeAt, ...stamps]);
}

/** True when the relay forwards nothing through a connector and none is linked. */
function directOnly(server: EdgeNatServer, context: RelayContext): boolean {
  const enabled = server.rules.filter((rule) => rule.enabled);
  return enabled.length > 0 &&
    enabled.every((rule) => ruleRouteMode(rule) === "direct") &&
    linkedConnectors(server, context).length === 0;
}

// ---------------------------------------------------------------------------
// Guided setup
// ---------------------------------------------------------------------------

export type RelaySetupStepId = "trust" | "tunnel" | "connector" | "ports" | "apply";
export type RelaySetupStepState = "done" | "current" | "todo" | "skipped";
export type RelaySetupAction = "ssh" | "tunnel" | "connectors" | "add-port" | "apply";

export interface RelaySetupStep {
  id: RelaySetupStepId;
  title: string;
  /** What this step is for, in one sentence, or how it went. */
  detail: string;
  state: RelaySetupStepState;
  /** Label for the button that does this step, offered on the current step. */
  actionLabel: string;
  action: RelaySetupAction;
}

export interface RelaySetupProgress {
  steps: RelaySetupStep[];
  /** Done or skipped. */
  completed: number;
  total: number;
  /** The step to do next, or null when setup is finished. */
  next: RelaySetupStep | null;
  complete: boolean;
}

interface StepDraft extends Omit<RelaySetupStep, "state"> {
  done: boolean;
  skipped?: boolean;
}

function trustStep(server: EdgeNatServer): StepDraft {
  const install = edgeInstallStep(server);
  return {
    id: "trust",
    title: "Trust the server and install the relay service",
    detail: install.satisfied
      ? "Host key pinned; PolySIEM manages this server over a restricted SSH key."
      : "Run one short command on the server, confirm its fingerprint, and PolySIEM installs the relay service.",
    done: install.satisfied,
    action: "ssh",
    actionLabel: "Set up SSH",
  };
}

function tunnelStep(server: EdgeNatServer, context: RelayContext, skip: boolean): StepDraft {
  const on = relayTunnelOn(tunnelOf(server, context));
  return {
    id: "tunnel",
    title: "Turn on the relay tunnel",
    detail: skip && !on
      ? "Not needed while every port is relayed directly."
      : on
        ? "WireGuard is listening for connectors."
        : "The WireGuard listener your connectors dial into. Linking a connector turns it on for you.",
    done: on,
    skipped: skip && !on,
    action: "tunnel",
    actionLabel: "Set up tunnel",
  };
}

function connectorStep(server: EdgeNatServer, context: RelayContext, skip: boolean): StepDraft {
  const linked = linkedConnectors(server, context);
  const up = linked.filter(isConnectorUp).length;
  const detail = linked.length === 0
    ? skip
      ? "Not needed while every port is relayed directly."
      : "Install a connector at home (or link one you already run). It dials out, so nothing at home opens a port."
    : up > 0
      ? `${up} of ${linked.length} connector${linked.length === 1 ? "" : "s"} connected.`
      : "Linked, but not connected yet. Finish the install on the connector machine.";
  return {
    id: "connector",
    title: "Connect your home network",
    detail,
    done: up > 0,
    skipped: skip && linked.length === 0,
    action: "connectors",
    actionLabel: linked.length === 0 ? "Add a connector" : "Open connectors",
  };
}

function portsStep(server: EdgeNatServer): StepDraft {
  const enabled = server.rules.filter((rule) => rule.enabled).length;
  return {
    id: "ports",
    title: "Relay a port",
    detail: enabled > 0
      ? `${enabled} relayed port${enabled === 1 ? "" : "s"} configured.`
      : "Pick a public port on the relay server and the service it should reach at home.",
    done: enabled > 0,
    action: "add-port",
    actionLabel: "Relay a port",
  };
}

function applyStep(server: EdgeNatServer): StepDraft {
  const summary = edgeSyncSummary(server);
  return {
    id: "apply",
    title: "Apply to the relay server",
    detail: summary.tone === "synced"
      ? "The relay server is running exactly what is saved here."
      : "Nothing changes on the relay server until you apply.",
    done: summary.tone === "synced",
    action: "apply",
    actionLabel: summary.actionLabel ?? "Apply changes",
  };
}

/** The five steps from "server added" to "traffic flows", with what is done and what is next. */
export function relaySetupProgress(server: EdgeNatServer, context: RelayContext): RelaySetupProgress {
  const skip = directOnly(server, context);
  const drafts = [
    trustStep(server),
    tunnelStep(server, context, skip),
    connectorStep(server, context, skip),
    portsStep(server),
    applyStep(server),
  ];
  let nextFound = false;
  const steps = drafts.map(({ done, skipped, ...step }): RelaySetupStep => {
    if (done) return { ...step, state: "done" };
    if (skipped) return { ...step, state: "skipped" };
    if (nextFound) return { ...step, state: "todo" };
    nextFound = true;
    return { ...step, state: "current" };
  });
  const completed = steps.filter((step) => step.state === "done" || step.state === "skipped").length;
  return {
    steps,
    completed,
    total: steps.length,
    next: steps.find((step) => step.state === "current") ?? null,
    complete: completed === steps.length,
  };
}

// ---------------------------------------------------------------------------
// Health, drawn as the relay path
// ---------------------------------------------------------------------------

export type RelayHopId = "internet" | "relay" | "tunnel" | "connector" | "service";

export interface RelayHop {
  id: RelayHopId;
  /** Node name: "Relay server", "Relay tunnel", … */
  label: string;
  /** The concrete thing: an IP, "WireGuard :51820", a connector name, "4 ports". */
  value: string;
  /** Short status under the value, e.g. "handshake 40s ago". */
  status: string;
  tone: RelayTone;
}

function relayHop(server: EdgeNatServer): RelayHop {
  const settings = server.settings ?? {};
  const publicIp = settings.syncedSnapshot?.publicIp ?? settings.publicIp ?? "address not detected";
  const state = edgeServerState(server);
  const checked = server.lastSyncAt ? ` · ${formatRelative(server.lastSyncAt)}` : "";
  const status: Record<typeof state, { status: string; tone: RelayTone }> = {
    online: { status: `Reachable${checked}`, tone: "ok" },
    offline: { status: "Unreachable", tone: "bad" },
    unverified: { status: "Not verified yet", tone: "warn" },
    disabled: { status: "Management off", tone: "idle" },
  };
  return { id: "relay", label: "Relay server", value: publicIp, ...status[state] };
}

function tunnelHop(server: EdgeNatServer, context: RelayContext, skip: boolean): RelayHop {
  const tunnel = tunnelOf(server, context);
  const port = tunnel?.listenPort ?? 51820;
  const base = { id: "tunnel" as const, label: "Relay tunnel", value: `WireGuard · UDP ${port}` };
  if (!tunnel?.enabled) return { ...base, status: skip ? "Not used" : "Off", tone: "idle" };
  if (!relayTunnelOn(tunnel)) return { ...base, status: "Needs a key", tone: "warn" };
  const handshake = relayHandshakeAt(server, context);
  if (!handshake) return { ...base, status: "No handshake yet", tone: "warn" };
  const tone = handshakeTone(handshake, context.now);
  return { ...base, status: `${tone === "ok" ? "Handshake" : "Last handshake"} ${formatRelative(handshake)}`, tone };
}

function connectorHop(server: EdgeNatServer, context: RelayContext, skip: boolean): RelayHop {
  const linked = linkedConnectors(server, context);
  const base = { id: "connector" as const, label: linked.length > 1 ? "Connectors" : "Connector" };
  if (linked.length === 0) {
    return { ...base, value: skip ? "Direct relay" : "None linked", status: skip ? "Not used" : "Add one to reach home", tone: "idle" };
  }
  const up = linked.filter(isConnectorUp).length;
  const value = linked.length === 1 ? linked[0].name : `${linked.length} connectors`;
  const tone: RelayTone = up === linked.length ? "ok" : up === 0 ? "bad" : "warn";
  return { ...base, value, status: linked.length === 1 ? (up ? "Connected" : "Not connected") : `${up} of ${linked.length} connected`, tone };
}

function serviceHop(server: EdgeNatServer): RelayHop {
  const enabled = server.rules.filter((rule) => rule.enabled).length;
  const sync = edgeSyncSummary(server);
  const value = enabled === 0 ? "No ports yet" : `${enabled} relayed port${enabled === 1 ? "" : "s"}`;
  if (enabled === 0) return { id: "service", label: "Your services", value, status: "Relay a port", tone: "idle" };
  const tones: Record<typeof sync.tone, { status: string; tone: RelayTone }> = {
    synced: { status: "Live", tone: "ok" },
    staged: { status: "Not applied yet", tone: "warn" },
    drifted: { status: "Changed outside PolySIEM", tone: "bad" },
    unknown: { status: "Not applied yet", tone: "warn" },
    disabled: { status: "Not managed", tone: "idle" },
    cleanup: { status: "May still be forwarding", tone: "bad" },
  };
  return { id: "service", label: "Your services", value, ...tones[sync.tone] };
}

/** Internet → relay server → relay tunnel → connector → your services, each with its health. */
export function relayHealthPath(server: EdgeNatServer, context: RelayContext): RelayHop[] {
  const skip = directOnly(server, context);
  const internet: RelayHop = { id: "internet", label: "Internet", value: "Any client", status: "Public traffic", tone: "idle" };
  return [internet, relayHop(server), tunnelHop(server, context, skip), connectorHop(server, context, skip), serviceHop(server)];
}

/** The single worst tone along the path — what a collapsed card's dot shows. */
export function relayOverallTone(hops: readonly RelayHop[]): RelayTone {
  const order: RelayTone[] = ["bad", "warn", "ok", "idle"];
  for (const tone of order) if (hops.some((hop) => hop.tone === tone)) return tone;
  return "idle";
}

/** The generic path, for the explainer and the empty page — no live state. */
export const RELAY_PATH_TEMPLATE: ReadonlyArray<Pick<RelayHop, "id" | "label" | "value">> = [
  { id: "internet", label: "Internet", value: "Any client" },
  { id: "relay", label: "Relay server", value: "Public VPS · nftables NAT" },
  { id: "tunnel", label: "Relay tunnel", value: "WireGuard, dialled from home" },
  { id: "connector", label: "Connector", value: "Inside your network" },
  { id: "service", label: "Your services", value: "LAN address and port" },
];

/** The page-level getting-started steps, before any relay server exists. */
export const RELAY_GETTING_STARTED: ReadonlyArray<{ title: string; detail: string }> = [
  { title: "Add a relay server", detail: "Any small VPS with a public IP. You give PolySIEM its SSH address." },
  { title: "Trust it and install the relay service", detail: "One command on the VPS, then confirm its host key fingerprint." },
  { title: "Connect your home network", detail: "Install a connector at home. It dials out over WireGuard, so behind CGNAT is fine." },
  { title: "Relay ports and apply", detail: "Pick a public port and the home service it reaches, then apply." },
];

// ---------------------------------------------------------------------------
// SSH trust dialog
// ---------------------------------------------------------------------------

const ADMIN_USERNAME_PATTERN = /^(?!polysiem-edge$)[A-Za-z_][A-Za-z0-9_-]{0,31}$/;

/**
 * Why "Trust host and install service" is disabled, in words — a silently
 * greyed-out button was the old answer.
 */
export function enrollmentBlocker(input: { publicKey: string; username: string; selected: string; scanning: boolean }): string | null {
  if (!input.publicKey) return "This server has no generated key. Recreate the integration first.";
  if (!input.username.trim()) return "Enter the SSH administrator you ran the command as (step 1).";
  if (!ADMIN_USERNAME_PATTERN.test(input.username.trim())) return "That username is not valid for SSH.";
  if (!input.selected) return input.scanning ? "Scanning the server's host key…" : "Pick the host key fingerprint to trust (step 2).";
  return null;
}
