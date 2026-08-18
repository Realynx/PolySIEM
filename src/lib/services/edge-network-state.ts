import type { WireguardTunnel } from "@/lib/validators/integrations";

/**
 * Ready-to-paste values for the HOME (OPNsense) side of the tunnel, derived
 * entirely from the edge tunnel settings. The edge is the LISTENER, so OPNsense
 * needs the edge's public key, its `host:listenPort` endpoint, the tunnel
 * addressing, a suggested local address (the `.2` host of the edge /24), and the
 * AllowedIPs to assign the edge peer (the edge tunnel address as a `/32`).
 * The private key is never part of this shape.
 */
export interface EdgeWireguardPeerConfig {
  edgePublicKey: string | null;
  edgeEndpoint: string;
  edgeAddress: string;
  recommendedOpnsenseAddress: string;
  allowedIps: string[];
}

function edgeTunnelIp(address: string): string {
  return address.split("/")[0];
}

/** Suggest the OPNsense local address as the `.2` host of the edge /24. */
function opnsenseAddressFromEdge(address: string): string {
  const [ip, prefix] = address.split("/");
  const octets = ip.split(".");
  const valid = octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
  if (!valid) return address;
  octets[3] = "2";
  return prefix ? `${octets.join(".")}/${prefix}` : octets.join(".");
}

/** Format a WireGuard endpoint, bracketing IPv6 literals. */
function edgeEndpoint(host: string, listenPort: number): string {
  return host.includes(":") ? `[${host}]:${listenPort}` : `${host}:${listenPort}`;
}

export function deriveEdgeWireguardPeerConfig(host: string, tunnel: WireguardTunnel): EdgeWireguardPeerConfig {
  const ip = edgeTunnelIp(tunnel.address);
  return {
    edgePublicKey: tunnel.publicKey,
    edgeEndpoint: edgeEndpoint(host, tunnel.listenPort),
    edgeAddress: tunnel.address,
    recommendedOpnsenseAddress: opnsenseAddressFromEdge(tunnel.address),
    allowedIps: [`${ip}/32`],
  };
}

export interface EdgeLifecycleInput {
  enabled: boolean;
  pendingChanges: boolean;
  desiredRulesHash: string | null;
  appliedRulesHash: string | null;
  appliedRuleCount: number;
  snapshotManagedRules?: number;
  snapshotAppliedHash?: string | null;
  snapshotAppliedRevision?: number;
  snapshotRulesetDrift?: boolean;
}

function hasRemoteDrift(input: EdgeLifecycleInput): boolean {
  const missingSnapshotHash = input.snapshotAppliedHash === null &&
    (input.snapshotAppliedRevision ?? 0) > 0 && input.appliedRulesHash !== null;
  const mismatchedHash = Boolean(input.snapshotAppliedHash && input.appliedRulesHash &&
    input.snapshotAppliedHash !== input.appliedRulesHash);
  return input.snapshotRulesetDrift === true || missingSnapshotHash || mismatchedHash;
}

function reconciliationState(input: EdgeLifecycleInput, remoteDrift: boolean, desiredDrift: boolean) {
  if (remoteDrift) return "drifted" as const;
  if (input.pendingChanges || desiredDrift) return "pending" as const;
  if (input.appliedRulesHash || input.snapshotAppliedHash) return "in_sync" as const;
  return "unknown" as const;
}

function lifecycleState(enabled: boolean, cleanupRequired: boolean, reconciliation: string) {
  if (cleanupRequired) return "disabled_with_live_rules" as const;
  if (!enabled) return "disabled_clean" as const;
  if (reconciliation === "drifted") return "drift" as const;
  if (reconciliation === "pending") return "pending" as const;
  return "active" as const;
}

export function deriveEdgeLifecycle(input: EdgeLifecycleInput) {
  const remoteRuleCount = Math.max(input.appliedRuleCount, input.snapshotManagedRules ?? 0);
  const remoteDrift = hasRemoteDrift(input);
  const desiredDrift = input.desiredRulesHash !== input.appliedRulesHash;
  const reconciliation = reconciliationState(input, remoteDrift, desiredDrift);
  const cleanupRequired = !input.enabled && remoteRuleCount > 0;
  return {
    remoteRuleCount,
    drift: reconciliation,
    hasDrift: remoteDrift || desiredDrift,
    reconciliation,
    cleanupRequired,
    lifecycleState: lifecycleState(input.enabled, cleanupRequired, reconciliation),
  } as const;
}

export function matchesExpectedEdgeApply(
  acknowledgement: { count: number; revision: number; hash: string } | null,
  expected: { count: number; revision: number; hash: string },
): acknowledgement is { count: number; revision: number; hash: string } {
  return acknowledgement !== null && acknowledgement.count === expected.count &&
    acknowledgement.revision === expected.revision && acknowledgement.hash === expected.hash;
}

export function nextEdgeApplyRevision(rulesRevision: number, appliedRevision: number): number {
  const revision = Math.max(rulesRevision, appliedRevision) + 1;
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 999_999_999) {
    throw new Error("Edge ruleset revision is exhausted");
  }
  return revision;
}
