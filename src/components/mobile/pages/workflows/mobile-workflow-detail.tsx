"use client";

import { useMemo, useState } from "react";
import { Monitor, Play, TriangleAlert, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";
import {
  isTriggerKind,
  type WorkflowGraph,
  type WorkflowNodeSpec,
} from "@/lib/workflows/types";
import {
  useCatalog,
  useEntityLabels,
  useWorkflow,
  useWorkflowRuns,
} from "@/components/workflows/api";
import {
  formatDuration,
  parseTriggerParams,
  summarizeNodeConfig,
} from "@/components/workflows/lib";
import { categoryMeta, RunStatusBadge } from "@/components/workflows/meta";
import { RunDetailBody } from "@/components/workflows/run-detail-sheet";
import { RunTriggerBadge } from "@/components/workflows/run-steps";
import { RunWorkflowDialog } from "@/components/workflows/run-dialog";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import {
  MobileEmpty,
  MobileKeyRow,
  MobileList,
  MobileListRow,
} from "@/components/mobile/ui/mobile-list";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";

/**
 * Graph → readable step order: Kahn's topological sort seeded with trigger
 * nodes first, so the list reads the way the run executes. Nodes caught in a
 * cycle (invalid graphs) are appended at the end rather than dropped.
 */
function orderedSteps(graph: WorkflowGraph): WorkflowNodeSpec[] {
  const indegree = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!indegree.has(edge.source) || !indegree.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    const targets = outgoing.get(edge.source);
    if (targets) targets.push(edge.target);
    else outgoing.set(edge.source, [edge.target]);
  }
  const roots = graph.nodes.filter((n) => indegree.get(n.id) === 0);
  const queue = [
    ...roots.filter((n) => isTriggerKind(n.kind)),
    ...roots.filter((n) => !isTriggerKind(n.kind)),
  ];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const ordered: WorkflowNodeSpec[] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    ordered.push(node);
    for (const targetId of outgoing.get(node.id) ?? []) {
      const remaining = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, remaining);
      if (remaining === 0) queue.push(byId.get(targetId)!);
    }
  }
  return [...ordered, ...graph.nodes.filter((n) => !seen.has(n.id))];
}

function workflowTrigger(graph: WorkflowGraph): WorkflowNodeSpec | undefined {
  return graph.nodes.find((node) => node.kind === "trigger.manual")
    ?? graph.nodes.find((node) => isTriggerKind(node.kind));
}

function workflowLoadError(error: unknown): string {
  return error instanceof Error ? error.message : "The workflow engine may still be starting.";
}

function WorkflowStatus({ enabled }: { enabled: boolean }) {
  return enabled
    ? <span className="text-success">Enabled</span>
    : <span className="text-muted-foreground">Disabled</span>;
}

/**
 * Phone workflow view: the builder is a desktop surface, so the phone gets a
 * read/run companion — meta, the ordered step list derived from the same
 * graph, a prominent Run button (same run dialog/mechanism as the builder),
 * and recent runs.
 */
export function MobileWorkflowDetailPage({
  workflowId,
  isAdmin,
}: {
  workflowId: string;
  isAdmin: boolean;
}) {
  const workflowQuery = useWorkflow(workflowId);
  const catalogQuery = useCatalog();
  const entityLabels = useEntityLabels();
  const runsQuery = useWorkflowRuns(workflowId);

  const [runOpen, setRunOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const workflow = workflowQuery.data;
  const catalogByKind = useMemo(
    () => new Map((catalogQuery.data ?? []).map((m) => [m.kind, m])),
    [catalogQuery.data],
  );
  const steps = useMemo(
    () => (workflow ? orderedSteps(workflow.graph) : []),
    [workflow],
  );
  const triggerNode = workflow ? workflowTrigger(workflow.graph) : undefined;
  const triggerParams = useMemo(
    () => parseTriggerParams(triggerNode?.config),
    [triggerNode],
  );

  if (workflowQuery.isLoading) {
    return (
      <>
        <MobilePageHeader title="Workflow" backHref="/workflows" />
        <MobilePage>
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-md" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </MobilePage>
      </>
    );
  }

  if (workflowQuery.isError || !workflow) {
    return (
      <>
        <MobilePageHeader title="Workflow" backHref="/workflows" />
        <MobilePage>
          <MobileEmpty
            icon={<TriangleAlert />}
            title="Could not load this workflow"
            description={workflowLoadError(workflowQuery.error)}
            action={
              <Button variant="outline" onClick={() => workflowQuery.refetch()}>
                Retry
              </Button>
            }
          />
        </MobilePage>
      </>
    );
  }

  const runs = runsQuery.data ?? [];

  return (
    <>
      <MobilePageHeader title={workflow.name} backHref="/workflows" />
      <MobilePage>
        {workflow.description && (
          <p className="px-0.5 text-sm text-muted-foreground">{workflow.description}</p>
        )}

        <MobileList>
          <MobileKeyRow label="Status">
            <WorkflowStatus enabled={workflow.enabled} />
          </MobileKeyRow>
          <MobileKeyRow label="Trigger">
            {triggerNode ? (
              <RunTriggerBadge trigger={triggerNode.kind.replace(/^trigger\./, "")} />
            ) : (
              <span className="text-warning">none — cannot run</span>
            )}
          </MobileKeyRow>
          <MobileKeyRow label="Steps">{workflow.graph.nodes.length}</MobileKeyRow>
          <MobileKeyRow label="Updated">{formatRelative(workflow.updatedAt)}</MobileKeyRow>
          {workflow.lastRun && (
            <MobileKeyRow label="Last run">
              <span className="inline-flex items-center gap-1.5">
                <RunStatusBadge status={workflow.lastRun.status} />
                {formatRelative(workflow.lastRun.startedAt)}
              </span>
            </MobileKeyRow>
          )}
        </MobileList>

        {isAdmin && (
          <Button
            size="lg"
            className="w-full"
            disabled={!triggerNode}
            onClick={() => setRunOpen(true)}
          >
            <Play /> Run workflow
          </Button>
        )}

        <MobileSection title="Steps">
          {steps.length === 0 ? (
            <MobileEmpty
              icon={<Workflow />}
              title="Empty flow"
              description="This workflow has no nodes yet. Build the flow in the desktop builder."
            />
          ) : (
            <MobileList>
              {steps.map((spec) => {
                const meta = catalogByKind.get(spec.kind) ?? null;
                const cat = categoryMeta(meta?.category);
                const summary = summarizeNodeConfig(meta, spec.config, entityLabels);
                return (
                  <MobileListRow
                    key={spec.id}
                    leading={
                      <span
                        className={cn(
                          "flex size-9 items-center justify-center rounded-lg",
                          cat.bg,
                          cat.fg,
                        )}
                      >
                        <cat.icon className="size-4.5" />
                      </span>
                    }
                    title={
                      <>
                        <span className="truncate">
                          {spec.label ?? meta?.title ?? spec.kind}
                        </span>
                        {isTriggerKind(spec.kind) && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            trigger
                          </Badge>
                        )}
                      </>
                    }
                    subtitle={summary ?? meta?.description ?? spec.kind}
                  />
                );
              })}
            </MobileList>
          )}
          <p className="flex items-start gap-1.5 px-0.5 text-xs text-muted-foreground">
            <Monitor className="mt-px size-3.5 shrink-0" />
            Editing this flow is desktop-only — open the workflow on a desktop browser to change
            nodes and connections.
          </p>
        </MobileSection>

        <MobileSection title="Recent runs">
          {runsQuery.isLoading ? (
            <Skeleton className="h-24 w-full rounded-xl" />
          ) : runs.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
              This workflow has not been run yet.
            </p>
          ) : (
            <MobileList>
              {runs.slice(0, 10).map((run) => (
                <MobileListRow
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  title={<RunStatusBadge status={run.status} />}
                  subtitle={`${formatRelative(run.startedAt)} · ${run.trigger}`}
                  trailing={
                    <span className="font-mono">
                      {formatDuration(run.startedAt, run.finishedAt)}
                    </span>
                  }
                />
              ))}
            </MobileList>
          )}
        </MobileSection>
      </MobilePage>

      {isAdmin && (
        <RunWorkflowDialog
          workflowId={workflowId}
          workflowName={workflow.name}
          triggerParams={triggerParams}
          open={runOpen}
          onOpenChange={setRunOpen}
        />
      )}

      <BottomSheet
        open={selectedRunId !== null}
        onOpenChange={(open) => !open && setSelectedRunId(null)}
        title="Run details"
        description="Persisted step results — secret outputs are redacted after the original run."
      >
        {selectedRunId && (
          <div className="pb-2">
            <RunDetailBody runId={selectedRunId} />
          </div>
        )}
      </BottomSheet>
    </>
  );
}
