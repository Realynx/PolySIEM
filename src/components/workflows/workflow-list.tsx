"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { pushWithNavigationFeedback } from "@/components/shell/navigation-feedback";
import {
  CircleAlert,
  CircleCheck,
  Copy,
  EllipsisVertical,
  GitBranch,
  PencilRuler,
  Power,
  Trash2,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { OperationsOverview } from "@/components/shared/operations-overview";
import { ListCard } from "@/components/inventory/list-card";
import { apiFetch } from "@/components/shared/api-client";
import { formatRelative } from "@/lib/format";
import type { WorkflowDto } from "@/lib/workflows/types";
import { useWorkflows, wfKeys } from "@/components/workflows/api";
import { RunStatusBadge } from "@/components/workflows/meta";

function workflowErrorDescription(error: unknown): string {
  if (error instanceof Error && !error.message.startsWith("Request failed")) return error.message;
  return "The workflow engine isn't responding yet — it may still be starting.";
}

/** Workflow list table: open, enable/disable, duplicate, delete. */
export function WorkflowList({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: workflows, isLoading, isError, error, refetch } = useWorkflows();
  const [deleteTarget, setDeleteTarget] = useState<WorkflowDto | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: wfKeys.list });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch<WorkflowDto>(`/api/workflows/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: wfKeys.list });
      queryClient.setQueryData<WorkflowDto[]>(wfKeys.list, (old) =>
        old?.map((w) => (w.id === id ? { ...w, enabled } : w)),
      );
    },
    onError: (err: Error) => {
      toast.error(err.message);
      invalidate();
    },
    onSuccess: invalidate,
  });

  const duplicate = useMutation({
    mutationFn: (source: WorkflowDto) =>
      apiFetch<WorkflowDto>("/api/workflows", {
        method: "POST",
        body: JSON.stringify({
          name: `${source.name} (copy)`,
          ...(source.description ? { description: source.description } : {}),
          graph: source.graph,
        }),
      }),
    onSuccess: (dto) => {
      invalidate();
      toast.success(`Duplicated as "${dto.name}"`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/api/workflows/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.success("Workflow deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={Workflow}
        title="Workflows unavailable"
        description={workflowErrorDescription(error)}
        action={
          <Button variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  if ((workflows ?? []).length === 0) {
    return (
      <EmptyState
        icon={Workflow}
        title="No workflows yet"
        description="Build visual automations for your lab — provision machines, allocate IPs, install SSH keys — as drag-and-drop flows."
      />
    );
  }

  const workflowRows = workflows ?? [];
  const enabledCount = workflowRows.filter((workflow) => workflow.enabled).length;
  const failedCount = workflowRows.filter(
    (workflow) => workflow.lastRun?.status === "FAILED",
  ).length;
  const neverRunCount = workflowRows.filter((workflow) => workflow.lastRun === null).length;
  const nodeCount = workflowRows.reduce(
    (total, workflow) => total + workflow.graph.nodes.length,
    0,
  );

  return (
    <>
      <div className="space-y-4">
        <OperationsOverview
          icon={<Workflow className="size-5" aria-hidden />}
          title="Automation workspace"
          description="Reusable workflows coordinate actions across your lab."
          status={
            <>
              {failedCount > 0 ? (
                <CircleAlert className="size-3.5" aria-hidden />
              ) : (
                <CircleCheck className="size-3.5" aria-hidden />
              )}
              {failedCount > 0
                ? `${failedCount} ${failedCount === 1 ? "workflow needs" : "workflows need"} attention`
                : "Automations ready"}
            </>
          }
          statusTone={failedCount > 0 ? "destructive" : "success"}
          metrics={[
            {
              icon: <Workflow />,
              label: "Workflows",
              value: workflowRows.length.toLocaleString(),
              detail: "Saved automation definitions",
            },
            {
              icon: <Power />,
              label: "Enabled",
              value: enabledCount.toLocaleString(),
              detail: `${workflowRows.length - enabledCount} disabled`,
              tone: enabledCount > 0 ? "success" : "neutral",
            },
            {
              icon: <GitBranch />,
              label: "Workflow nodes",
              value: nodeCount.toLocaleString(),
              detail: "Across all definitions",
            },
            {
              icon: <CircleAlert />,
              label: "Never run",
              value: neverRunCount.toLocaleString(),
              detail: neverRunCount > 0 ? "Awaiting a first execution" : "Every workflow has run",
              tone: neverRunCount > 0 ? "warning" : "success",
            },
          ]}
        />

        <ListCard
          title="Workflow library"
          description="Open, enable, duplicate, and manage saved automations."
          resultCount={workflowRows.length}
        >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Nodes</TableHead>
              <TableHead>Last run</TableHead>
              <TableHead className="hidden md:table-cell">Updated</TableHead>
              <TableHead className="w-20 text-center">Enabled</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {workflowRows.map((wf) => (
              <TableRow
                key={wf.id}
                className="cursor-pointer"
                onClick={() => pushWithNavigationFeedback(router, `/workflows/${wf.id}`)}
              >
                <TableCell>
                  <p className="font-medium">{wf.name}</p>
                  {wf.description && (
                    <p className="max-w-md truncate text-xs text-muted-foreground">{wf.description}</p>
                  )}
                </TableCell>
                <TableCell className="hidden tabular-nums text-muted-foreground sm:table-cell">
                  {wf.graph.nodes.length}
                </TableCell>
                <TableCell>
                  {wf.lastRun ? (
                    <span className="flex items-center gap-2">
                      <RunStatusBadge status={wf.lastRun.status} />
                      <span className="hidden text-xs text-muted-foreground lg:inline">
                        {formatRelative(wf.lastRun.startedAt)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">never run</span>
                  )}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {formatRelative(wf.updatedAt)}
                </TableCell>
                <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={wf.enabled}
                    disabled={!isAdmin || toggle.isPending}
                    onCheckedChange={(enabled) => toggle.mutate({ id: wf.id, enabled })}
                    aria-label={`${wf.enabled ? "Disable" : "Enable"} ${wf.name}`}
                  />
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-7" aria-label="Workflow actions">
                        <EllipsisVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => pushWithNavigationFeedback(router, `/workflows/${wf.id}`)}
                      >
                        <PencilRuler className="size-4" /> Open builder
                      </DropdownMenuItem>
                      {isAdmin && (
                        <>
                          <DropdownMenuItem
                            disabled={duplicate.isPending}
                            onClick={() => duplicate.mutate(wf)}
                          >
                            <Copy className="size-4" /> Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(wf)}>
                            <Trash2 className="size-4" /> Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </ListCard>
      </div>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the workflow and its run history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) remove.mutate(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete workflow
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
