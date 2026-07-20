"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/components/shared/api-client";
import { formatRelative } from "@/lib/format";
import { isTriggerKind, TRIGGER_KIND_PREFIX, type WorkflowDto } from "@/lib/workflows/types";
import { useWorkflows, wfKeys } from "@/components/workflows/api";
import { RunStatusBadge } from "@/components/workflows/meta";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileFab } from "@/components/mobile/ui/mobile-fab";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobileSegmented } from "@/components/mobile/ui/mobile-segmented";

/** Segments shared by the workflow list and the global run history. */
export const WORKFLOW_SEGMENTS = [
  { label: "Workflows", href: "/workflows" },
  { label: "Run history", href: "/workflows/runs" },
];

/** The workflow's trigger flavor ("manual", "schedule", …), if it has one. */
function triggerLabel(wf: WorkflowDto): string | null {
  const trigger = wf.graph.nodes.find((n) => isTriggerKind(n.kind));
  return trigger ? trigger.kind.slice(TRIGGER_KIND_PREFIX.length) : null;
}

/**
 * Phone workflow list: rows into the read/run detail view, with a FAB that
 * creates a workflow through the same POST /api/workflows the desktop dialog
 * uses (the graph itself is designed on desktop).
 */
export function MobileWorkflowsPage({ isAdmin }: { isAdmin: boolean }) {
  const { data: workflows, isLoading, isError, error, refetch } = useWorkflows();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <MobilePageHeader title="Workflows">
        <MobileSegmented items={WORKFLOW_SEGMENTS} />
      </MobilePageHeader>
      <MobilePage>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <MobileEmpty
            icon={<Workflow />}
            title="Workflows unavailable"
            description={
              error instanceof Error && !error.message.startsWith("Request failed")
                ? error.message
                : "The workflow engine isn't responding yet — it may still be starting."
            }
            action={
              <Button variant="outline" onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
        ) : (workflows ?? []).length === 0 ? (
          <MobileEmpty
            icon={<Workflow />}
            title="No workflows yet"
            description="Automations for your lab — provision machines, allocate IPs, install SSH keys."
          />
        ) : (
          <MobileList>
            {workflows!.map((wf) => {
              const trigger = triggerLabel(wf);
              return (
                <MobileListRow
                  key={wf.id}
                  href={`/workflows/${wf.id}`}
                  title={
                    <>
                      <span className="truncate">{wf.name}</span>
                      {trigger && (
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase"
                        >
                          {trigger}
                        </Badge>
                      )}
                      {!wf.enabled && (
                        <Badge variant="outline" className="text-muted-foreground">
                          Off
                        </Badge>
                      )}
                    </>
                  }
                  subtitle={
                    wf.description ??
                    `${wf.graph.nodes.length} nodes · updated ${formatRelative(wf.updatedAt)}`
                  }
                  trailing={
                    wf.lastRun ? <RunStatusBadge status={wf.lastRun.status} /> : "never run"
                  }
                />
              );
            })}
          </MobileList>
        )}
      </MobilePage>

      {isAdmin && (
        <>
          <MobileFab aria-label="New workflow" onClick={() => setCreateOpen(true)}>
            <Plus />
          </MobileFab>
          <CreateWorkflowSheet open={createOpen} onOpenChange={setCreateOpen} />
        </>
      )}
    </>
  );
}

function CreateWorkflowSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const create = useMutation({
    mutationFn: () =>
      apiFetch<WorkflowDto>("/api/workflows", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          graph: { nodes: [], edges: [] },
        }),
      }),
    onSuccess: (dto) => {
      queryClient.invalidateQueries({ queryKey: wfKeys.list });
      toast.success(`Workflow "${dto.name}" created`);
      router.push(`/workflows/${dto.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !create.isPending && onOpenChange(v)}
      title="New workflow"
      description="Name it here — the flow itself is designed in the desktop builder."
    >
      <form
        className="flex flex-col gap-4 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="m-wf-create-name">Name</Label>
          <Input
            id="m-wf-create-name"
            required
            placeholder="e.g. Provision new machine"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="m-wf-create-desc">Description (optional)</Label>
          <Textarea
            id="m-wf-create-desc"
            placeholder="What does this workflow automate?"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={create.isPending || !name.trim()}>
          {create.isPending && <Loader2 className="animate-spin" />}
          {create.isPending ? "Creating…" : "Create workflow"}
        </Button>
      </form>
    </BottomSheet>
  );
}
