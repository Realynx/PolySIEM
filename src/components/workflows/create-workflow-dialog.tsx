"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { pushWithNavigationFeedback } from "@/components/shell/navigation-feedback";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/components/shared/api-client";
import type { WorkflowDto } from "@/lib/workflows/types";
import { wfKeys } from "@/components/workflows/api";

/** "New workflow" dialog: name + description, then straight into the builder. */
export function CreateWorkflowDialog() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
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
      pushWithNavigationFeedback(router, `/workflows/${dto.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus data-icon="inline-start" /> New workflow
      </Button>
      <Dialog open={open} onOpenChange={(v) => !create.isPending && setOpen(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
            <DialogDescription>
              Name it, then design the flow on the builder canvas.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="wf-create-name">Name</Label>
              <Input
                id="wf-create-name"
                required
                placeholder="e.g. Provision new machine"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wf-create-desc">Description (optional)</Label>
              <Textarea
                id="wf-create-desc"
                placeholder="What does this workflow automate?"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={create.isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || !name.trim()}>
                {create.isPending && <Loader2 className="animate-spin" />}
                Create & open builder
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
