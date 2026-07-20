"use client";

import { CircleCheck, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GraphIssue } from "@/lib/workflows/types";

/**
 * Bottom-left overlay listing the issues from the last validate call. Clicking
 * an issue focuses the offending node on the canvas.
 */
export function ValidationPanel({
  issues,
  stale,
  nodeName,
  onFocusNode,
  onClose,
}: {
  issues: GraphIssue[];
  /** The graph changed since these issues were produced. */
  stale: boolean;
  nodeName: (nodeId: string) => string;
  onFocusNode: (nodeId: string) => void;
  onClose: () => void;
}) {
  const clean = issues.length === 0;
  return (
    <div className="absolute bottom-3 left-3 z-10 w-80 max-w-[calc(100%-1.5rem)] rounded-xl border border-border bg-card/95 p-3 shadow-md backdrop-blur">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          {clean ? (
            <>
              <CircleCheck className="size-3.5 text-success" /> Workflow is valid
            </>
          ) : (
            <>
              <TriangleAlert className="size-3.5 text-destructive" />
              {issues.length} issue{issues.length === 1 ? "" : "s"} found
            </>
          )}
        </p>
        <Button variant="ghost" size="icon" className="size-5 shrink-0" onClick={onClose} aria-label="Close">
          <X className="size-3.5" />
        </Button>
      </div>
      {stale && (
        <p className="mb-1.5 text-[10px] italic text-muted-foreground">
          The graph changed since this check — validate again for fresh results.
        </p>
      )}
      {!clean && (
        <ul className="max-h-44 space-y-1 overflow-y-auto">
          {issues.map((issue, i) => (
            <li key={i}>
              <button
                type="button"
                className="w-full rounded-md border border-border/60 px-2 py-1.5 text-left text-xs transition-colors hover:border-destructive/50 hover:bg-destructive/5"
                onClick={() => issue.nodeId && onFocusNode(issue.nodeId)}
              >
                {issue.nodeId && (
                  <span className="mr-1.5 font-medium text-card-foreground">
                    {nodeName(issue.nodeId)}:
                  </span>
                )}
                <span className="text-muted-foreground">{issue.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
