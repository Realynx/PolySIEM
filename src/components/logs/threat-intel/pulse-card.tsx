"use client";

import { Check, Clock3, Crosshair, Tag, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import type { ThreatIntelPulseView } from "@/lib/types";
import { TlpBadge } from "./tlp-badge";

const TAG_CAP = 6;

/** One pulse in the feed list — click opens the detail sheet. */
export function PulseCard({
  pulse,
  selected,
  onSelect,
}: {
  pulse: ThreatIntelPulseView;
  selected: boolean;
  onSelect: () => void;
}) {
  const unread = pulse.readAt === null;

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`${unread ? "Unread report: " : "Read report: "}${pulse.name}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "relative cursor-pointer py-4 transition-all hover:-translate-y-px hover:ring-primary/30 hover:shadow-sm",
        unread && "bg-gradient-to-r from-primary/[0.08] via-card to-card ring-primary/25",
        selected && "ring-2 ring-primary/55",
      )}
    >
      {unread && <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden />}
      <CardContent className="space-y-2.5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              {unread ? (
                <Badge className="border-primary/25 bg-primary/10 px-1.5 text-[0.62rem] text-primary hover:bg-primary/10">
                  <span className="size-1.5 rounded-full bg-primary" aria-hidden />
                  New
                </Badge>
              ) : (
                <span className="inline-flex items-center gap-1 text-[0.65rem] text-muted-foreground">
                  <Check className="size-3" aria-hidden /> Read
                </span>
              )}
              <TlpBadge tlp={pulse.tlp} className="text-[0.65rem]" />
            </div>
            <p className={cn("leading-snug", unread ? "font-semibold" : "font-medium")}>{pulse.name}</p>
          </div>
        </div>

        {pulse.description && (
          <p className="line-clamp-2 max-w-5xl text-xs leading-relaxed text-muted-foreground">
            {pulse.description}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <UserRound className="size-3.5" />
            {pulse.author}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="size-3.5" />
            updated {formatRelative(pulse.modified)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-muted/70 px-1.5 py-0.5 font-medium text-foreground tabular-nums">
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
            <span className="ml-auto hidden rounded-md bg-muted/60 px-2 py-1 font-mono text-[0.65rem] text-muted-foreground sm:inline">
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
