"use client";

import { Button } from "@/components/ui/button";
import type { RelaySetupAction, RelaySetupProgress } from "@/components/network/edge-relay-presentation";

/**
 * The phone's version of the desktop setup checklist: progress plus the ONE
 * next step and its button. The full five-step list would push the card's
 * actual content off the first screen.
 *
 * SSH trust needs a terminal and a fingerprint comparison, so on a phone that
 * step says where to finish it instead of offering a button.
 */
export function MobileRelaySetupNext({
  progress,
  isAdmin,
  onAction,
}: {
  progress: RelaySetupProgress;
  isAdmin: boolean;
  onAction: (action: RelaySetupAction) => void;
}) {
  const next = progress.next;
  if (!next) return null;
  const percent = Math.round((progress.completed / progress.total) * 100);
  const actionable = isAdmin && next.action !== "ssh" && next.action !== "apply";
  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-3" aria-label="Setup progress">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
          Setup · {progress.completed} of {progress.total}
        </p>
        <div
          className="h-1 w-20 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.completed}
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <p className="mt-1.5 text-sm font-medium">Next: {next.title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {next.action === "ssh" ? "Needs a terminal and a fingerprint check. Finish it from the desktop view." : next.detail}
      </p>
      {actionable && (
        <Button size="sm" className="mt-2" onClick={() => onAction(next.action)}>
          {next.actionLabel}
        </Button>
      )}
    </section>
  );
}
