"use client";

import { useState } from "react";
import { Loader2, RefreshCw, ShieldAlert, TerminalSquare } from "lucide-react";
import type { RestartCapability } from "@/lib/postgres-tuning/model";
import type { ManualPlan } from "@/lib/postgres-tuning/sql";
import { CopyButton } from "@/components/ssh/copy-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

export function CommandBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
      </div>
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre">
        {value}
      </pre>
    </div>
  );
}

/** Shown when the database role cannot ALTER SYSTEM / reload: exact SQL to run by hand. */
export function ManualPlanPanel({ plan }: { plan: ManualPlan }) {
  return (
    <Alert>
      <ShieldAlert />
      <AlertTitle>Apply these manually</AlertTitle>
      <AlertDescription className="space-y-4">
        <p>{plan.reason}</p>
        <CommandBlock label="Command" value={plan.command} />
        <CommandBlock label="SQL" value={plan.sql} />
        {plan.restartCommand && (
          <CommandBlock label="Then restart PostgreSQL (shared_buffers and friends need it)" value={plan.restartCommand} />
        )}
      </AlertDescription>
    </Alert>
  );
}

export function RestartButton({
  pending,
  onConfirm,
  variant = "outline",
}: {
  pending: boolean;
  onConfirm: () => void;
  variant?: "outline" | "default";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} disabled={pending} onClick={() => setOpen(true)}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        {pending ? "Restarting…" : "Restart PostgreSQL"}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart PostgreSQL?</AlertDialogTitle>
            <AlertDialogDescription>
              PolySIEM and anything else using this database will be unavailable for a few seconds while PostgreSQL
              restarts. Integration syncs that are mid-flight may fail once and retry on their next run.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              Restart now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Settings written to postgresql.auto.conf that only take effect after a restart. */
export function PendingRestartNotice({
  names,
  restart,
  restarting,
  onRestart,
}: {
  names: string[];
  restart: RestartCapability;
  restarting: boolean;
  onRestart: () => void;
}) {
  if (names.length === 0 && !restarting) return null;
  if (restarting) {
    return (
      <Alert>
        <Loader2 className="animate-spin" />
        <AlertTitle>Restarting PostgreSQL…</AlertTitle>
        <AlertDescription>Waiting for the database to come back. This page refreshes on its own.</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert>
      <RefreshCw />
      <AlertTitle>Restart needed for {names.length === 1 ? "1 setting" : `${names.length} settings`}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          <span className="font-mono">{names.join(", ")}</span> {names.length === 1 ? "is" : "are"} saved but only take
          effect after PostgreSQL restarts.
        </p>
        {restart.helper ? (
          <RestartButton pending={restarting} onConfirm={onRestart} />
        ) : (
          <CommandBlock label="Run on the database host" value={restart.command} />
        )}
      </AlertDescription>
    </Alert>
  );
}

export function NoChangesNote() {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <TerminalSquare className="size-4" /> Every managed setting already matches the recommendation.
    </p>
  );
}
