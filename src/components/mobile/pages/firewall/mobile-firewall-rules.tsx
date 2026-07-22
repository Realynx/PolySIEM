"use client";

import { useMemo, useState } from "react";
import { ShieldCheck, SlidersHorizontal, StickyNote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useUrlFilters } from "@/components/shared/use-url-filters";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty, MobileKeyRow, MobileList } from "@/components/mobile/ui/mobile-list";
import { MobileSearchBar } from "@/components/mobile/ui/mobile-search-bar";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import type { FirewallAliasDto, FirewallRuleDto } from "@/components/integrations-sync/rules-explorer";
import { cn } from "@/lib/utils";
import { filterFirewallRules, firewallInterfaceNames, referencedFirewallAliases } from "@/components/integrations-sync/firewall-rule-model";

const ACTION_STYLES: Record<FirewallRuleDto["action"], string> = {
  PASS: "border-success/40 bg-success/10 text-success",
  BLOCK: "border-destructive/40 bg-destructive/10 text-destructive",
  REJECT: "border-warning/40 bg-warning/10 text-warning",
};

const ACTION_OPTIONS = ["all", "PASS", "BLOCK", "REJECT"] as const;

function ActionBadge({ action }: { action: FirewallRuleDto["action"] }) {
  return (
    <Badge variant="outline" className={cn("w-14 justify-center font-mono text-[10px]", ACTION_STYLES[action])}>
      {action}
    </Badge>
  );
}

/** One dense tappable rule row: action badge, src→dst stacked mono, proto/port trailing. */
function RuleRow({ rule, onOpen }: { rule: FirewallRuleDto; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex min-h-13 w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors active:bg-muted/70",
        !rule.enabled && "opacity-50",
      )}
    >
      <ActionBadge action={rule.action} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs leading-snug">{rule.sourceSpec ?? "any"}</div>
        <div className="truncate font-mono text-xs leading-snug text-muted-foreground">
          → {rule.destSpec ?? "any"}
          {rule.destPort ? `:${rule.destPort}` : ""}
        </div>
        {(rule.descriptionText || rule.direction) && (
          <div className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
            {[rule.direction, rule.descriptionText].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="font-mono text-[11px] text-muted-foreground">{rule.protocol ?? "any"}</span>
        <span className="flex items-center gap-1">
          {!rule.enabled && (
            <Badge variant="outline" className="text-[9px] text-muted-foreground">
              off
            </Badge>
          )}
          {rule.annotation && <StickyNote className="size-3 text-info" aria-label="Has annotation" />}
        </span>
      </div>
    </button>
  );
}

/** Full rule details for the tap-through bottom sheet: every desktop column. */
function RuleDetailSheet({
  rule,
  aliases,
  onOpenChange,
}: {
  rule: FirewallRuleDto | null;
  aliases: Map<string, FirewallAliasDto>;
  onOpenChange: (open: boolean) => void;
}) {
  const referencedAliases = referencedFirewallAliases(rule, aliases);
  return (
    <BottomSheet
      open={rule !== null}
      onOpenChange={onOpenChange}
      title={rule?.descriptionText || "Firewall rule"}
      description={rule ? `${rule.action} · ${rule.interfaceName ?? "any interface"}` : undefined}
    >
      {rule && (
        <div className="flex flex-col gap-3 pb-2">
          <div className="divide-y divide-border/60 rounded-xl border bg-card">
            <MobileKeyRow label="Action">
              <ActionBadge action={rule.action} />
            </MobileKeyRow>
            <MobileKeyRow label="Sequence" mono>
              {rule.sequence ?? "—"}
            </MobileKeyRow>
            <MobileKeyRow label="Interface">{rule.interfaceName ?? "Unassigned"}</MobileKeyRow>
            <MobileKeyRow label="Direction">{rule.direction ?? "—"}</MobileKeyRow>
            <MobileKeyRow label="Protocol" mono>
              {rule.protocol ?? "any"}
            </MobileKeyRow>
            <MobileKeyRow label="Source" mono>
              {rule.sourceSpec ?? "any"}
            </MobileKeyRow>
            <MobileKeyRow label="Destination" mono>
              {rule.destSpec ?? "any"}
            </MobileKeyRow>
            <MobileKeyRow label="Port" mono>
              {rule.destPort ?? "any"}
            </MobileKeyRow>
            <MobileKeyRow label="Enabled">{rule.enabled ? "Yes" : "No"}</MobileKeyRow>
            <MobileKeyRow label="Status">{rule.status}</MobileKeyRow>
          </div>
          {rule.annotation && (
            <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info/5 p-3 text-[13px]">
              <StickyNote className="mt-0.5 size-4 shrink-0 text-info" />
              <p className="whitespace-pre-wrap">{rule.annotation}</p>
            </div>
          )}
          {referencedAliases.map(({ label, alias }) => (
            <div key={`${label}-${alias.name}`} className="rounded-xl border bg-card p-3">
              <p className="text-xs text-muted-foreground">
                {label} alias <span className="font-mono">{alias.name}</span> ({alias.aliasType ?? "?"})
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {alias.content.map((entry) => (
                  <Badge key={entry} variant="outline" className="font-mono text-[11px]">
                    {entry}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}

/** Phone rules explorer: URL-synced search + filter sheet, interface groups, detail sheet. */
export function MobileFirewallRules({
  rules,
  aliases,
}: {
  rules: FirewallRuleDto[];
  aliases: FirewallAliasDto[];
}) {
  const { searchParams, apply } = useUrlFilters();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<FirewallRuleDto | null>(null);

  const q = searchParams.get("q") ?? "";
  const iface = searchParams.get("iface") ?? "all";
  const action = searchParams.get("action") ?? "all";
  const activeFilters = (iface !== "all" ? 1 : 0) + (action !== "all" ? 1 : 0);

  const aliasMap = useMemo(() => new Map(aliases.map((a) => [a.name, a])), [aliases]);
  const interfaceNames = useMemo(
    () => firewallInterfaceNames(rules),
    [rules],
  );

  const filtered = useMemo(
    () => filterFirewallRules(rules, { iface, action, query: q }),
    [rules, iface, action, q],
  );

  const groups = useMemo(() => {
    const map = new Map<string, FirewallRuleDto[]>();
    for (const rule of filtered) {
      const key = rule.interfaceName ?? "Unassigned";
      const list = map.get(key) ?? [];
      list.push(rule);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <MobilePage>
      <MobileSearchBar placeholder="Search rules…">
        <button
          type="button"
          aria-label="Filter rules"
          onClick={() => setFiltersOpen(true)}
          className={cn(
            "relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground active:bg-muted/70",
            activeFilters > 0 && "text-primary",
          )}
        >
          <SlidersHorizontal className="size-4" />
          {activeFilters > 0 && (
            <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
              {activeFilters}
            </span>
          )}
        </button>
      </MobileSearchBar>

      <p className="px-0.5 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
        {filtered.length} of {rules.length} rules
      </p>

      {groups.length === 0 ? (
        <MobileEmpty
          icon={<ShieldCheck />}
          title="No rules match"
          description="Try a different search, interface, or action filter."
        />
      ) : (
        groups.map(([name, groupRules]) => (
          <MobileSection key={name} title={`${name} · ${groupRules.length}`}>
            <MobileList>
              {groupRules.map((rule) => (
                <RuleRow key={rule.id} rule={rule} onOpen={() => setSelected(rule)} />
              ))}
            </MobileList>
          </MobileSection>
        ))
      )}

      <RuleDetailSheet rule={selected} aliases={aliasMap} onOpenChange={(open) => !open && setSelected(null)} />

      <BottomSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="Filter rules"
        description="Same filters as the desktop toolbar."
      >
        <div className="flex flex-col gap-4 pb-2">
          <div>
            <p className="mb-1.5 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Action</p>
            <div className="flex rounded-lg bg-muted p-0.5">
              {ACTION_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => apply({ action: option === "all" ? null : option })}
                  className={cn(
                    "flex h-8 flex-1 items-center justify-center rounded-md text-[13px] font-medium transition-colors",
                    action === option
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground active:text-foreground",
                  )}
                >
                  {option === "all" ? "All" : option.charAt(0) + option.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Interface</p>
            <div className="divide-y divide-border/60 overflow-hidden rounded-xl border bg-card">
              {["all", ...interfaceNames].map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => apply({ iface: name === "all" ? null : name })}
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[13px] active:bg-muted/70"
                >
                  <span className={cn(iface === name && "font-medium text-primary")}>
                    {name === "all" ? "All interfaces" : name}
                  </span>
                  {iface === name && <span className="size-2 rounded-full bg-primary" />}
                </button>
              ))}
            </div>
          </div>
          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => apply({ iface: null, action: null })}
              className="h-10 w-full rounded-xl bg-muted text-[13px] font-medium text-muted-foreground active:bg-muted/70"
            >
              Clear filters
            </button>
          )}
        </div>
      </BottomSheet>
    </MobilePage>
  );
}
