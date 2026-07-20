"use client";

import { useCallback, useEffect, useRef } from "react";
import { ArrowUp, FileText, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MicButton } from "@/components/speech/mic-button";
import { useDictationText } from "@/components/speech/use-dictation-text";
import { cn } from "@/lib/utils";

interface AiInterviewComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onGenerate: () => void;
  streaming: boolean;
  /** True once the operator has answered enough to finish or review services. */
  canGenerate: boolean;
  generateLabel?: string;
  autoFocus?: boolean;
  /** Increment to focus the custom answer field (for "Another answer"). */
  focusRequest?: number;
}

const MAX_HEIGHT = 160;

/**
 * Interview answer composer: reuses the private server MicButton so answers can
 * be dictated. Enter sends, Shift+Enter adds a newline. The secondary action
 * finishes a docs-only interview or opens the service review.
 */
export function AiInterviewComposer({
  value,
  onValueChange,
  onSend,
  onStop,
  onGenerate,
  streaming,
  canGenerate,
  generateLabel = "End interview",
  autoFocus = false,
  focusRequest = 0,
}: AiInterviewComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dictation = useDictationText(value, onValueChange);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

  useEffect(resize, [value, resize]);

  useEffect(() => {
    if (autoFocus || focusRequest > 0) textareaRef.current?.focus();
  }, [autoFocus, focusRequest]);

  const canSend = !streaming && value.trim().length > 0;

  return (
    <div className="border-t bg-popover p-3">
      <div className="flex items-end gap-2 rounded-xl border bg-background p-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          placeholder={
            streaming
              ? "The interviewer is working…"
              : "Type or dictate your answer…"
          }
          aria-label="Answer the documentation interviewer"
          disabled={streaming}
          className={cn(
            "max-h-40 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-5 outline-none placeholder:text-muted-foreground",
            streaming && "opacity-60",
          )}
        />
        <MicButton
          onTranscript={dictation.onTranscript}
          onInterim={dictation.onInterim}
          onRecordingStart={dictation.onRecordingStart}
          onDictationCancel={dictation.onDictationCancel}
          disabled={streaming}
          className="rounded-lg"
        />
        {streaming ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="destructive"
                onClick={onStop}
                aria-label="Stop"
                className="rounded-lg"
              >
                <Square className="size-3.5" fill="currentColor" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Stop</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            type="button"
            size="icon-sm"
            onClick={onSend}
            disabled={!canSend}
            aria-label="Send answer"
            className="rounded-lg"
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="px-1 text-[11px] text-muted-foreground">
          Enter to send · Shift+Enter for a new line · mic uses private server
          transcription
        </p>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          onClick={onGenerate}
          disabled={streaming || !canGenerate}
        >
          <FileText className="size-3.5" />
          {generateLabel}
        </Button>
      </div>
    </div>
  );
}
