"use client";

import { useEffect, useRef } from "react";
import { Check, CornerDownRight, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AiStreamState } from "@/components/ai/use-ai-stream";

export interface AiResultBarProps extends AiStreamState {
  /** Accept the generated text, replacing the existing content. */
  onAccept?: () => void;
  /** Append the generated text to the existing content. */
  onAppend?: () => void;
  /** Discard the result and close the panel. */
  onDiscard: () => void;
  /** Cancel an in-flight stream. */
  onCancel: () => void;
  /** Hide Accept/Append (read-only results such as rule explanations). */
  readOnly?: boolean;
  className?: string;
}

/** Streaming AI output panel with Accept / Append / Discard actions. */
export function AiResultBar({
  status,
  text,
  error,
  onAccept,
  onAppend,
  onDiscard,
  onCancel,
  readOnly = false,
  className,
}: AiResultBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest tokens in view while streaming.
  useEffect(() => {
    if (status === "streaming" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [status, text]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        ref={scrollRef}
        className="max-h-64 min-h-16 overflow-y-auto rounded-md bg-muted/50 p-2.5 text-sm whitespace-pre-wrap"
      >
        {text}
        {status === "streaming" && (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-primary align-middle" />
        )}
        {status === "streaming" && !text && (
          <span className="text-muted-foreground animate-pulse">Thinking…</span>
        )}
      </div>

      {status === "error" && error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-1.5">
        {status === "streaming" ? (
          <>
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
            <Button variant="ghost" size="sm" onClick={onCancel}>
              <X data-icon="inline-start" /> Cancel
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onDiscard}>
              <Trash2 data-icon="inline-start" /> Discard
            </Button>
            {!readOnly && status === "done" && (
              <>
                {onAppend && (
                  <Button variant="outline" size="sm" onClick={onAppend}>
                    <CornerDownRight data-icon="inline-start" /> Append
                  </Button>
                )}
                {onAccept && (
                  <Button size="sm" onClick={onAccept}>
                    <Check data-icon="inline-start" /> Accept
                  </Button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
