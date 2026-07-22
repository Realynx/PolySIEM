"use client";

import { MessageComposerInput } from "./message-composer-input";

interface ChatComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  autoFocus?: boolean;
}

/** Sticky bottom composer: Enter sends, Shift+Enter adds a newline. */
export function ChatComposer({
  value,
  onValueChange,
  onSend,
  onStop,
  streaming,
  autoFocus = false,
}: ChatComposerProps) {
  return (
    <div className="border-t bg-popover p-3">
      <MessageComposerInput {...{ value, onValueChange, onSend, onStop, streaming, autoFocus }} idlePlaceholder="Ask about your lab…" streamingPlaceholder="Answering…" ariaLabel="Message the PolySIEM assistant" sendLabel="Send message" stopLabel="Stop generating" />
      <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
        Enter to send · Shift+Enter for a new line · mic uses private server
        transcription
      </p>
    </div>
  );
}
