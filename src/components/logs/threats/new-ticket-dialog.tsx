"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/components/shared/api-client";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { SecurityTicketDto, TicketSeverityValue } from "@/lib/types";
import { CATEGORIES, SEVERITIES } from "./constants";

/** Dialog for manually opening a ticket. */
export function NewTicketDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<TicketSeverityValue>("MEDIUM");
  const [category, setCategory] = useState<string>("other");
  const [summary, setSummary] = useState("");

  useEffect(() => {
    if (open) {
      setTitle("");
      setSeverity("MEDIUM");
      setCategory("other");
      setSummary("");
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      apiFetch<SecurityTicketDto>("/api/logs/tickets", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), summary: summary.trim(), severity, category }),
      }),
    onSuccess: () => {
      toast.success("Ticket opened");
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>New ticket</DialogTitle>
            <DialogDescription>
              Track an incident or observation manually, alongside AI-generated tickets.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="ticket-title">Title</Label>
              <Input
                id="ticket-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Repeated SSH failures on dixie"
                required
                maxLength={200}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="ticket-severity">Severity</Label>
                <Select value={severity} onValueChange={(v) => setSeverity(v as TicketSeverityValue)}>
                  <SelectTrigger id="ticket-severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ticket-category">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="ticket-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ticket-summary">Summary</Label>
              <Textarea
                id="ticket-summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="What did you see, and where?"
                rows={5}
                required
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !title.trim() || !summary.trim()}>
              {create.isPending ? "Opening…" : "Open ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
