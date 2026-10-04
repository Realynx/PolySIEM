"use client";

import { useState } from "react";
import { Check, ChevronDown, CircleAlert, CircleCheck, CircleHelp, CirclePause, Clock, Loader2, Trash2, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/ssh/copy-button";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { edgeReconciliation, type EdgeNatServer } from "./edge-networks-types";
import {
  edgeSyncFacts,
  edgeSyncSummary,
  type EdgeSyncFact,
  type EdgeSyncSummary,
  type EdgeSyncTone,
} from "./edge-sync-presentation";

const SYNC_TONES: Record<EdgeSyncTone, { icon: LucideIcon; frame: string; text: string }> = {
  synced: { icon: CircleCheck, frame: "border-border bg-muted/20", text: "text-success" },
  staged: { icon: Clock, frame: "border-primary/30 bg-primary/5", text: "text-primary" },
  drifted: { icon: CircleAlert, frame: "border-destructive/30 bg-destructive/5", text: "text-destructive" },
  unknown: { icon: CircleHelp, frame: "border-border bg-muted/20", text: "text-muted-foreground" },
  disabled: { icon: CirclePause, frame: "border-border bg-muted/20", text: "text-muted-foreground" },
  cleanup: { icon: TriangleAlert, frame: "border-destructive/30 bg-destructive/5", text: "text-destructive" },
};

/**
 * What replaced `Desired vs. remote-applied state`.
 *
 * The old block gave the top third of the card to a revision number and two
 * sha256 hashes — debugging evidence no operator decision depends on. This says
 * the same thing in one sentence, puts the button that resolves it right there,
 * and keeps every original field one click away under Sync details.
 */
export function EdgeSyncBar({
  server,
  isAdmin,
  applying,
  onApply,
  onClear,
}: {
  server: EdgeNatServer;
  isAdmin: boolean;
  applying: boolean;
  onApply: () => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = edgeSyncSummary(server);
  const tone = SYNC_TONES[summary.tone];
  const Icon = tone.icon;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("rounded-lg border", tone.frame)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3">
        <div className="flex min-w-0 items-start gap-2">
          <Icon className={cn("mt-0.5 size-4 shrink-0", tone.text)} aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{summary.headline}</p>
            <p className="text-xs text-muted-foreground">{summary.detail}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              Sync details
              <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          {isAdmin && (
            <EdgeSyncAction server={server} summary={summary} applying={applying} onApply={onApply} onClear={onClear} />
          )}
        </div>
      </div>
      <CollapsibleContent>
        <EdgeSyncDetails server={server} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The single primary action, sitting beside the sentence that motivates it. */
function EdgeSyncAction({
  server,
  summary,
  applying,
  onApply,
  onClear,
}: {
  server: EdgeNatServer;
  summary: EdgeSyncSummary;
  applying: boolean;
  onApply: () => void;
  onClear: () => void;
}) {
  if (!server.enabled) {
    if (!edgeReconciliation(server).cleanupRequired) return null;
    return <Button variant="destructive" size="sm" onClick={onClear}><Trash2 /> {summary.actionLabel}</Button>;
  }
  return (
    <Button
      size="sm"
      variant={summary.actionUrgent ? "default" : "outline"}
      disabled={applying || !server.hostKeyEnrolled}
      title={server.hostKeyEnrolled ? undefined : "Finish SSH enrollment before applying rules"}
      onClick={onApply}
    >
      {applying ? <Loader2 className="animate-spin" /> : <Check />}{summary.actionLabel}
    </Button>
  );
}

/** Tier 4: revisions, hashes, counts, the forwarding flag, the pinned key. */
function EdgeSyncDetails({ server }: { server: EdgeNatServer }) {
  return (
    <div className="space-y-2 border-t p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {edgeSyncFacts(server).map((fact) => <SyncDetailFact key={fact.label} fact={fact} />)}
      </div>
      <p className="text-xs text-muted-foreground">
        Revisions and ruleset hashes are the evidence behind the line above: PolySIEM keeps what it observed on the relay
        separate from what is saved here, and compares the two. They are useful when a state looks wrong.
      </p>
    </div>
  );
}

function SyncDetailFact({ fact }: { fact: EdgeSyncFact }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{fact.label}</p>
      <div className="flex items-center gap-1">
        <p className={cn("mt-0.5 min-w-0 flex-1 truncate font-medium", fact.mono && "font-mono text-xs")}>{fact.value}</p>
        {fact.copy && <CopyButton value={fact.copy} label={`Copy ${fact.label.toLowerCase()}`} />}
      </div>
    </div>
  );
}
