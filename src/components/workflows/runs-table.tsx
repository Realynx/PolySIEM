"use client";

import { useState } from "react";
import Link from "next/link";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { ListCard } from "@/components/inventory/list-card";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useGlobalRuns } from "@/components/workflows/api";
import { formatDuration, runInputSummary } from "@/components/workflows/lib";
import { RunStatusBadge } from "@/components/workflows/meta";
import { RunTriggerBadge } from "@/components/workflows/run-steps";
import { RunDetailSheet } from "@/components/workflows/run-detail-sheet";

/** Global run-history table (/workflows/runs); row click opens step details. */
export function GlobalRunsTable() {
  const { data: runs, isLoading, isError, refetch } = useGlobalRuns();
  const [selected, setSelected] = useState<{ id: string; workflowId: string; workflowName: string } | null>(
    null,
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={History}
        title="Run history unavailable"
        description="The workflow engine isn't responding yet — it may still be starting."
        action={
          <Button variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  if ((runs ?? []).length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No runs yet"
        description="Execute a workflow from its builder page and every run will be recorded here."
        action={
          <Button asChild variant="outline">
            <Link href="/workflows">Go to workflows</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workflow</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Trigger</TableHead>
              <TableHead>Started</TableHead>
              <TableHead className="hidden sm:table-cell">Duration</TableHead>
              <TableHead className="hidden md:table-cell">Input</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs!.map((run) => (
              <TableRow
                key={run.id}
                className="cursor-pointer"
                onClick={() =>
                  setSelected({ id: run.id, workflowId: run.workflowId, workflowName: run.workflowName })
                }
              >
                <TableCell className="font-medium">{run.workflowName}</TableCell>
                <TableCell>
                  <RunStatusBadge status={run.status} />
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <RunTriggerBadge trigger={run.trigger} />
                </TableCell>
                <TableCell className="text-muted-foreground" title={formatDateTime(run.startedAt)}>
                  {formatRelative(run.startedAt)}
                </TableCell>
                <TableCell className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:table-cell">
                  {formatDuration(run.startedAt, run.finishedAt)}
                </TableCell>
                <TableCell className="hidden max-w-72 truncate font-mono text-xs text-muted-foreground md:table-cell">
                  {runInputSummary(run.input)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ListCard>

      <RunDetailSheet
        runId={selected?.id ?? null}
        workflowId={selected?.workflowId}
        workflowName={selected?.workflowName}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  );
}
