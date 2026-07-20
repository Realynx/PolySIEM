"use client";

import { useCallback, useEffect, useRef } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MicButton } from "@/components/speech/mic-button";
import { useDictationText } from "@/components/speech/use-dictation-text";
import { cn } from "@/lib/utils";

interface ChatComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  autoFocus?: boolean;
}

const MAX_HEIGHT = 160;

/** Sticky bottom composer: Enter sends, Shift+Enter adds a newline. */
export function ChatComposer({
  value,
  onValueChange,
  onSend,
  onStop,
  streaming,
  autoFocus = false,
}: ChatComposerProps) {
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
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

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
          placeholder={streaming ? "Answering…" : "Ask about your lab…"}
          aria-label="Message the PolySIEM assistant"
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
                aria-label="Stop generating"
                className="rounded-lg"
              >
                <Square className="size-3.5" fill="currentColor" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Stop generating</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            type="button"
            size="icon-sm"
            onClick={onSend}
            disabled={!canSend}
            aria-label="Send message"
            className="rounded-lg"
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
        Enter to send · Shift+Enter for a new line · mic uses private server
        transcription
      </p>
    </div>
  );
}
