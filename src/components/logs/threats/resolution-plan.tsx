"use client";

import { Copy, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ResolutionStep } from "@/lib/ai/agent/contract";
import { Button } from "@/components/ui/button";
import { ChatMarkdown } from "@/components/chat/chat-markdown";

/** Ordered remediation checklist from an investigation report. */
export function ResolutionPlan({ steps }: { steps: ResolutionStep[] }) {
  if (steps.length === 0) return null;
  const ordered = [...steps].sort((a, b) => a.order - b.order);

  return (
    <ol className="space-y-2">
      {ordered.map((step, i) => (
        <li key={`${step.order}-${i}`} className="flex gap-3 rounded-md border p-3">
          <span
            className={cn(
              "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.65rem] font-semibold tabular-nums",
              step.changesState
                ? "border-warning/50 bg-warning/10 text-warning"
                : "border-border bg-muted text-muted-foreground",
            )}
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <ChatMarkdown content={step.action} className="text-sm font-medium leading-snug" />
            {step.changesState && (
              <span className="inline-flex items-center gap-1 rounded-full border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[0.65rem] font-normal text-warning">
                <TriangleAlert className="size-2.5" aria-hidden />
                changes infrastructure
              </span>
            )}
            <ChatMarkdown content={step.rationale} className="text-xs leading-relaxed text-muted-foreground" />
            {step.command && <CommandChip command={step.command} />}
          </div>
        </li>
      ))}
    </ol>
  );
}

function CommandChip({ command }: { command: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success("Command copied");
    } catch {
      toast.error("Could not access the clipboard");
    }
  };

  return (
    <div className="flex items-center gap-1.5 overflow-hidden rounded-md border bg-muted/40">
      <code className="min-w-0 flex-1 overflow-x-auto px-2 py-1 font-mono text-xs whitespace-nowrap">{command}</code>
      <Button
        variant="ghost"
        size="icon-xs"
        className="mr-0.5 shrink-0 text-muted-foreground"
        onClick={copy}
        aria-label="Copy command"
      >
        <Copy />
      </Button>
    </div>
  );
}
