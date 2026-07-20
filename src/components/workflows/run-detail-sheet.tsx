"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useRunDetail, useWorkflowRuns } from "@/components/workflows/api";
import { formatDuration, runInputSummary } from "@/components/workflows/lib";
import { RunConsole } from "@/components/workflows/run-console";
import { RunMetaHeader, RunStepsView, RunTriggerBadge } from "@/components/workflows/run-steps";
import { RunStatusBadge } from "@/components/workflows/meta";
import { formatDateTime, formatRelative } from "@/lib/format";

/** Fetches a run (with steps) and renders header + step results. */
export function RunDetailBody({ runId }: { runId: string }) {
  const { data: run, isLoading, isError } = useRunDetail(runId);
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (isError || !run) {
    return <p className="text-sm text-muted-foreground">Could not load this run.</p>;
  }
  return (
    <div className="space-y-4">
      <RunMetaHeader run={run} />
      <RunConsole runId={run.id} status={run.status} />
      <RunStepsView steps={run.steps} />
    </div>
  );
}

/**
 * Sheet showing one persisted run's step-by-step results (secrets redacted).
 * Used by the global runs table.
 */
export function RunDetailSheet({
  runId,
  workflowName,
  workflowId,
  onOpenChange,
}: {
  runId: string | null;
  workflowName?: string;
  workflowId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={runId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="pb-0">
          <SheetTitle className="flex items-center gap-2">
            Run details
            {workflowId && (
              <Button asChild variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs font-normal">
                <Link href={`/workflows/${workflowId}`}>
                  {workflowName} <ExternalLink className="size-3" />
                </Link>
              </Button>
            )}
          </SheetTitle>
          <SheetDescription>
            Persisted step results — secret outputs are redacted after the original run.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">{runId && <RunDetailBody runId={runId} />}</div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Per-workflow run history sheet used from the builder toolbar: a run list
 * that drills into the shared step-detail view.
 */
export function WorkflowHistorySheet({
  workflowId,
  open,
  onOpenChange,
}: {
  workflowId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const { data: runs, isLoading, isError } = useWorkflowRuns(workflowId, open);

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) setSelectedRunId(null);
        onOpenChange(v);
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="pb-0">
          <SheetTitle className="flex items-center gap-2">
            {selectedRunId && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => setSelectedRunId(null)}
                aria-label="Back to run list"
              >
                <ArrowLeft className="size-4" />
              </Button>
            )}
            {selectedRunId ? "Run details" : "Run history"}
          </SheetTitle>
          <SheetDescription>
            {selectedRunId
              ? "Persisted step results — secret outputs are redacted after the original run."
              : "Previous executions of this workflow, newest first."}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {selectedRunId ? (
            <RunDetailBody runId={selectedRunId} />
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : isError ? (
            <p className="text-sm text-muted-foreground">Could not load run history.</p>
          ) : (runs ?? []).length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
              This workflow has not been run yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {runs!.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    className="w-full rounded-lg border border-border/70 p-2.5 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    <div className="flex items-center gap-2">
                      <RunStatusBadge status={run.status} />
                      <RunTriggerBadge trigger={run.trigger} />
                      <span className="text-xs text-muted-foreground" title={formatDateTime(run.startedAt)}>
                        {formatRelative(run.startedAt)}
                      </span>
                      <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
                        {formatDuration(run.startedAt, run.finishedAt)}
                      </span>
                    </div>
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {runInputSummary(run.input)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
