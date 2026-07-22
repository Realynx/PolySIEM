"use client";

import { createContext, memo, useContext, useMemo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { isTriggerKind, type NodeTypeMeta } from "@/lib/workflows/types";
import { isConditionKind, summarizeNodeConfig } from "@/components/workflows/lib";
import { categoryMeta } from "@/components/workflows/meta";

export const NODE_WIDTH = 260;

/**
 * id → display label for entity ids appearing in node configs. Provided by the
 * builder so config summaries can say "HomeLan" instead of a cuid. Kept in
 * context (not node data) so label arrival doesn't rebuild every node object.
 */
export const EntityLabelsContext = createContext<Map<string, string>>(new Map());

export interface BuilderNodeData extends Record<string, unknown> {
  kind: string;
  label: string | null;
  config: Record<string, unknown>;
  /** Catalog metadata for this kind; null when the catalog doesn't know it. */
  meta: NodeTypeMeta | null;
  /** Validation messages anchored to this node (last validate call). */
  issues: string[];
}

export type BuilderFlowNode = Node<BuilderNodeData, "workflow">;

const handleBase =
  "!size-2.5 !rounded-full !border-2 !border-background !bg-muted-foreground/70 transition-colors";

function BranchRow({ branch }: { branch: "true" | "false" }) {
  const isTrue = branch === "true";
  return (
    <div className="relative flex h-6 items-center justify-end pr-3">
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-wide",
          isTrue ? "text-success" : "text-destructive",
        )}
      >
        {branch}
      </span>
      <Handle
        id={branch}
        type="source"
        position={Position.Right}
        className={cn(
          handleBase,
          "!absolute !-right-[5px] !top-1/2 !-translate-y-1/2",
          isTrue ? "!bg-success" : "!bg-destructive",
        )}
      />
    </div>
  );
}

function nodeBorder(selected: boolean, hasIssues: boolean): string {
  if (selected) return "border-primary ring-2 ring-primary/30";
  if (hasIssues) return "border-destructive/60";
  return "border-border hover:border-primary/50";
}

function NodePorts({ condition }: { condition: boolean }) {
  if (condition) {
    return <div className="border-t border-border/60 py-1"><BranchRow branch="true" /><BranchRow branch="false" /></div>;
  }
  return <Handle type="source" position={Position.Right} className={cn(handleBase, "!-right-[5px]")} />;
}

function SummaryRow({ meta, summary }: { meta: NodeTypeMeta | null; summary: string | null }) {
  if (!meta) return <p className="truncate border-t border-border/60 px-3 py-1.5 font-mono text-[11px] italic text-muted-foreground/60">Unknown node type</p>;
  if (!summary && !meta.inputs.some((field) => field.required) && !isTriggerKind(meta.kind)) return null;
  return (
    <p className={cn("truncate border-t border-border/60 px-3 py-1.5 font-mono text-[11px]", summary ? "text-muted-foreground" : "italic text-muted-foreground/60")} title={summary ?? undefined}>
      {summary ?? "Not configured"}
    </p>
  );
}

export const WorkflowNode = memo(function WorkflowNode({
  data,
  selected,
}: NodeProps<BuilderFlowNode>) {
  const entityLabels = useContext(EntityLabelsContext);
  const { meta } = data;
  const cat = categoryMeta(meta?.category);
  const Icon = cat.icon;
  const trigger = isTriggerKind(data.kind);
  const condition = isConditionKind(data.kind);

  const title = data.label ?? meta?.title ?? data.kind;
  const caption = data.label ? (meta?.title ?? data.kind) : cat.label;
  const summary = useMemo(
    () => summarizeNodeConfig(meta, data.config, entityLabels),
    [meta, data.config, entityLabels],
  );
  const hasIssues = data.issues.length > 0;

  return (
    <div
      className={cn(
        "relative rounded-xl border bg-card shadow-sm transition-[border-color,box-shadow]",
        nodeBorder(selected, hasIssues),
      )}
      style={{ width: NODE_WIDTH }}
    >
      {hasIssues && (
        <span
          className="absolute -right-2 -top-2 z-10 flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white shadow-sm"
          title={data.issues.join("\n")}
        >
          {data.issues.length}
        </span>
      )}
      {!trigger && (
        <Handle
          type="target"
          position={Position.Left}
          className={cn(handleBase, "!-left-[5px]")}
        />
      )}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", cat.bg)}>
          <Icon className={cn("size-4", cat.fg)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight text-card-foreground" title={title}>{title}</p>
          <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
            {caption}
          </p>
        </div>
      </div>
      <SummaryRow meta={meta} summary={summary} />
      <NodePorts condition={condition} />
    </div>
  );
});

/** Stable node-type registry for the builder's ReactFlow instance. */
export const BUILDER_NODE_TYPES = { workflow: WorkflowNode };
