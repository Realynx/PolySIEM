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
