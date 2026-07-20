import "server-only";
import { isIP } from "node:net";
import type { DriverConfig, TestResult } from "../types";
import { edgeNatSettingsSchema, edgeNatSnapshotSchema, type EdgeNatSettings } from "@/lib/validators/integrations";
import { parseEdgeSshUrl, runVerifiedSsh, type CommandRunner } from "./ssh";

function connectionError(stderr: string): string {
  const value = stderr.trim().replace(/\s+/g, " ").slice(0, 500);
  return value || "SSH connection failed";
}

export function parseEdgeNatStatus(stdout: string, baseUrl: string) {
  const lines = stdout.split(/\r?\n/);
  if (lines.shift() !== "POLYSIEM_EDGE_STATUS_V1") throw new Error("Edge helper returned an unsupported status response");
  let hostname = "edge-nat";
  let kernel = "unknown";
  let ipForwarding = false;
  let managedRules = 0;
  let appliedRevision = 0;
  let appliedHash: string | null = null;
  let iptablesHash: string | null = null;
  let rulesetDrift = false;
  const addresses: string[] = [];
  const routes: string[] = [];
  for (const line of lines) {
    const [kind, ...rest] = line.split("\t");
    const value = rest.join("\t").trim();
    if (kind === "HOSTNAME") hostname = value.slice(0, 253) || hostname;
    else if (kind === "KERNEL") kernel = value.slice(0, 512) || kernel;
    else if (kind === "ADDRESS" && value) addresses.push(value.slice(0, 128));
    else if (kind === "ROUTE" && value) routes.push(value.slice(0, 1024));
    else if (kind === "IP_FORWARD") ipForwarding = value === "1";
    else if (kind === "MANAGED_RULES") managedRules = Math.max(0, Number.parseInt(value, 10) || 0);
    else if (kind === "APPLIED_REVISION") appliedRevision = Math.max(0, Number.parseInt(value, 10) || 0);
    else if (kind === "APPLIED_HASH" && /^[0-9a-f]{64}$/.test(value)) appliedHash = value;
    else if (kind === "IPTABLES_HASH" && /^[0-9a-f]{64}$/.test(value)) iptablesHash = value;
    else if (kind === "RULESET_DRIFT") rulesetDrift = value === "1";
  }
  const { host } = parseEdgeSshUrl(baseUrl);
  return edgeNatSnapshotSchema.parse({
    capturedAt: new Date().toISOString(), hostname, kernel,
    publicIp: isIP(host) ? host : null,
    addresses, routes, ipForwarding, managedRules, appliedRevision, appliedHash,
    iptablesHash, rulesetDrift,
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
