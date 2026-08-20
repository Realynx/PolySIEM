"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { edgeCardCountLabel } from "./cloudflare-presentation";

/**
 * The one control that collapses an edge card.
 *
 * Shared by the SSH edge boxes and the Cloudflare tunnels so the two tabs are
 * the same feature rather than two similar ones. It always carries the card's
 * route count, because that — with the name, the status badge, and the sync line
 * that stay in the header — is what a collapsed card has to answer.
 */
export function EdgeCardCollapseTrigger({
  expanded,
  count,
  /** Singular noun for what the card holds. Both tabs currently count routes. */
  noun = "route",
  /** The card's name, so the control is unambiguous to a screen reader. */
  name,
}: {
  expanded: boolean;
  count: number;
  noun?: string;
  name: string;
}) {
  const countLabel = edgeCardCountLabel(count, noun);
  return (
    <CollapsibleTrigger asChild>
      <Button
        variant="ghost"
        size="sm"
        title={expanded ? `Hide ${name} details` : `Show ${name} details`}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${name} · ${countLabel}`}
      >
        <span className="tabular-nums">{countLabel}</span>
        <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} aria-hidden="true" />
      </Button>
    </CollapsibleTrigger>
  );
}
