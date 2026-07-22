"use client";

import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageComposerInput } from "@/components/chat/message-composer-input";

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
}

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
}: AiInterviewComposerProps) {
  return (
    <div className="border-t bg-popover p-3">
      <MessageComposerInput {...{ value, onValueChange, onSend, onStop, streaming, autoFocus }} idlePlaceholder="Type or dictate your answer…" streamingPlaceholder="The interviewer is working…" ariaLabel="Answer the documentation interviewer" sendLabel="Send answer" stopLabel="Stop" />
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
