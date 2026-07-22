import type { FirewallAliasDto, FirewallRuleDto } from "./rules-explorer";

export function referencedFirewallAliases(
  rule: FirewallRuleDto | null,
  aliases: Map<string, FirewallAliasDto>,
): { label: string; alias: FirewallAliasDto }[] {
  if (!rule) return [];
  return ([
    ["Source", rule.sourceSpec],
    ["Destination", rule.destSpec],
    ["Port", rule.destPort],
  ] as const).flatMap(([label, spec]) => {
    const alias = spec ? aliases.get(spec) : undefined;
    return alias ? [{ label, alias }] : [];
  });
}

export function firewallInterfaceNames(rules: FirewallRuleDto[]): string[] {
  return [...new Set(rules.map((rule) => rule.interfaceName ?? "Unassigned"))].sort();
}

export function filterFirewallRules(
  rules: FirewallRuleDto[],
  filters: { iface: string; action: string; query: string },
): FirewallRuleDto[] {
  const needle = filters.query.trim().toLowerCase();
  return rules.filter((rule) => {
    if (filters.iface !== "all" && (rule.interfaceName ?? "Unassigned") !== filters.iface) return false;
    if (filters.action !== "all" && rule.action !== filters.action) return false;
    if (!needle) return true;
    return [rule.descriptionText, rule.sourceSpec, rule.destSpec, rule.destPort, rule.protocol, rule.annotation]
      .some((value) => value?.toLowerCase().includes(needle));
  });
}
