"use client";

import { ChevronRight, MessageCircleQuestion, Mic, PenLine } from "lucide-react";
import type { InterviewQuestionPrompt } from "./ai-interview-lib";

interface AiInterviewQuestionProps {
  prompt: InterviewQuestionPrompt;
  disabled?: boolean;
  onSelect: (answer: string) => void;
  onCustom: () => void;
}

/** Structured single-select prompt emitted by the interview question tool. */
export function AiInterviewQuestion({
  prompt,
  disabled = false,
  onSelect,
  onCustom,
}: AiInterviewQuestionProps) {
  return (
    <section
      aria-label="Suggested answers"
      aria-live="polite"
      className="overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.07] via-card to-card shadow-sm"
    >
      <div className="flex items-start gap-3 border-b border-primary/10 px-4 py-3.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <MessageCircleQuestion className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-wide text-primary uppercase">
            Quick answer
          </p>
          <h3 className="mt-0.5 text-sm leading-5 font-medium">
            {prompt.question}
          </h3>
        </div>
      </div>

      <div className="grid gap-2 p-3 sm:grid-cols-2">
        {prompt.options.map((option) => (
          <button
            key={`${option.label}-${option.answer}`}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(option.answer)}
            className="group flex w-full items-center gap-3 rounded-xl border bg-background/85 px-3.5 py-3 text-left outline-none transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent/60 hover:shadow-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{option.label}</span>
              {option.description && (
                <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary motion-reduce:transform-none" aria-hidden />
          </button>
        ))}

        <button
          type="button"
          disabled={disabled}
          onClick={onCustom}
          className="group flex w-full items-center gap-3 rounded-xl border border-dashed bg-background/45 px-3.5 py-3 text-left outline-none transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 sm:col-span-2"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-primary">
            <PenLine className="size-3.5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Another answer</span>
            <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              Type your own or use speech to text <Mic className="size-3" aria-hidden />
            </span>
          </span>
        </button>
      </div>
    </section>
  );
}
