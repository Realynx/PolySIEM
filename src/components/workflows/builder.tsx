"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type OnConnect,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  BadgeCheck,
  History,
  Loader2,
  Lock,
  MousePointerClick,
  Play,
  Save,
  TriangleAlert,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/components/shared/api-client";
import type {
  GraphIssue,
  NodeTypeMeta,
  WorkflowDto,
  WorkflowGraph,
} from "@/lib/workflows/types";
import { isTriggerKind } from "@/lib/workflows/types";
import { useCatalog, useEntityLabels, useWorkflow, wfKeys } from "@/components/workflows/api";
import {
  graphKey,
  initialNodeConfig,
  migrateTriggerConfig,
  nextNodePosition,
  parseTriggerParams,
  toGraph,
  upstreamSpecs,
  wouldCreateCycle,
  buildTemplateGroups,
  type GraphEdgeLike,
} from "@/components/workflows/lib";
import {
  BUILDER_NODE_TYPES,
  EntityLabelsContext,
  NODE_WIDTH,
  type BuilderFlowNode,
} from "@/components/workflows/builder-node";
import { NodePalette, PALETTE_DRAG_MIME } from "@/components/workflows/palette";
import { ConfigPanel } from "@/components/workflows/config-panel";
import { ValidationPanel } from "@/components/workflows/validation-panel";
import { RunWorkflowDialog } from "@/components/workflows/run-dialog";
import { WorkflowHistorySheet } from "@/components/workflows/run-detail-sheet";

/** Same app-token React Flow theme the topology maps use (topology-canvas.tsx). */
const XY_THEME = {
  "--xy-edge-stroke": "var(--color-border)",
  "--xy-edge-stroke-selected": "var(--color-primary)",
  "--xy-controls-button-background-color": "var(--color-card)",
  "--xy-controls-button-background-color-hover": "var(--color-muted)",
  "--xy-controls-button-color": "var(--color-foreground)",
  "--xy-controls-button-color-hover": "var(--color-foreground)",
  "--xy-controls-button-border-color": "var(--color-border)",
  "--xy-minimap-background-color": "var(--color-card)",
  "--xy-minimap-mask-background-color": "color-mix(in oklab, var(--color-muted) 55%, transparent)",
  "--xy-attribution-background-color": "transparent",
} as React.CSSProperties;

function shortId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Build a styled flow edge; branch edges are color-coded and labeled. */
function buildFlowEdge(
  id: string,
  source: string,
  target: string,
  branch: "true" | "false" | null,
): Edge {
  const edge: Edge = {
    id,
    source,
    target,
    sourceHandle: branch ?? undefined,
    data: { branch },
    style: { strokeWidth: 1.5 },
  };
  if (branch) {
    edge.label = branch;
    edge.style = {
      strokeWidth: 1.5,
      stroke: branch === "true" ? "var(--color-success)" : "var(--color-destructive)",
    };
    edge.labelStyle = {
      fill: "var(--color-muted-foreground)",
      fontSize: 10,
      fontFamily: "var(--font-geist-mono), monospace",
    };
    edge.labelBgStyle = { fill: "var(--color-card)" };
    edge.labelBgPadding = [4, 2];
    edge.labelBgBorderRadius = 4;
  }
  return edge;
}

function graphToFlow(
  graph: WorkflowGraph,
  catalogByKind: Map<string, NodeTypeMeta>,
): { nodes: BuilderFlowNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((spec) => ({
      id: spec.id,
      type: "workflow" as const,
      position: spec.position,
      data: {
        kind: spec.kind,
        label: spec.label,
        config: spec.config,
        meta: catalogByKind.get(spec.kind) ?? null,
        issues: [],
      },
    })),
    edges: graph.edges.map((spec) => buildFlowEdge(spec.id, spec.source, spec.target, spec.branch)),
  };
}

function BuilderInner({ workflowId, isAdmin }: { workflowId: string; isAdmin: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const readOnly = !isAdmin;
  const { setCenter, screenToFlowPosition } = useReactFlow();

  const workflowQuery = useWorkflow(workflowId);
  const catalogQuery = useCatalog();
  const entityLabels = useEntityLabels();
  const workflow = workflowQuery.data;

  const catalogByKind = useMemo(
    () => new Map((catalogQuery.data ?? []).map((m) => [m.kind, m])),
    [catalogQuery.data],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [issues, setIssues] = useState<GraphIssue[] | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingTriggerDelete, setPendingTriggerDelete] = useState<string[] | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const validatedKeyRef = useRef<string | null>(null);
  const initRef = useRef(false);

  // Load the fetched graph into flow state exactly once.
  useEffect(() => {
    if (!workflow || initRef.current) return;
    initRef.current = true;
    const flow = graphToFlow(workflow.graph, catalogByKind);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setSavedKey(graphKey(workflow.graph));
  }, [workflow, catalogByKind, setNodes, setEdges]);

  // Stamp catalog metadata onto nodes once/whenever the catalog arrives.
  useEffect(() => {
    if (catalogByKind.size === 0) return;
    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        const meta = catalogByKind.get(n.data.kind) ?? null;
        if (n.data.meta === meta) return n;
        changed = true;
        return { ...n, data: { ...n.data, meta } };
      });
      return changed ? next : ns;
    });
  }, [catalogByKind, setNodes]);

  const currentGraph = useMemo(() => toGraph(nodes, edges as GraphEdgeLike[]), [nodes, edges]);
  const currentKey = useMemo(() => graphKey(currentGraph), [currentGraph]);
  const dirty = savedKey !== null && currentKey !== savedKey;

  const hasTrigger = nodes.some((n) => isTriggerKind(n.data.kind));
  // Several triggers may coexist; the run dialog collects parameters for the
  // one a hand-run activates (executor.ts prefers the manual trigger too).
  const triggerNode =
    nodes.find((n) => n.data.kind === "trigger.manual") ??
    nodes.find((n) => isTriggerKind(n.data.kind));
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  // ----- mutations -----

  const stampIssues = useCallback(
    (list: GraphIssue[]) => {
      const byNode = new Map<string, string[]>();
      for (const issue of list) {
        if (!issue.nodeId) continue;
        const msgs = byNode.get(issue.nodeId);
        if (msgs) msgs.push(issue.message);
        else byNode.set(issue.nodeId, [issue.message]);
      }
      setNodes((ns) =>
        ns.map((n) => {
          const next = byNode.get(n.id) ?? [];
          if (next.length === 0 && n.data.issues.length === 0) return n;
          return { ...n, data: { ...n.data, issues: next } };
        }),
      );
    },
    [setNodes],
  );

  const validateMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ issues: GraphIssue[] }>(`/api/workflows/${workflowId}/validate`, {
        method: "POST",
        body: JSON.stringify({ graph: currentGraph }),
      }),
    onSuccess: ({ issues: found }) => {
      setIssues(found);
      stampIssues(found);
      setShowValidation(true);
      validatedKeyRef.current = currentKey;
    },
    onError: (err: Error) => toast.error(`Validation failed: ${err.message}`),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<WorkflowDto>(`/api/workflows/${workflowId}`, {
        method: "PATCH",
        body: JSON.stringify({ graph: currentGraph }),
      }),
    onSuccess: (dto) => {
      setSavedKey(graphKey(dto.graph));
      queryClient.setQueryData(wfKeys.detail(workflowId), dto);
      queryClient.invalidateQueries({ queryKey: wfKeys.list });
    },
    onError: (err: Error) => toast.error(`Save failed: ${err.message}`),
  });

  const save = useCallback(
    (onSaved?: () => void) => {
      if (readOnly || saveMutation.isPending) return;
      saveMutation.mutate(undefined, {
        onSuccess: () => {
          toast.success("Workflow saved");
          validateMutation.mutate();
          onSaved?.();
        },
      });
    },
    [readOnly, saveMutation, validateMutation],
  );

  // ----- graph editing -----

  const removeNodes = useCallback(
    (ids: string[]) => {
      setNodes((ns) => ns.filter((n) => !ids.includes(n.id)));
      setEdges((es) => es.filter((e) => !ids.includes(e.source) && !ids.includes(e.target)));
      setSelectedNodeId((sel) => (sel && ids.includes(sel) ? null : sel));
    },
    [setNodes, setEdges],
  );

  const addNodeFromMeta = useCallback(
    (meta: NodeTypeMeta, position?: { x: number; y: number }) => {
      if (readOnly) return;
      const id = shortId("n");
      const pos = position ?? nextNodePosition(nodes.map((n) => n.position));
      const node: BuilderFlowNode = {
        id,
        type: "workflow",
        position: { x: Math.round(pos.x / 16) * 16, y: Math.round(pos.y / 16) * 16 },
        selected: true,
        data: {
          kind: meta.kind,
          label: null,
          config: initialNodeConfig(meta),
          meta,
          issues: [],
        },
      };
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), node]);
      setSelectedNodeId(id);
    },
    [readOnly, nodes, setNodes],
  );

  const onConnect: OnConnect = useCallback(
    (connection) => {
      if (readOnly) return;
      const { source, target, sourceHandle } = connection;
      if (!source || !target) return;
      if (source === target) {
        toast.error("A node cannot connect to itself.");
        return;
      }
      const branch =
        sourceHandle === "true" || sourceHandle === "false" ? sourceHandle : null;
      if (
        edges.some(
          (e) =>
            e.source === source &&
            e.target === target &&
            (e.sourceHandle ?? null) === (sourceHandle ?? null),
        )
      ) {
        toast.info("These nodes are already connected.");
        return;
      }
      if (wouldCreateCycle(edges as GraphEdgeLike[], source, target)) {
        toast.error("That connection would create a loop — workflows must flow one way.");
        return;
      }
      setEdges((es) => [...es, buildFlowEdge(shortId("e"), source, target, branch)]);
    },
    [readOnly, edges, setEdges],
  );

  const onSelectionChange = useCallback(({ nodes: sel }: OnSelectionChangeParams) => {
    setSelectedNodeId(sel.length === 1 ? sel[0].id : null);
  }, []);

  const onBeforeDelete = useCallback(
    async ({ nodes: delNodes }: { nodes: Node[]; edges: Edge[] }) => {
      if (readOnly) return false;
      const triggers = delNodes.filter((n) =>
        isTriggerKind((n as BuilderFlowNode).data.kind),
      );
      if (triggers.length > 0) {
        setPendingTriggerDelete(delNodes.map((n) => n.id));
        return false; // deletion continues via the confirm dialog
      }
      return true;
    },
    [readOnly],
  );

  const updateNodeConfig = useCallback(
    (nodeId: string, config: Record<string, unknown>) => {
      setNodes((ns) =>
        ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, config } } : n)),
      );
    },
    [setNodes],
  );

  const updateNodeLabel = useCallback(
    (nodeId: string, label: string | null) => {
      setNodes((ns) =>
        ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, label } } : n)),
      );
    },
    [setNodes],
  );

  // Swap a trigger node to another trigger flavor in place (edges + position
  // survive; config is migrated so params carry over where sensible).
  const updateNodeKind = useCallback(
    (nodeId: string, kind: string) => {
      setNodes((ns) =>
        ns.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  kind,
                  meta: catalogByKind.get(kind) ?? null,
                  config: migrateTriggerConfig(n.data.config, kind, catalogByKind.get(kind)),
                },
              }
            : n,
        ),
      );
    },
    [setNodes, catalogByKind],
  );

  const triggerKinds = useMemo(
    () => (catalogQuery.data ?? []).filter((m) => isTriggerKind(m.kind)),
    [catalogQuery.data],
  );

  const deleteFromPanel = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (node && isTriggerKind(node.data.kind)) setPendingTriggerDelete([nodeId]);
      else removeNodes([nodeId]);
    },
    [nodes, removeNodes],
  );

  const focusNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + 40, {
        zoom: 1,
        duration: 400,
      });
      setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === nodeId })));
      setSelectedNodeId(nodeId);
    },
    [nodes, setCenter, setNodes],
  );

  const nodeName = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      return node ? (node.data.label ?? node.data.meta?.title ?? node.data.kind) : nodeId;
    },
    [nodes],
  );

  // ----- drag & drop from the palette -----

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      const kind = event.dataTransfer.getData(PALETTE_DRAG_MIME);
      if (!kind) return;
      event.preventDefault();
      const meta = catalogByKind.get(kind);
      if (!meta) return;
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNodeFromMeta(meta, { x: pos.x - NODE_WIDTH / 2, y: pos.y - 24 });
    },
    [catalogByKind, screenToFlowPosition, addNodeFromMeta],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (event.dataTransfer.types.includes(PALETTE_DRAG_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  }, []);

  // ----- keyboard + unload guards -----

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty) save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, save]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const goBack = useCallback(() => {
    if (dirty && !window.confirm("You have unsaved changes — leave without saving?")) return;
    router.push("/workflows");
  }, [dirty, router]);

  // ----- template variables for the selected node's config panel -----

  const templateGroups = useMemo(() => {
    if (!selectedNode) return [];
    return buildTemplateGroups(
      parseTriggerParams(triggerNode?.data.config),
      upstreamSpecs(selectedNode.id, nodes, edges as GraphEdgeLike[]),
      catalogByKind,
    );
  }, [selectedNode, triggerNode, nodes, edges, catalogByKind]);

  const triggerParams = useMemo(
    () => parseTriggerParams(triggerNode?.data.config),
    [triggerNode],
  );

  // ----- loading / error states -----

  if (workflowQuery.isLoading) {
    return (
      <div>
        <div className="mb-4 flex items-center gap-3">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-6 w-56" />
          <Skeleton className="ml-auto h-8 w-64" />
        </div>
        <Skeleton className="h-[calc(100vh-12rem)] min-h-[520px] w-full rounded-xl" />
      </div>
    );
  }

  if (workflowQuery.isError || !workflow) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-24 text-center">
        <TriangleAlert className="size-8 text-muted-foreground" />
        <div className="space-y-1">
          <h2 className="font-medium">Could not load this workflow</h2>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            {workflowQuery.error instanceof Error
              ? workflowQuery.error.message
              : "The workflow engine may still be starting."}
          </p>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button variant="outline" onClick={() => workflowQuery.refetch()}>
            Retry
          </Button>
          <Button variant="ghost" onClick={() => router.push("/workflows")}>
            <ArrowLeft className="size-4" /> All workflows
          </Button>
        </div>
      </div>
    );
  }

  const validateNow = () => {
    if (dirty && !readOnly) save();
    else validateMutation.mutate();
  };

  const openRun = () => {
    if (dirty) save(() => setRunOpen(true));
    else setRunOpen(true);
  };

  return (
    <EntityLabelsContext.Provider value={entityLabels}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" className="shrink-0" onClick={goBack} aria-label="Back to workflows">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <span className="truncate">{workflow.name}</span>
            {!workflow.enabled && (
              <Badge variant="outline" className="text-muted-foreground">
                Disabled
              </Badge>
            )}
            {readOnly && (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <Lock className="size-3" /> Read-only
              </Badge>
            )}
          </h1>
          {workflow.description && (
            <p className="truncate text-sm text-muted-foreground">{workflow.description}</p>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {dirty && (
            <span className="flex items-center gap-1.5 text-xs text-warning">
              <span className="size-1.5 animate-pulse rounded-full bg-warning" aria-hidden />
              Unsaved changes
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={validateNow} disabled={validateMutation.isPending}>
            {validateMutation.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <BadgeCheck data-icon="inline-start" />
            )}
            Validate
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
            <History data-icon="inline-start" /> History
          </Button>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              disabled={!dirty || saveMutation.isPending}
              onClick={() => save()}
              title="Ctrl+S"
            >
              {saveMutation.isPending ? <Loader2 className="animate-spin" /> : <Save data-icon="inline-start" />}
              Save
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" onClick={openRun} disabled={!hasTrigger || saveMutation.isPending}>
              <Play data-icon="inline-start" /> Run
            </Button>
          )}
        </div>
      </div>

      <div
        className="relative w-full overflow-hidden rounded-xl border border-border bg-card/40"
        style={XY_THEME}
      >
        <div className="h-[calc(100vh-12.5rem)] min-h-[520px]" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={BUILDER_NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            onBeforeDelete={onBeforeDelete}
            deleteKeyCode={readOnly ? null : ["Delete", "Backspace"]}
            fitView
            fitViewOptions={{
              padding: { left: "96px", right: "48px", top: "48px", bottom: "32px" },
              maxZoom: 1,
            }}
            minZoom={0.15}
            maxZoom={2}
            snapToGrid
            snapGrid={[16, 16]}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="var(--color-border)" />
            <Controls
              showInteractive={false}
              className="!shadow-sm [&>button]:!border-b [&>button]:!border-border"
            />
            <MiniMap
              pannable
              zoomable
              className="!rounded-lg !border !border-border !shadow-sm"
              nodeColor="var(--color-muted-foreground)"
              nodeStrokeColor="transparent"
              bgColor="var(--color-card)"
            />
          </ReactFlow>
        </div>

        {!readOnly && (
          <NodePalette
            catalog={catalogQuery.data}
            loading={catalogQuery.isLoading}
            error={catalogQuery.isError}
            onRetry={() => catalogQuery.refetch()}

            onAdd={(meta) => addNodeFromMeta(meta)}
          />
        )}

        {nodes.length === 0 && !readOnly && !catalogQuery.isLoading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-center">
              <MousePointerClick className="size-6 text-muted-foreground/50" />
              <p className="max-w-56 text-sm text-muted-foreground">
                Open <span className="font-medium text-card-foreground">Add node</span> or press
                <kbd className="mx-1 rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">Shift+A</kbd>
                to start building
              </p>
            </div>
          </div>
        )}

        {selectedNode && (
          <ConfigPanel
            node={selectedNode}
            templateGroups={templateGroups}
            triggerKinds={triggerKinds}
            readOnly={readOnly}
            onChangeConfig={updateNodeConfig}
            onChangeLabel={updateNodeLabel}
            onChangeKind={updateNodeKind}
            onDelete={deleteFromPanel}
            onClose={() => {
              setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
              setSelectedNodeId(null);
            }}
          />
        )}

        {showValidation && issues !== null && (
          <ValidationPanel
            issues={issues}
            stale={validatedKeyRef.current !== currentKey}
            nodeName={nodeName}
            onFocusNode={focusNode}
            onClose={() => setShowValidation(false)}
          />
        )}
      </div>

      <RunWorkflowDialog
        workflowId={workflowId}
        workflowName={workflow.name}
        triggerParams={triggerParams}
        open={runOpen}
        onOpenChange={setRunOpen}
      />

      <WorkflowHistorySheet workflowId={workflowId} open={historyOpen} onOpenChange={setHistoryOpen} />

      <AlertDialog
        open={pendingTriggerDelete !== null}
        onOpenChange={(v) => !v && setPendingTriggerDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the trigger node?</AlertDialogTitle>
            <AlertDialogDescription>
              The trigger defines this workflow&apos;s run parameters. Without it the workflow
              cannot be executed until a new trigger is added.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep trigger</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (pendingTriggerDelete) removeNodes(pendingTriggerDelete);
                setPendingTriggerDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </EntityLabelsContext.Provider>
  );
}

/** The interactive workflow builder page body (canvas + palette + panels). */
export function WorkflowBuilder({ workflowId, isAdmin }: { workflowId: string; isAdmin: boolean }) {
  return (
    <ReactFlowProvider>
      <BuilderInner workflowId={workflowId} isAdmin={isAdmin} />
    </ReactFlowProvider>
  );
}
