"use client";

import { Download, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ssh/copy-button";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import type { WorkflowRunDto, WorkflowRunStepDto } from "@/lib/workflows/types";
import { formatDuration, runInputSummary } from "@/components/workflows/lib";
import { RunStatusBadge, StepStatusIcon } from "@/components/workflows/meta";

/**
 * Generic what-started-this-run badge — renders whatever trigger string the
 * run carries ("manual", "webhook", "schedule", "workflow", future kinds).
 */
export function RunTriggerBadge({ trigger, className }: { trigger: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-mono text-[10px] uppercase tracking-wide text-muted-foreground", className)}
    >
      {trigger}
    </Badge>
  );
}

/** Header line for a run: status, trigger, start time, duration, input digest. */
export function RunMetaHeader({ run }: { run: WorkflowRunDto }) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <RunStatusBadge status={run.status} />
        <RunTriggerBadge trigger={run.trigger} />
        <span className="text-xs text-muted-foreground">
          {formatDateTime(run.startedAt)} · {formatDuration(run.startedAt, run.finishedAt)}
        </span>
      </div>
      {Object.keys(run.input).length > 0 && (
        <p className="truncate font-mono text-[11px] text-muted-foreground" title={runInputSummary(run.input, 99)}>
          {runInputSummary(run.input, 6)}
        </p>
      )}
      {run.error && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <TriangleAlert className="mt-px size-3.5 shrink-0" /> {run.error}
        </p>
      )}
    </div>
  );
}

function StepOutputs({ output }: { output: Record<string, unknown> }) {
  const entries = Object.entries(output);
  if (entries.length === 0) return null;
  return (
    <dl className="mt-1.5 space-y-1 border-t border-border/60 pt-1.5">
      {entries.map(([key, value]) => {
        const text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
        const redacted = text === "[redacted]";
        return (
          <div key={key} className="flex items-start gap-2 text-[11px]">
            <dt className="w-24 shrink-0 truncate font-medium text-muted-foreground" title={key}>
              {key}
            </dt>
            <dd
              className={cn(
                "min-w-0 flex-1 break-all font-mono",
                redacted ? "italic text-muted-foreground/60" : "text-card-foreground",
              )}
            >
              {redacted ? "redacted — shown once at run time" : text}
            </dd>
            {!redacted && text.length > 0 && <CopyButton value={text} className="-my-1 size-5" />}
          </div>
        );
      })}
    </dl>
  );
}

/**
 * Step-by-step result list — shared by the run dialog (fresh results) and the
 * run-history detail sheet (persisted, secrets redacted).
 */
export function RunStepsView({ steps }: { steps: WorkflowRunStepDto[] }) {
  if (steps.length === 0) {
    return <p className="text-xs text-muted-foreground">No steps were recorded for this run.</p>;
  }
  return (
    <ol className="space-y-2">
      {steps.map((step) => (
        <li key={step.id} className="rounded-lg border border-border/70 p-2.5">
          <div className="flex items-center gap-2">
            <StepStatusIcon status={step.status} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{step.label}</span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{step.kind}</span>
            {step.startedAt && (
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {formatDuration(step.startedAt, step.finishedAt)}
              </span>
            )}
          </div>
          {step.error && (
            <p className="mt-1.5 break-words rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
              {step.error}
            </p>
          )}
          {step.output && <StepOutputs output={step.output} />}
        </li>
      ))}
    </ol>
  );
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * One-time secrets panel: shown ONLY on a fresh run response. Values are never
 * stored — mirror of the /keys generate dialog's private-key handling.
 */
export function RunSecretsPanel({
  secrets,
  nodeLabel,
}: {
  secrets: Record<string, Record<string, string>>;
  nodeLabel: (nodeId: string) => string;
}) {
  const entries = Object.entries(secrets).flatMap(([nodeId, outputs]) =>
    Object.entries(outputs).map(([key, value]) => ({ nodeId, key, value })),
  );
  if (entries.length === 0) return null;
  return (
    <div className="space-y-3">
      <Alert variant="destructive">
        <TriangleAlert className="size-4" />
        <AlertTitle>
          Secret output{entries.length === 1 ? "" : "s"} — shown once, never stored
        </AlertTitle>
        <AlertDescription>
          Copy or download {entries.length === 1 ? "it" : "them"} now. Once this view closes,
          PolySIEM cannot show {entries.length === 1 ? "it" : "them"} again — run history keeps only
          redacted placeholders.
        </AlertDescription>
      </Alert>
      {entries.map(({ nodeId, key, value }) => (
        <div key={`${nodeId}.${key}`} className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs font-medium">
              {nodeLabel(nodeId)} <span className="font-mono text-muted-foreground">· {key}</span>
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => downloadText(`${key}.txt`, value)}
              >
                <Download className="size-3.5" /> Download
              </Button>
              <CopyButton value={value} label={`Copy ${key}`} />
            </div>
          </div>
          <pre className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs break-all whitespace-pre-wrap">
            {value}
          </pre>
        </div>
      ))}
    </div>
  );
}
