"use client";

import { useMemo, useState } from "react";
import { ListTree } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/badges";
import { useUrlFilters } from "@/components/shared/use-url-filters";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty, MobileKeyRow, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileSearchBar } from "@/components/mobile/ui/mobile-search-bar";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import type { FirewallAliasRow } from "@/components/integrations-sync/aliases-table";

/** Short natural-language preview of an alias's members ("5 entries · a, b…"). */
function memberPreview(content: string[]): string {
  if (content.length === 0) return "No members";
  const label = `${content.length} ${content.length === 1 ? "entry" : "entries"}`;
  const preview = content.slice(0, 2).join(", ");
  return content.length > 2 ? `${label} · ${preview}…` : `${label} · ${preview}`;
}

/** Phone aliases list: search, dense rows, member sheet on tap. */
export function MobileFirewallAliases({ aliases }: { aliases: FirewallAliasRow[] }) {
  const { searchParams } = useUrlFilters();
  const [selected, setSelected] = useState<FirewallAliasRow | null>(null);
  const q = searchParams.get("q") ?? "";

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return aliases;
    return aliases.filter((alias) => {
      const haystack = [alias.name, alias.aliasType, alias.descriptionText, ...alias.content]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [aliases, q]);

  return (
    <MobilePage>
      <MobileSearchBar placeholder="Search aliases…" />

      {filtered.length === 0 ? (
        <MobileEmpty
          icon={<ListTree />}
          title="No aliases match"
          description="Try a different name, type, or member search."
        />
      ) : (
        <MobileList>
          {filtered.map((alias) => (
            <MobileListRow
              key={alias.id}
              onClick={() => setSelected(alias)}
              title={
                <>
                  <span className="truncate font-mono text-[13px]">{alias.name}</span>
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    {alias.aliasType ?? "unknown"}
                  </Badge>
                  <StatusBadge status={alias.status} className="text-[10px]" />
                </>
              }
              subtitle={memberPreview(alias.content)}
              trailing={<span className="tabular-nums">{alias.content.length}</span>}
            />
          ))}
        </MobileList>
      )}

      <BottomSheet
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected?.name ?? "Alias"}
        description={selected?.descriptionText ?? undefined}
      >
        {selected && (
          <div className="flex flex-col gap-3 pb-2">
            <div className="divide-y divide-border/60 rounded-xl border bg-card">
              <MobileKeyRow label="Type">{selected.aliasType ?? "unknown"}</MobileKeyRow>
              <MobileKeyRow label="Status">{selected.status}</MobileKeyRow>
              <MobileKeyRow label="Members">{selected.content.length}</MobileKeyRow>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <p className="mb-1.5 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Members</p>
              {selected.content.length === 0 ? (
                <p className="text-xs text-muted-foreground">This alias has no members.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {selected.content.map((entry) => (
                    <li key={entry} className="font-mono text-xs break-all">
                      {entry}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </BottomSheet>
    </MobilePage>
  );
}
