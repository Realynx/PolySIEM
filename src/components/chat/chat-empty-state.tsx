"use client";

import { Sparkles } from "lucide-react";

const EXAMPLE_PROMPTS = [
  "What is 10.0.3.16?",
  "Any suspicious activity today?",
  "Show my workflows",
  "Document the pikvm host",
];

/** Shown when the transcript is empty: a short intro plus clickable example prompts. */
export function ChatEmptyState({ onPrompt }: { onPrompt: (prompt: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="size-5" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">Ask PolySIEM anything</p>
        <p className="text-sm text-balance text-muted-foreground">
          Search your inventory, research IPs and security events, write docs, or run workflows —
          right from any page.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5" aria-label="Example prompts">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPrompt(prompt)}
            className="rounded-full border bg-muted/50 px-3 py-1 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
