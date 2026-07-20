import {
  Bell,
  Boxes,
  Circle,
  CircleCheck,
  CircleHelp,
  CircleMinus,
  CircleX,
  FileText,
  GitBranch,
  Globe,
  KeyRound,
  Loader2,
  ScrollText,
  Server,
  Sparkles,
  Split,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CATEGORY_LABELS } from "@/components/workflows/categories";
import { cn } from "@/lib/utils";
import type { NodeCategory, WorkflowRunStatus, WorkflowStepStatus } from "@/lib/workflows/types";

/** Visual identity of each node-type category (palette groups + node cards). */
export interface CategoryMeta {
  label: string;
  icon: LucideIcon;
  /** Icon foreground utility. */
  fg: string;
  /** Soft icon-tile background utility. */
  bg: string;
}

export const CATEGORY_META: Record<NodeCategory, CategoryMeta> = {
  trigger: { label: CATEGORY_LABELS.trigger, icon: Zap, fg: "text-primary", bg: "bg-primary/10" },
  control: {
    label: CATEGORY_LABELS.control,
    icon: Split,
    fg: "[color:var(--color-chart-3)]",
    bg: "[background:color-mix(in_oklab,var(--color-chart-3)_12%,transparent)]",
  },
  inventory: { label: CATEGORY_LABELS.inventory, icon: Boxes, fg: "text-info", bg: "bg-info/10" },
  ssh: { label: CATEGORY_LABELS.ssh, icon: KeyRound, fg: "text-warning", bg: "bg-warning/10" },
  proxmox: {
    label: CATEGORY_LABELS.proxmox,
    icon: Server,
    fg: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-500/10",
  },
  docs: { label: CATEGORY_LABELS.docs, icon: FileText, fg: "text-success", bg: "bg-success/10" },
  http: { label: CATEGORY_LABELS.http, icon: Globe, fg: "text-info", bg: "bg-info/10" },
  notify: { label: CATEGORY_LABELS.notify, icon: Bell, fg: "text-warning", bg: "bg-warning/10" },
  ai: {
    label: CATEGORY_LABELS.ai,
    icon: Sparkles,
    fg: "[color:var(--color-chart-5)]",
    bg: "[background:color-mix(in_oklab,var(--color-chart-5)_12%,transparent)]",
  },
  logs: { label: CATEGORY_LABELS.logs, icon: ScrollText, fg: "text-muted-foreground", bg: "bg-muted" },
  workflow: {
    label: CATEGORY_LABELS.workflow,
    icon: GitBranch,
    fg: "[color:var(--color-chart-4)]",
    bg: "[background:color-mix(in_oklab,var(--color-chart-4)_12%,transparent)]",
  },
};

/** Fallback identity for node kinds the catalog doesn't know (engine drift). */
export const UNKNOWN_CATEGORY: CategoryMeta = {
  label: "Unknown",
  icon: CircleHelp,
  fg: "text-muted-foreground",
  bg: "bg-muted",
};

export function categoryMeta(category: NodeCategory | null | undefined): CategoryMeta {
  return (category && CATEGORY_META[category]) || UNKNOWN_CATEGORY;
}

/** Workflow run status pill, matching the house sync-status badge styling. */
export function RunStatusBadge({
  status,
  className,
}: {
  status: WorkflowRunStatus;
  className?: string;
}) {
  const styles: Record<WorkflowRunStatus, string> = {
    RUNNING: "border-info/40 bg-info/10 text-info",
    SUCCESS: "border-success/40 bg-success/10 text-success",
    FAILED: "border-destructive/40 bg-destructive/10 text-destructive",
    CANCELLED: "border-border bg-muted text-muted-foreground",
  };
  const labels: Record<WorkflowRunStatus, string> = {
    RUNNING: "Running…",
    SUCCESS: "Success",
    FAILED: "Failed",
    CANCELLED: "Cancelled",
  };
  return (
    <Badge variant="outline" className={cn(styles[status], className)}>
      {labels[status]}
    </Badge>
  );
}

/** Per-step status icon used in run result lists. */
export function StepStatusIcon({
  status,
  className,
}: {
  status: WorkflowStepStatus;
  className?: string;
}) {
  const cls = cn("size-4 shrink-0", className);
  switch (status) {
    case "SUCCESS":
      return <CircleCheck className={cn(cls, "text-success")} aria-label="Success" />;
    case "FAILED":
      return <CircleX className={cn(cls, "text-destructive")} aria-label="Failed" />;
    case "RUNNING":
      return <Loader2 className={cn(cls, "animate-spin text-info")} aria-label="Running" />;
    case "SKIPPED":
      return <CircleMinus className={cn(cls, "text-muted-foreground/60")} aria-label="Skipped" />;
    default:
      return <Circle className={cn(cls, "text-muted-foreground/40")} aria-label="Pending" />;
  }
}
