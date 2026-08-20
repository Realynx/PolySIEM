"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { edgeCardCountLabel } from "@/components/network/cloudflare-presentation";

/**
 * Collapse and expand for a repeated edge card, on a phone.
 *
 * Several of these cards share one screen — edge boxes on the SSH tab, tunnels
 * on the Cloudflare tab — so both tabs get the same control and the same
 * default, and the page never grows past what a thumb can scroll.
 *
 * Desktop hangs the count off a small ghost button beside the card's actions. A
 * 412px header has no room for a second control up there, so here the card's
 * identity row *is* the control: a full-width 52px target with the count and the
 * chevron trailing it. Collapsed, that row still answers the three questions the
 * desktop trigger guarantees — what is this, what state is it in, and how many
 * routes does it carry.
 *
 * The default (open while there are few cards, closed once there are many) is
 * `edgeCardsStartExpanded` from `network/cloudflare-presentation`, shared with
 * desktop so one threshold governs both surfaces.
 */
export function MobileCollapseCard({
  open,
  onOpenChange,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={cn("flex flex-col gap-1.5", className)}>
      {children}
    </Collapsible>
  );
}

/**
 * The always-visible head. Sits inside a `MobileList` so it reads as the card's
 * first row, and carries the count the way the desktop trigger does.
 */
export function MobileCollapseHead({
  expanded,
  name,
  badge,
  subtitle,
  count,
  /** Singular noun for what the card holds. Both tabs currently count routes. */
  noun = "route",
}: {
  expanded: boolean;
  name: string;
  /** State at a glance — the badge stays readable while the card is closed. */
  badge?: ReactNode;
  subtitle?: ReactNode;
  count: number;
  noun?: string;
}) {
  const countLabel = edgeCardCountLabel(count, noun);
  return (
    <CollapsibleTrigger asChild>
      <button
        type="button"
        aria-label={`${expanded ? "Collapse" : "Expand"} ${name} · ${countLabel}`}
        className="flex min-h-13 w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors active:bg-muted/70"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm leading-tight font-medium">
            <span className="truncate">{name}</span>
            {badge}
          </span>
          {subtitle != null && (
            <span className="mt-0.5 block truncate text-xs leading-tight text-muted-foreground">{subtitle}</span>
          )}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{countLabel}</span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground/60 transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>
    </CollapsibleTrigger>
  );
}

/**
 * Everything the head hides, laid out with the same gap as the sections it
 * replaces. The layout lives on an inner element because Radix hides the content
 * with the `hidden` attribute, and a `display` utility on that same element is
 * an argument not worth having.
 */
export function MobileCollapseBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <CollapsibleContent>
      <div className={cn("flex flex-col gap-1.5", className)}>{children}</div>
    </CollapsibleContent>
  );
}
