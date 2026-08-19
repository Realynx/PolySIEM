import "server-only";
import { isIP } from "node:net";
import type { DriverConfig, TestResult } from "../types";
import { edgeNatSettingsSchema, edgeNatSnapshotSchema, wireguardKeyRegex, type EdgeNatSettings, type EdgeNatSnapshot } from "@/lib/validators/integrations";
import { parseEdgeSshUrl, runVerifiedSsh, type CommandRunner } from "./ssh";

function connectionError(stderr: string): string {
  const value = stderr.trim().replace(/\s+/g, " ").slice(0, 500);
  return value || "SSH connection failed";
}

interface EdgeNatStatusFields {
  hostname: string;
  kernel: string;
  ipForwarding: boolean;
  managedRules: number;
  appliedRevision: number;
  appliedHash: string | null;
  iptablesHash: string | null;
  rulesetDrift: boolean;
  addresses: string[];
  routes: string[];
}

function applyStatusLine(status: EdgeNatStatusFields, line: string): void {
  const [kind, ...rest] = line.split("\t");
  const value = rest.join("\t").trim();
  if (applyIdentityStatus(status, kind, value)) return;
  applyRuleStatus(status, kind, value);
}

function applyIdentityStatus(status: EdgeNatStatusFields, kind: string, value: string): boolean {
  switch (kind) {
    case "HOSTNAME": status.hostname = value.slice(0, 253) || status.hostname; return true;
    case "KERNEL": status.kernel = value.slice(0, 512) || status.kernel; return true;
    case "ADDRESS": if (value) status.addresses.push(value.slice(0, 128)); return true;
    case "ROUTE": if (value) status.routes.push(value.slice(0, 1024)); return true;
    case "IP_FORWARD": status.ipForwarding = value === "1"; return true;
    default: return false;
  }
}

function applyRuleStatus(status: EdgeNatStatusFields, kind: string, value: string): void {
  switch (kind) {
    case "MANAGED_RULES": status.managedRules = Math.max(0, Number.parseInt(value, 10) || 0); break;
    case "APPLIED_REVISION": status.appliedRevision = Math.max(0, Number.parseInt(value, 10) || 0); break;
    case "APPLIED_HASH": if (/^[0-9a-f]{64}$/.test(value)) status.appliedHash = value; break;
    case "IPTABLES_HASH": if (/^[0-9a-f]{64}$/.test(value)) status.iptablesHash = value; break;
    case "RULESET_DRIFT": status.rulesetDrift = value === "1"; break;
  }
}

export function parseEdgeNatStatus(stdout: string, baseUrl: string) {
  const lines = stdout.split(/\r?\n/);
  if (lines.shift() !== "POLYSIEM_EDGE_STATUS_V1") throw new Error("Edge helper returned an unsupported status response");
  const status: EdgeNatStatusFields = {
    hostname: "edge-nat", kernel: "unknown", ipForwarding: false, managedRules: 0,
    appliedRevision: 0, appliedHash: null, iptablesHash: null, rulesetDrift: false,
    addresses: [], routes: [],
  };
  lines.forEach((line) => applyStatusLine(status, line));
  const { host } = parseEdgeSshUrl(baseUrl);
  return edgeNatSnapshotSchema.parse({
    capturedAt: new Date().toISOString(), hostname: status.hostname, kernel: status.kernel,
    publicIp: isIP(host) ? host : null,
    addresses: status.addresses, routes: status.routes, ipForwarding: status.ipForwarding,
    managedRules: status.managedRules, appliedRevision: status.appliedRevision,
    appliedHash: status.appliedHash, iptablesHash: status.iptablesHash, rulesetDrift: status.rulesetDrift,
  });
}

/**
 * Live WireGuard tunnel status parsed from the STATUS response. Surfaced
 * separately from the NAT snapshot (whose schema is orchestrator-owned and
 * carries no tunnel fields). No private material is ever included — the public
 * key reported here is the edge host's OWN public key, which is safe to show.
 */
export interface EdgeWireguardStatus {
  interfaceName: string | null;
  enabled: boolean;
  publicKey: string | null;
  listenPort: number | null;
  peers: number;
  latestHandshakeAt: string | null;
}

/**
 * Parse the optional WG_* STATUS lines emitted by a tunnel-aware edge agent.
 * Returns null when a legacy agent emits no WG_* lines at all; otherwise returns
 * the status object (with `enabled: false` when the box reports WG_ENABLED 0).
 */
/**
 * One parser per WG_* STATUS key. A Map (not an object literal) so a hostile
 * status line naming `constructor` or `__proto__` cannot resolve to anything.
 * Each parser validates its own field and leaves the default in place on junk.
 */
const WG_STATUS_PARSERS = new Map<string, (value: string, status: EdgeWireguardStatus) => void>([
  ["WG_IF", (value, status) => {
    if (/^[A-Za-z0-9_.:-]{1,15}$/.test(value)) status.interfaceName = value;
  }],
  ["WG_ENABLED", (value, status) => {
    status.enabled = value === "1";
  }],
  ["WG_PUBKEY", (value, status) => {
    if (wireguardKeyRegex.test(value)) status.publicKey = value;
  }],
  ["WG_LISTEN", (value, status) => {
    const port = Number.parseInt(value, 10);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) status.listenPort = port;
  }],
  ["WG_PEERS", (value, status) => {
    status.peers = Math.max(0, Number.parseInt(value, 10) || 0);
  }],
  ["WG_LATEST_HANDSHAKE", (value, status) => {
    const epoch = Number.parseInt(value, 10);
    status.latestHandshakeAt = Number.isFinite(epoch) && epoch > 0
      ? new Date(epoch * 1000).toISOString()
      : null;
  }],
]);

export function parseEdgeNatWireguardStatus(stdout: string): EdgeWireguardStatus | null {
  const status: EdgeWireguardStatus = {
    interfaceName: null, enabled: false, publicKey: null,
    listenPort: null, peers: 0, latestHandshakeAt: null,
  };
  let seen = false;
  for (const line of stdout.split(/\r?\n/)) {
    const [kind, ...rest] = line.split("\t");
    const parse = WG_STATUS_PARSERS.get(kind);
    if (!parse) continue;
    seen = true;
    parse(rest.join("\t").trim(), status);
  }
  return seen ? status : null;
}

export interface EdgeNatStatusReport {
  snapshot: EdgeNatSnapshot;
  wireguard: EdgeWireguardStatus | null;
}

export interface EdgeApplyAcknowledgement {
  count: number;
  revision: number;
  hash: string;
}

export function parseEdgeApplyResponse(stdout: string): EdgeApplyAcknowledgement | null {
  const match = /^APPLIED\t(\d+)\t(\d+)\t([0-9a-f]{64})$/m.exec(stdout);
  if (!match) return null;
  const count = Number(match[1]);
  const revision = Number(match[2]);
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(revision) || revision < 1) return null;
  return { count, revision, hash: match[3] };
}

export async function fetchEdgeNatStatusReport(cfg: DriverConfig, runner?: CommandRunner): Promise<EdgeNatStatusReport> {
  const result = await runVerifiedSsh(cfg, "STATUS", undefined, runner);
  if (result.code !== 0) throw new Error(connectionError(result.stderr));
  return {
    snapshot: parseEdgeNatStatus(result.stdout, cfg.baseUrl),
    wireguard: parseEdgeNatWireguardStatus(result.stdout),
  };
}

export async function fetchEdgeNatSnapshot(cfg: DriverConfig, runner?: CommandRunner) {
  return (await fetchEdgeNatStatusReport(cfg, runner)).snapshot;
}

export async function testEdgeNatConnection(cfg: DriverConfig, runner?: CommandRunner): Promise<TestResult> {
  const settings: EdgeNatSettings = edgeNatSettingsSchema.parse(cfg.settings);
  if (!settings.hostKeyFingerprint) {
    return {
      ok: false,
      detail: "Key generated, but SSH is not enrolled yet. Install the restricted helper, then scan and confirm the server host-key fingerprint out of band.",
    };
  }
  try {
    const snapshot = await fetchEdgeNatSnapshot(cfg, runner);
    return {
      ok: true,
      detail: `Connected securely to ${snapshot.hostname}; restricted Edge helper is responding (${snapshot.managedRules} managed NAT rules)`,
      version: snapshot.kernel,
    };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
