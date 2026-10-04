"use client";

import { Check, Loader2, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { RelaySetupAction, RelaySetupProgress, RelaySetupStep } from "./edge-relay-presentation";

/**
 * The guided setup for one relay server: five steps from "added" to "traffic
 * flows", with what is done, what is next, and the button that does the next
 * one. Shown only until setup is complete — after that the health path says
 * everything this would.
 */
export function RelaySetupChecklist({
  progress,
  isAdmin,
  busyAction,
  onAction,
}: {
  progress: RelaySetupProgress;
  isAdmin: boolean;
  /** The action currently running, so its button can spin. */
  busyAction?: RelaySetupAction | null;
  onAction: (action: RelaySetupAction) => void;
}) {
  const percent = Math.round((progress.completed / progress.total) * 100);
  return (
    <section className="rounded-lg border bg-muted/20 p-3" aria-label="Setup progress">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Setup <span className="font-normal text-muted-foreground tabular-nums">· {progress.completed} of {progress.total} done</span>
        </p>
        <div
          className="h-1.5 w-full max-w-48 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.completed}
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <ol className="mt-3 grid gap-2 lg:grid-cols-5">
        {progress.steps.map((step, index) => (
          <SetupStep
            key={step.id}
            step={step}
            number={index + 1}
            isAdmin={isAdmin}
            busy={busyAction === step.action}
            onAction={() => onAction(step.action)}
          />
        ))}
      </ol>
    </section>
  );
}

function SetupStep({
  step,
  number,
  isAdmin,
  busy,
  onAction,
}: {
  step: RelaySetupStep;
  number: number;
  isAdmin: boolean;
  busy: boolean;
  onAction: () => void;
}) {
  const current = step.state === "current";
  return (
    <li
      className={cn(
        "flex min-w-0 gap-2.5 rounded-md border border-transparent p-2",
        current && "border-primary/30 bg-primary/5",
        (step.state === "todo" || step.state === "skipped") && "opacity-70",
      )}
      aria-current={current ? "step" : undefined}
    >
      <StepMarker step={step} number={number} />
      <div className="min-w-0 space-y-1">
        <p className={cn("text-sm font-medium leading-tight", step.state === "done" && "text-muted-foreground")}>
          {step.title}
          <span className="sr-only">{` (${step.state === "current" ? "next step" : step.state})`}</span>
        </p>
        <p className="text-xs text-muted-foreground">{step.detail}</p>
        {current && isAdmin && (
          <Button size="sm" className="mt-1" disabled={busy} onClick={onAction}>
            {busy && <Loader2 className="animate-spin" />}
            {step.actionLabel}
          </Button>
        )}
      </div>
    </li>
  );
}

function StepMarker({ step, number }: { step: RelaySetupStep; number: number }) {
  if (step.state === "done") {
    return (
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success" aria-hidden="true">
        <Check className="size-3" />
      </span>
    );
  }
  if (step.state === "skipped") {
    return <MinusCircle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
  return (
    <span
      className={cn(
        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-medium tabular-nums",
        step.state === "current" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
      )}
      aria-hidden="true"
    >
      {number}
    </span>
  );
}
