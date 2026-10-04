"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Globe, House, PlugZap, Server, Waypoints, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  RELAY_EXPLAINER,
  RELAY_EXPLAINER_DETAIL,
  RELAY_PATH_TEMPLATE,
  type RelayHop,
  type RelayHopId,
  type RelayTone,
} from "./edge-relay-presentation";
import { EDGE_TRAFFIC_PATH_CAVEAT, EDGE_TRAFFIC_PATH_STEPS } from "./edge-sync-presentation";

const HOP_ICONS: Record<RelayHopId, LucideIcon> = {
  internet: Globe,
  relay: Server,
  tunnel: Waypoints,
  connector: PlugZap,
  service: House,
};

export const RELAY_TONE_DOT: Record<RelayTone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  idle: "bg-muted-foreground/40",
};

const TONE_TEXT: Record<RelayTone, string> = {
  ok: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  idle: "text-muted-foreground",
};

const TONE_WORD: Record<RelayTone, string> = {
  ok: "working",
  warn: "needs attention",
  bad: "failing",
  idle: "not in use",
};

export function RelayToneDot({ tone, className }: { tone: RelayTone; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", RELAY_TONE_DOT[tone], className)} aria-hidden="true" />;
}

type PathHop = Pick<RelayHop, "id" | "label" | "value"> & Partial<Pick<RelayHop, "status" | "tone">>;

/**
 * Internet → relay server → relay tunnel → connector → your services.
 *
 * With live hops it doubles as the server's health: each node carries its own
 * state, so "is it working, and where does it break" is one glance. Without
 * them (the explainer, the empty page) it is just the picture of how relaying
 * works. Five columns on wide screens; a vertical list on a phone.
 */
export function RelayPathDiagram({ hops, className }: { hops: readonly PathHop[]; className?: string }) {
  return (
    <ol className={cn("grid gap-1.5 md:grid-cols-5 md:gap-0", className)} aria-label="Relay path">
      {hops.map((hop, index) => (
        <RelayPathNode key={hop.id} hop={hop} last={index === hops.length - 1} />
      ))}
    </ol>
  );
}

function RelayPathNode({ hop, last }: { hop: PathHop; last: boolean }) {
  const Icon = HOP_ICONS[hop.id];
  const live = hop.tone !== undefined;
  const label = live ? `${hop.label}: ${hop.value}, ${hop.status} (${TONE_WORD[hop.tone!]})` : `${hop.label}: ${hop.value}`;
  return (
    <li className="relative flex min-w-0 items-center md:pr-4" aria-label={label}>
      <div className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg border bg-card px-3 py-2">
        <span className="relative mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-3.5" aria-hidden="true" />
          {live && <RelayToneDot tone={hop.tone!} className="absolute -right-0.5 -top-0.5 ring-2 ring-card" />}
        </span>
        <span className="min-w-0" aria-hidden="true">
          <span className="block text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">{hop.label}</span>
          <span className="block truncate text-sm font-medium" title={hop.value}>{hop.value}</span>
          {live && <span className={cn("block truncate text-xs", TONE_TEXT[hop.tone!])} title={hop.status}>{hop.status}</span>}
        </span>
      </div>
      {!last && (
        <ChevronRight
          className="absolute right-0 top-1/2 hidden size-4 -translate-y-1/2 text-muted-foreground/60 md:block"
          aria-hidden="true"
        />
      )}
    </li>
  );
}

/**
 * The same health, sized for a phone: the four hops after "Internet" as a 2×2
 * grid of dot + label + status, instead of a five-card vertical stack.
 */
export function RelayPathCompact({ hops, className }: { hops: readonly RelayHop[]; className?: string }) {
  return (
    <ul className={cn("grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border bg-card p-3", className)} aria-label="Relay path health">
      {hops.filter((hop) => hop.id !== "internet").map((hop) => (
        <li key={hop.id} className="flex min-w-0 items-start gap-2" aria-label={`${hop.label}: ${hop.value}, ${hop.status} (${TONE_WORD[hop.tone]})`}>
          <RelayToneDot tone={hop.tone} className="mt-1.5" />
          <span className="min-w-0" aria-hidden="true">
            <span className="block truncate text-xs font-medium">{hop.label}</span>
            <span className={cn("block truncate text-[11px]", TONE_TEXT[hop.tone])}>{hop.status}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The TURN-style one-liner, always visible, with the full picture one click
 * away. Replaces the bare "How this works" text list.
 */
export function RelayExplainer({ defaultOpen = false, className }: { defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("rounded-lg border bg-muted/20", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{RELAY_EXPLAINER}</p>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="shrink-0">
            How relaying works
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <RelayExplainerBody />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function RelayExplainerBody({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3 border-t p-3", className)}>
      <RelayPathDiagram hops={RELAY_PATH_TEMPLATE} />
      <p className="text-sm text-muted-foreground">{RELAY_EXPLAINER_DETAIL}</p>
      <ol className="grid gap-2 sm:grid-cols-3">
        {EDGE_TRAFFIC_PATH_STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-2.5 text-sm">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.6875rem] font-medium text-primary">
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className="font-medium">{step.title}</span>
              <span className="block text-xs text-muted-foreground">{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">{EDGE_TRAFFIC_PATH_CAVEAT}</p>
    </div>
  );
}
