"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Undo2, Wand2 } from "lucide-react";
import type { ManagedSettingName } from "@/lib/postgres-tuning/catalog";
import { computePlan, type TuningOverrides, type TuningState } from "@/lib/postgres-tuning/model";
import type { ManualPlan } from "@/lib/postgres-tuning/sql";
import { apiFetch } from "@/components/shared/api-client";
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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { TuningResourcesCard } from "./tuning-resources-card";
import { TuningSettingsTable } from "./tuning-settings-table";
import { ManualPlanPanel, NoChangesNote, PendingRestartNotice, RestartButton } from "./tuning-notices";

const QUERY_KEY = ["admin", "postgres-tuning"] as const;

interface SettingOutcome {
  name: ManagedSettingName;
  live: boolean;
  pendingRestart: boolean;
}

type TuningResult =
  | { mode: "applied"; outcomes: SettingOutcome[]; state: TuningState }
  | { mode: "manual"; plan: ManualPlan; state: TuningState };

function cleanOverrides(overrides: TuningOverrides): TuningOverrides | null {
  const entries = Object.entries(overrides).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as TuningOverrides) : null;
}

function describeOutcome(outcomes: SettingOutcome[], verb: string): string {
  const live = outcomes.filter((outcome) => outcome.live && !outcome.pendingRestart).length;
  const pending = outcomes.filter((outcome) => outcome.pendingRestart).length;
  const parts = [`${live} live`];
  if (pending > 0) parts.push(`${pending} waiting for a PostgreSQL restart`);
  return `${verb}: ${parts.join(", ")}`;
}

function ResetButton({ pending, onConfirm }: { pending: boolean; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(true)}>
        <Undo2 className="size-4" /> Reset to defaults
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset PostgreSQL tuning?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes every value PolySIEM manages from postgresql.auto.conf, so PostgreSQL falls back to postgresql.conf
              and its built-in defaults. Memory settings fall back after the next restart.
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
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function useTuningMutations(onResult: (result: TuningResult, verb: string) => void) {
  const queryClient = useQueryClient();
  const [restarting, setRestarting] = useState(false);
  const apply = useMutation({
    mutationFn: (body: { settings: ManagedSettingName[]; overrides: TuningOverrides | null }) =>
      apiFetch<TuningResult>("/api/admin/postgres-tuning", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (result) => onResult(result, "Applied"),
    onError: (err: Error) => toast.error(err.message),
  });
  const reset = useMutation({
    mutationFn: () => apiFetch<TuningResult>("/api/admin/postgres-tuning/reset", { method: "POST" }),
    onSuccess: (result) => onResult(result, "Reset"),
    onError: (err: Error) => toast.error(err.message),
  });
  const restart = useMutation({
    mutationFn: () => apiFetch<{ requested: true }>("/api/admin/postgres-tuning/restart", { method: "POST" }),
    onSuccess: () => {
      setRestarting(true);
      toast.success("Restart requested");
      // Give the host helper a moment, then poll until PostgreSQL answers again.
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }), 3000);
    },
    onError: (err: Error) => toast.error(err.message),
  });
  return { apply, reset, restart, restarting, setRestarting };
}

export function PostgresTuningPanel({ initial }: { initial: TuningState }) {
  const queryClient = useQueryClient();
  const [overrides, setOverrides] = useState<TuningOverrides>(initial.overrides ?? {});
  const [choices, setChoices] = useState<Partial<Record<ManagedSettingName, boolean>>>({});
  const [manualPlan, setManualPlan] = useState<ManualPlan | null>(null);

  const mutations = useTuningMutations((result, verb) => {
    queryClient.setQueryData(QUERY_KEY, result.state);
    setChoices({});
    if (result.mode === "manual") {
      setManualPlan(result.plan);
      toast.warning("PolySIEM cannot change these settings itself; run the commands shown.");
      return;
    }
    setManualPlan(null);
    toast.success(describeOutcome(result.outcomes, verb));
  });
  const { restarting, setRestarting } = mutations;

  const { data: state = initial } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const next = await apiFetch<TuningState>("/api/admin/postgres-tuning");
      if (restarting && !next.capabilities.restart.requested && next.pendingRestart.length === 0) {
        setRestarting(false);
        toast.success("PostgreSQL restarted");
      }
      return next;
    },
    initialData: initial,
    refetchInterval: restarting ? 2000 : false,
    retry: restarting ? 10 : 1,
  });

  const plan = useMemo(() => computePlan(state.detected, state.postgres, overrides), [state, overrides]);
  const isChecked = (name: ManagedSettingName) =>
    choices[name] ?? plan.settings.find((setting) => setting.name === name)?.differs ?? false;
  const selected = plan.settings.filter((setting) => isChecked(setting.name)).map((setting) => setting.name);
  const differing = plan.settings.filter((setting) => setting.differs).length;
  const busy = mutations.apply.isPending || mutations.reset.isPending || restarting;
  const shownManualPlan = manualPlan ?? state.manualPlan;
  const restartHelper = state.capabilities.restart.helper;

  return (
    <div className="space-y-6">
      <TuningResourcesCard
        detected={state.detected}
        overrides={overrides}
        budget={plan.budget}
        databaseHost={state.database.host}
        onChange={setOverrides}
      />

      <PendingRestartNotice
        names={state.pendingRestart}
        restart={state.capabilities.restart}
        restarting={restarting}
        onRestart={() => mutations.restart.mutate()}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>PostgreSQL settings</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline">PostgreSQL {state.postgres.version}</Badge>
              {state.postgres.isSuperuser && <Badge variant="secondary">superuser</Badge>}
            </div>
          </div>
          <CardDescription>
            Current values against recommendations for a web dashboard workload. Settings marked “Needs restart” are
            saved immediately but take effect after PostgreSQL restarts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {differing === 0 && <NoChangesNote />}
          <TuningSettingsTable
            settings={plan.settings}
            isChecked={isChecked}
            disabled={busy}
            onToggle={(name, checked) => setChoices((prev) => ({ ...prev, [name]: checked }))}
          />
          {shownManualPlan && <ManualPlanPanel plan={shownManualPlan} />}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={busy || selected.length === 0}
            onClick={() => mutations.apply.mutate({ settings: selected, overrides: cleanOverrides(overrides) })}
          >
            <Wand2 className="size-4" />
            {mutations.apply.isPending ? "Applying…" : `Apply recommended (${selected.length})`}
          </Button>
          <ResetButton pending={busy} onConfirm={() => mutations.reset.mutate()} />
          {restartHelper && state.pendingRestart.length === 0 && (
            <RestartButton pending={restarting} onConfirm={() => mutations.restart.mutate()} />
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
