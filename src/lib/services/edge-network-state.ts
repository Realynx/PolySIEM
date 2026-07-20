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

export function deriveEdgeLifecycle(input: EdgeLifecycleInput) {
  const remoteRuleCount = Math.max(input.appliedRuleCount, input.snapshotManagedRules ?? 0);
  const remoteDrift = input.snapshotRulesetDrift === true ||
    (input.snapshotAppliedHash === null && (input.snapshotAppliedRevision ?? 0) > 0 && input.appliedRulesHash !== null) || Boolean(
    input.snapshotAppliedHash && input.appliedRulesHash && input.snapshotAppliedHash !== input.appliedRulesHash,
  );
  const desiredDrift = input.desiredRulesHash !== input.appliedRulesHash;
  const reconciliation = remoteDrift
    ? "drifted"
    : input.pendingChanges || desiredDrift
      ? "pending"
      : input.appliedRulesHash || input.snapshotAppliedHash
        ? "in_sync"
        : "unknown";
  const cleanupRequired = !input.enabled && remoteRuleCount > 0;
  const lifecycleState = cleanupRequired
    ? "disabled_with_live_rules"
    : !input.enabled
      ? "disabled_clean"
      : reconciliation === "drifted"
        ? "drift"
        : reconciliation === "pending"
          ? "pending"
          : "active";
  return {
    remoteRuleCount,
    drift: reconciliation,
    hasDrift: remoteDrift || desiredDrift,
    reconciliation,
    cleanupRequired,
    lifecycleState,
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
