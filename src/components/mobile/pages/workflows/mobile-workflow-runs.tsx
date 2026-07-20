"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";
import { useGlobalRuns } from "@/components/workflows/api";
import { formatDuration } from "@/components/workflows/lib";
import { RunStatusBadge } from "@/components/workflows/meta";
import { RunDetailBody } from "@/components/workflows/run-detail-sheet";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobileSegmented } from "@/components/mobile/ui/mobile-segmented";
import { WORKFLOW_SEGMENTS } from "./mobile-workflows";

interface SelectedRun {
  id: string;
  workflowId: string;
  workflowName: string;
}

/**
 * Phone global run history: color-coded status rows; tapping one opens the
 * shared step-by-step run detail in a bottom sheet.
 */
export function MobileWorkflowRunsPage() {
  const { data: runs, isLoading, isError, refetch } = useGlobalRuns();
  const [selected, setSelected] = useState<SelectedRun | null>(null);

  return (
    <>
      <MobilePageHeader title="Run history">
        <MobileSegmented items={WORKFLOW_SEGMENTS} />
      </MobilePageHeader>
      <MobilePage>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <MobileEmpty
            icon={<History />}
            title="Run history unavailable"
            description="The workflow engine isn't responding yet — it may still be starting."
            action={
              <Button variant="outline" onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
        ) : (runs ?? []).length === 0 ? (
          <MobileEmpty
            icon={<History />}
            title="No runs yet"
            description="Run a workflow and every execution will be recorded here."
            action={
              <Button asChild variant="outline">
                <Link href="/workflows">Go to workflows</Link>
              </Button>
            }
          />
        ) : (
          <MobileList>
            {runs!.map((run) => (
              <MobileListRow
                key={run.id}
                onClick={() =>
                  setSelected({
                    id: run.id,
                    workflowId: run.workflowId,
                    workflowName: run.workflowName,
                  })
                }
                title={
                  <>
                    <span className="truncate">{run.workflowName}</span>
                    <RunStatusBadge status={run.status} className="shrink-0" />
                  </>
                }
                subtitle={`${formatRelative(run.startedAt)} · ${run.trigger}`}
                trailing={
                  <span className="font-mono">{formatDuration(run.startedAt, run.finishedAt)}</span>
                }
              />
            ))}
          </MobileList>
        )}
      </MobilePage>

      <BottomSheet
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
        title="Run details"
        description="Persisted step results — secret outputs are redacted after the original run."
      >
        {selected && (
          <div className="flex flex-col gap-4 pb-2">
            <Link
              href={`/workflows/${selected.workflowId}`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"
            >
              {selected.workflowName} <ExternalLink className="size-3.5" />
            </Link>
            <RunDetailBody runId={selected.id} />
          </div>
        )}
      </BottomSheet>
    </>
  );
}
