"use client";

import { useCallback, useEffect, useRef } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MicButton } from "@/components/speech/mic-button";
import { useDictationText } from "@/components/speech/use-dictation-text";
import { cn } from "@/lib/utils";

const MAX_HEIGHT = 160;

export function MessageComposerInput({
  value, onValueChange, onSend, onStop, streaming, autoFocus,
  idlePlaceholder, streamingPlaceholder, ariaLabel, sendLabel, stopLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  autoFocus: boolean;
  idlePlaceholder: string;
  streamingPlaceholder: string;
  ariaLabel: string;
  sendLabel: string;
  stopLabel: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dictation = useDictationText(value, onValueChange);
  const resize = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
  }, []);
  useEffect(resize, [value, resize]);
  useEffect(() => { if (autoFocus) textareaRef.current?.focus(); }, [autoFocus]);
  const canSend = !streaming && value.trim().length > 0;

  return (
    <div className="flex items-end gap-2 rounded-xl border bg-background p-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (canSend) onSend();
        }}
        placeholder={streaming ? streamingPlaceholder : idlePlaceholder}
        aria-label={ariaLabel}
        disabled={streaming}
        className={cn("max-h-40 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-5 outline-none placeholder:text-muted-foreground", streaming && "opacity-60")}
      />
      <MicButton {...dictation} disabled={streaming} className="rounded-lg" />
      {streaming ? (
        <Tooltip><TooltipTrigger asChild><Button type="button" size="icon-sm" variant="destructive" onClick={onStop} aria-label={stopLabel} className="rounded-lg"><Square className="size-3.5" fill="currentColor" /></Button></TooltipTrigger><TooltipContent side="top">{stopLabel}</TooltipContent></Tooltip>
      ) : (
        <Button type="button" size="icon-sm" onClick={onSend} disabled={!canSend} aria-label={sendLabel} className="rounded-lg"><ArrowUp className="size-4" /></Button>
      )}
    </div>
  );
}
