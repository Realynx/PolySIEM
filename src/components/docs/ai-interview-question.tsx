"use client";

import { useMemo, useState } from "react";
import { Check, ChevronRight, MessageCircleQuestion } from "lucide-react";
import { MicButton } from "@/components/speech/mic-button";
import { useDictationText } from "@/components/speech/use-dictation-text";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  InterviewQuestionAnswer,
  InterviewQuestionPrompt,
} from "./ai-interview-lib";

interface AiInterviewQuestionProps {
  prompt: InterviewQuestionPrompt;
  disabled?: boolean;
  onSubmit: (answers: InterviewQuestionAnswer[]) => void;
}

interface CustomAnswerFieldProps {
  value: string;
  active: boolean;
  disabled: boolean;
  onActivate: () => void;
  onChange: (value: string) => void;
}

function CustomAnswerField({
  value,
  active,
  disabled,
  onActivate,
  onChange,
}: CustomAnswerFieldProps) {
  const dictation = useDictationText(value, onChange);

  return (
    <div
      className={cn(
        "flex items-end gap-2 rounded-xl border border-dashed bg-background/45 p-2 transition-colors",
        active && "border-primary bg-primary/[0.04] ring-2 ring-primary/15",
      )}
    >
      <Textarea
        rows={2}
        value={value}
        disabled={disabled}
        onFocus={onActivate}
        onChange={(event) => {
          onActivate();
          onChange(event.target.value);
        }}
        placeholder="Type your own answer…"
        aria-label="Custom answer"
        className="min-h-16 flex-1 resize-y border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <MicButton
        onTranscript={dictation.onTranscript}
        onInterim={dictation.onInterim}
        onRecordingStart={() => {
          onActivate();
          dictation.onRecordingStart();
        }}
        onDictationCancel={dictation.onDictationCancel}
        disabled={disabled}
        className="mb-1 rounded-lg"
      />
    </div>
  );
}

/** Modal form emitted by the interview question tool for a 1-5 question batch. */
export function AiInterviewQuestion({
  prompt,
  disabled = false,
  onSubmit,
}: AiInterviewQuestionProps) {
  const [selections, setSelections] = useState<(number | "custom" | null)[]>(
    () => prompt.questions.map(() => null),
  );
  const [customAnswers, setCustomAnswers] = useState<string[]>(() =>
    prompt.questions.map(() => ""),
  );

  const answers = useMemo(
    () =>
      prompt.questions.map((question, index): InterviewQuestionAnswer | null => {
        const selection = selections[index];
        const answer =
          selection === "custom"
            ? customAnswers[index]?.trim()
            : typeof selection === "number"
              ? question.options[selection]?.answer.trim()
              : "";
        return answer
          ? {
              questionId: question.id,
              question: question.question,
              answer,
            }
          : null;
      }),
    [customAnswers, prompt.questions, selections],
  );
  const completed = answers.filter((answer) => answer !== null).length;
  const canSubmit = !disabled && completed === prompt.questions.length;

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        className="max-h-[90svh] gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b bg-gradient-to-br from-primary/[0.09] via-card to-card px-5 py-4">
          <div className="flex items-start gap-3 pr-8">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <MessageCircleQuestion className="size-4.5" aria-hidden />
            </div>
            <div className="min-w-0">
              <DialogTitle>Interview questions</DialogTitle>
              <DialogDescription className="mt-1">
                Choose a suggested answer or enter a custom answer for each
                question. All answers are submitted together with their
                question context.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 overflow-y-auto overscroll-contain px-5 py-4">
          {prompt.questions.map((question, questionIndex) => (
            <fieldset key={question.id} className="space-y-3">
              <legend className="w-full text-sm leading-5 font-medium">
                <span className="mr-2 text-xs font-semibold tracking-wide text-primary uppercase">
                  Question {questionIndex + 1}
                </span>
                {question.question}
              </legend>

              <div className="grid gap-2 sm:grid-cols-2">
                {question.options.map((option, optionIndex) => {
                  const selected = selections[questionIndex] === optionIndex;
                  return (
                    <button
                      key={`${option.label}-${optionIndex}`}
                      type="button"
                      disabled={disabled}
                      aria-pressed={selected}
                      onClick={() =>
                        setSelections((current) =>
                          current.map((value, index) =>
                            index === questionIndex ? optionIndex : value,
                          ),
                        )
                      }
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-xl border bg-background/85 px-3.5 py-3 text-left outline-none transition-all hover:border-primary/40 hover:bg-accent/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                        selected &&
                          "border-primary bg-primary/[0.06] ring-2 ring-primary/15",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {option.label}
                        </span>
                        {option.description && (
                          <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                            {option.description}
                          </span>
                        )}
                      </span>
                      {selected ? (
                        <Check className="size-4 shrink-0 text-primary" aria-hidden />
                      ) : (
                        <ChevronRight
                          className="size-4 shrink-0 text-muted-foreground group-hover:text-primary"
                          aria-hidden
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              <CustomAnswerField
                value={customAnswers[questionIndex] ?? ""}
                active={selections[questionIndex] === "custom"}
                disabled={disabled}
                onActivate={() =>
                  setSelections((current) =>
                    current.map((value, index) =>
                      index === questionIndex ? "custom" : value,
                    ),
                  )
                }
                onChange={(value) =>
                  setCustomAnswers((current) =>
                    current.map((answer, index) =>
                      index === questionIndex ? value : answer,
                    ),
                  )
                }
              />
            </fieldset>
          ))}
        </div>

        <DialogFooter className="m-0 shrink-0 items-center justify-between rounded-none px-5 py-3 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            {completed} of {prompt.questions.length} answered
          </p>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              onSubmit(
                answers.filter(
                  (answer): answer is InterviewQuestionAnswer => answer !== null,
                ),
              )
            }
          >
            Submit {prompt.questions.length === 1 ? "answer" : "answers"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
