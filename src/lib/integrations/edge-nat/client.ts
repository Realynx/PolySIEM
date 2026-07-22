import "server-only";
import { isIP } from "node:net";
import type { DriverConfig, TestResult } from "../types";
import { edgeNatSettingsSchema, edgeNatSnapshotSchema, type EdgeNatSettings } from "@/lib/validators/integrations";
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

export async function fetchEdgeNatSnapshot(cfg: DriverConfig, runner?: CommandRunner) {
  const result = await runVerifiedSsh(cfg, "STATUS", undefined, runner);
  if (result.code !== 0) throw new Error(connectionError(result.stderr));
  return parseEdgeNatStatus(result.stdout, cfg.baseUrl);
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
