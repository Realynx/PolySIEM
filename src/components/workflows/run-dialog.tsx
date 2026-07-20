"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/components/shared/api-client";
import type { TriggerParam, WorkflowRunResult } from "@/lib/workflows/types";
import { wfKeys } from "@/components/workflows/api";
import { FieldInput, triggerParamToField } from "@/components/workflows/field-input";
import { RunMetaHeader, RunSecretsPanel, RunStepsView } from "@/components/workflows/run-steps";

/**
 * Execute-workflow dialog: phase 1 renders the trigger's TriggerParam[] with
 * the shared FieldSpec renderer, phase 2 shows per-step results plus the
 * ONE-TIME secrets panel (values are never retrievable again).
 */
export function RunWorkflowDialog({
  workflowId,
  workflowName,
  triggerParams,
  open,
  onOpenChange,
}: {
  workflowId: string;
  workflowName: string;
  triggerParams: TriggerParam[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<WorkflowRunResult | null>(null);

  const run = useMutation({
    mutationFn: () =>
      apiFetch<WorkflowRunResult>(`/api/workflows/${workflowId}/run`, {
        method: "POST",
        body: JSON.stringify({ input }),
      }),
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: wfKeys.workflowRuns(workflowId) });
      queryClient.invalidateQueries({ queryKey: wfKeys.globalRuns });
      queryClient.invalidateQueries({ queryKey: wfKeys.detail(workflowId) });
      queryClient.invalidateQueries({ queryKey: wfKeys.list });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const missing = triggerParams.filter((p) => {
    if (!p.required) return false;
    const v = input[p.key];
    return v === undefined || v === null || v === "";
  });

  const hasSecrets = result?.secrets !== undefined && Object.keys(result.secrets).length > 0;
  const nodeLabel = (nodeId: string) =>
    result?.run.steps.find((s) => s.nodeId === nodeId)?.label ?? nodeId;

  const reset = () => {
    setResult(null);
    setInput({});
    run.reset();
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (run.isPending) return;
        if (!v && hasSecrets) return; // must acknowledge the one-time secrets explicitly
        if (!v) close();
        else onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {!result ? (
          <>
            <DialogHeader>
              <DialogTitle>Run “{workflowName}”</DialogTitle>
              <DialogDescription>
                {triggerParams.length > 0
                  ? "Fill in the trigger parameters — nodes reference them as {{input.…}}."
                  : "This workflow takes no input parameters."}
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (missing.length === 0) run.mutate();
              }}
            >
              {triggerParams.map((param) => (
                <FieldInput
                  key={param.key}
                  field={triggerParamToField(param)}
                  value={input[param.key]}
                  idPrefix="wf-run"
                  onChange={(value) =>
                    setInput((prev) => {
                      const next = { ...prev };
                      if (value === undefined) delete next[param.key];
                      else next[param.key] = value;
                      return next;
                    })
                  }
                />
              ))}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={run.isPending} onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" disabled={run.isPending || missing.length > 0}>
                  {run.isPending ? <Loader2 className="animate-spin" /> : <Play />}
                  {run.isPending ? "Running…" : "Run workflow"}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {result.run.status === "SUCCESS" ? "Workflow completed" : "Workflow finished"}
              </DialogTitle>
              <DialogDescription>Step-by-step results for “{workflowName}”.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <RunMetaHeader run={result.run} />
              {hasSecrets && <RunSecretsPanel secrets={result.secrets!} nodeLabel={nodeLabel} />}
              <RunStepsView steps={result.run.steps} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Run again
              </Button>
              <Button onClick={close}>
                {hasSecrets ? "I saved the secrets — close" : "Close"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
