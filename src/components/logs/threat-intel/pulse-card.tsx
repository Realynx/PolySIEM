"use client";

import { Crosshair, Tag, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import type { PulseView } from "@/lib/types";
import { TlpBadge } from "./tlp-badge";

const TAG_CAP = 6;

/** One pulse in the feed list — click opens the detail sheet. */
export function PulseCard({
  pulse,
  selected,
  onSelect,
}: {
  pulse: PulseView;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "cursor-pointer py-4 transition-colors hover:border-primary/40",
        selected && "border-primary/60",
      )}
    >
      <CardContent className="space-y-2.5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <p className="min-w-0 flex-1 font-medium leading-snug">{pulse.name}</p>
          <TlpBadge tlp={pulse.tlp} className="text-[0.65rem]" />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <UserRound className="size-3.5" />
            {pulse.author}
          </span>
          <span>updated {formatRelative(pulse.modified)}</span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Crosshair className="size-3.5" />
            {pulse.indicatorCount.toLocaleString()} indicator{pulse.indicatorCount === 1 ? "" : "s"}
          </span>
          {pulse.adversary && <span>adversary: {pulse.adversary}</span>}
          {pulse.malwareFamilies.length > 0 && <span>{pulse.malwareFamilies.slice(0, 3).join(", ")}</span>}
        </div>

        {(pulse.tags.length > 0 || pulse.indicatorTypeCounts.length > 0) && (
          <div className="flex flex-wrap items-center gap-1">
            {pulse.tags.slice(0, TAG_CAP).map((tag) => (
              <Badge key={tag} variant="outline" className="gap-1 text-[0.65rem] text-muted-foreground">
                <Tag className="size-2.5" />
                {tag}
              </Badge>
            ))}
            {pulse.tags.length > TAG_CAP && (
              <span className="text-[0.65rem] text-muted-foreground">+{pulse.tags.length - TAG_CAP}</span>
            )}
            <span className="ml-auto hidden font-mono text-[0.65rem] text-muted-foreground sm:inline">
              {pulse.indicatorTypeCounts
                .slice(0, 3)
                .map((t) => `${t.type} ×${t.count}`)
                .join(" · ")}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
