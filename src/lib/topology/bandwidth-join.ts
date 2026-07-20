/**
 * Pure client-side joins between live bandwidth data (/api/bandwidth) and the
 * topology maps. Rule rates join reachability edges via the rule uuids the
 * edges already aggregate (AccessEdgeRule.externalId = FirewallRule.externalId
 * = the pf counter label); interface rates join networks by OPNsense interface
 * key / synced network name.
 */

/** Sum the live rates of the rules an edge aggregates (uuid-deduped). */
export function edgeRateBps(
  rules: { externalId: string | null }[],
  ruleRates: Map<string, number>,
): number {
  let total = 0;
  const seen = new Set<string>();
  for (const rule of rules) {
    if (!rule.externalId || seen.has(rule.externalId)) continue;
    seen.add(rule.externalId);
    total += ruleRates.get(rule.externalId) ?? 0;
  }
  return total;
}

/**
 * Subtle two-step stroke widening by rate — busy paths read heavier without
 * turning the map into a weighted graph.
 */
export function rateStrokeBonus(bps: number): number {
  if (bps >= 5_000_000) return 1;
  if (bps >= 100_000) return 0.5;
  return 0;
}
