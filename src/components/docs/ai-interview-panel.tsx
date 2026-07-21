"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  Boxes,
  FileText,
  Flag,
  Loader2,
  MonitorCog,
  RotateCw,
  ServerCog,
  Sparkles,
  SquarePen,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChatMessageView } from "@/components/chat/chat-message";
import { ToolCallList } from "@/components/chat/tool-call-chip";
import type { DocInterviewGoal } from "@/lib/ai/agent/contract";
import { AiInterviewComposer } from "./ai-interview-composer";
import {
  formatInterviewQuestionAnswers,
  interviewQuestionPrompt,
  type InterviewQuestionAnswer,
} from "./ai-interview-lib";
import { AiInterviewQuestion } from "./ai-interview-question";
import { ServicesReview } from "./services-review";
import { useDocInterview } from "./use-doc-interview";

const INTERVIEW_GOALS: {
  id: DocInterviewGoal;
  title: string;
  description: string;
  icon: typeof FileText;
  recommended?: boolean;
}[] = [
  {
    id: "both",
    title: "Build docs and catalog services",
    description:
      "Continuously build focused pages as we talk, then review service entries attached to synced hardware.",
    icon: Boxes,
    recommended: true,
  },
  {
    id: "services",
    title: "Catalog running services",
    description:
      "Interview me about what runs where, then propose inventory entries for confirmation.",
    icon: ServerCog,
  },
  {
    id: "document",
    title: "Build documentation only",
    description:
      "Create and refine a set of focused Markdown pages throughout the interview.",
    icon: FileText,
  },
];

function InterviewSetup({
  onStart,
}: {
  onStart: (goal: DocInterviewGoal) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-muted/35 p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MonitorCog className="size-4.5" aria-hidden />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-medium">
              What should this interview produce?
            </h3>
            <p className="text-xs leading-5 text-muted-foreground">
              PolySIEM cross-checks synced inventory, but it does not assume SSH
              or process access to every machine. You confirm what runs where
              before anything is added.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {INTERVIEW_GOALS.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onStart(option.id)}
              className="group flex w-full items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/45 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground group-hover:text-primary">
                <Icon className="size-4.5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{option.title}</span>
                  {option.recommended && (
                    <Badge variant="secondary">Recommended</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {option.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <p className="px-1 text-[11px] leading-4 text-muted-foreground">
        Inventory is read-only. Documentation pages are updated as you answer;
        service records are created only after you review and select them.
      </p>
    </div>
  );
}

/**
* "Interview me" launcher for the Docs page: a button that opens a right-side
 * panel where the AI interviews the operator (grounded in real inventory) and
 * produces reviewed documentation, service inventory entries, or both.
 */
export function AiInterviewLauncher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const interview = useDocInterview();
  const [input, setInput] = useState("");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const refreshedDocWritesRef = useRef("");

  const {
    phase,
    status,
    messages,
    draft,
    error,
    servicePlan,
    goal,
  } = interview;
  const streaming = status === "streaming";

  const handleOpenChange = useCallback((next: boolean) => setOpen(next), []);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    nearBottomRef.current = true;
    interview.answer(trimmed);
    setInput("");
  }, [input, streaming, interview]);

  const handleQuestionAnswers = useCallback(
    (answers: InterviewQuestionAnswer[]) => {
      if (streaming) return;
      nearBottomRef.current = true;
      interview.answer(formatInterviewQuestionAnswers(answers));
      setInput("");
    },
    [interview, streaming],
  );

  const handleFinish = useCallback(() => {
    if (streaming) return;
    if (goal !== "document") {
      interview.generateServices();
      return;
    }
    toast.success("Documentation is up to date");
    setOpen(false);
    interview.reset();
    router.refresh();
  }, [goal, interview, router, streaming]);

  const handleEnd = useCallback(() => {
    interview.reset();
    setInput("");
    setOpen(false);
    router.refresh();
    toast.success("Interview ended — completed documentation changes were kept");
  }, [interview, router]);

  // Auto-scroll while streaming, but only when already near the bottom.
  const draftContent = draft?.content ?? "";
  const draftToolCount = draft?.toolCalls.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [
    messages,
    draftContent,
    draftToolCount,
    error,
    servicePlan,
    phase,
    open,
  ]);

  // Refresh the docs tree as soon as each write tool settles. Next.js keeps
  // this client-side interview state intact while the server page data updates.
  const completedDocWriteIds = [...messages, ...(draft ? [{ ...draft, role: "assistant" as const }] : [])]
    .flatMap((message) => message.toolCalls ?? [])
    .filter((call) => call.name === "write_doc" && call.status === "success")
    .map((call) => call.id)
    .join("|");
  useEffect(() => {
    if (
      completedDocWriteIds &&
      completedDocWriteIds !== refreshedDocWritesRef.current
    ) {
      refreshedDocWritesRef.current = completedDocWriteIds;
      router.refresh();
    }
  }, [completedDocWriteIds, router]);

  // The first hidden user message is kickoff; require at least one real answer.
  const canGenerate =
    messages.filter((message) => message.role === "user").length > 1;
  const visibleTurns = messages.slice(1); // hide the kickoff turn
  const latestTurn = visibleTurns.at(-1);
  const settledQuestion =
    latestTurn?.role === "assistant"
      ? interviewQuestionPrompt(latestTurn)
      : null;
  const streamingQuestion = draft
    ? interviewQuestionPrompt({
        role: "assistant",
        content: draft.content,
        toolCalls: draft.toolCalls,
      })
    : null;
  const activeQuestion = streamingQuestion ?? settledQuestion;
  const servicesFailed =
    phase === "services" && status === "error" && !servicePlan;
  const generateLabel =
    goal === "document" ? "End interview" : "End & review services";

  return (
    <>
      <Button variant="outline" onClick={() => handleOpenChange(true)}>
        <Sparkles />
        Interview me
      </Button>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:w-[560px] data-[side=right]:sm:max-w-[560px]"
        >
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="size-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-sm">
                {messages.length === 0
                  ? "Interview me"
                  : "Infrastructure interview"}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Interview against real synced infrastructure, then review
                documentation and service inventory proposals.
              </SheetDescription>
            </div>
            {messages.length > 0 && (
              <Button
                variant="outline"
                size="xs"
                onClick={handleEnd}
                aria-label="End documentation interview"
              >
                <Flag />
                End
              </Button>
            )}
            {messages.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      interview.reset();
                      setInput("");
                    }}
                    aria-label="Start over"
                  >
                    <SquarePen />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Start over</TooltipContent>
              </Tooltip>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <X />
            </Button>
          </div>

          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              nearBottomRef.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className="flex-1 overflow-y-auto overscroll-contain"
          >
            <div className="flex flex-col gap-4 px-4 py-4">
              {messages.length === 0 && (
                <InterviewSetup onStart={interview.start} />
              )}

              {messages.length > 0 && phase === "interview" && (
                <>
                  <p className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
                    The interviewer reads existing pages, cross-checks synced
                    infrastructure, and updates the right focused docs after
                    each answer. It keeps asking through unresolved assumptions
                    and TODOs until you choose End. It does not assume SSH
                    access.
                    {goal !== "document" && (
                      <>
                        {" "}
                        Any proposed service entries stay in review until you
                        confirm them.
                      </>
                    )}
                  </p>
                  {visibleTurns.map((message, index) => {
                    const visibleTools = message.toolCalls?.filter(
                      (call) => call.name !== "ask_question",
                    );
                    return (
                      <ChatMessageView
                        key={index}
                        role={message.role}
                        content={message.content}
                        toolCalls={visibleTools}
                      />
                    );
                  })}
                  {draft && (
                    <ChatMessageView
                      role="assistant"
                      content={draft.content}
                      toolCalls={draft.toolCalls.filter(
                        (call) => call.name !== "ask_question",
                      )}
                      streaming
                    />
                  )}
                  {status === "error" && error && (
                    <ErrorBanner message={error} onRetry={interview.retry} />
                  )}
                </>
              )}

              {phase === "services" && (
                <>
                  {streaming ? (
                    <div className="flex flex-col gap-3">
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                        Matching confirmed services to synced hardware…
                      </p>
                      {draft && draft.toolCalls.length > 0 && (
                        <ToolCallList calls={draft.toolCalls} />
                      )}
                      <p className="text-xs leading-5 text-muted-foreground">
                        Checking exact device, VM, or container ids and avoiding
                        services already in inventory.
                      </p>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={interview.stop}
                        className="self-start"
                      >
                        Stop
                      </Button>
                    </div>
                  ) : servicesFailed ? (
                    <div className="flex flex-col gap-3">
                      <ErrorBanner
                        message={
                          error ??
                          "The service proposal could not be generated."
                        }
                        onRetry={interview.retry}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={interview.backToInterview}
                        className="self-start"
                      >
                        <ArrowLeft className="size-3.5" />
                        Back
                      </Button>
                    </div>
                  ) : servicePlan ? (
                    <ServicesReview
                      plan={servicePlan}
                      onBack={interview.backToInterview}
                      onComplete={() => {
                        setOpen(false);
                        interview.reset();
                        router.refresh();
                      }}
                    />
                  ) : null}
                </>
              )}
            </div>
          </div>

          {messages.length > 0 && phase === "interview" && (
            <div className="shrink-0 border-t bg-popover shadow-[0_-12px_30px_-24px_hsl(var(--foreground))]">
              <AiInterviewComposer
                value={input}
                onValueChange={setInput}
                onSend={handleSend}
                onStop={interview.stop}
                onGenerate={handleFinish}
                streaming={streaming}
                canGenerate={canGenerate}
                generateLabel={generateLabel}
                autoFocus={open}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

      {open && phase === "interview" && activeQuestion && (
        <AiInterviewQuestion
          key={activeQuestion.id}
          prompt={activeQuestion}
          disabled={streaming}
          onSubmit={handleQuestionAnswers}
        />
      )}
    </>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <p>{message}</p>
        <Button
          variant="outline"
          size="xs"
          onClick={onRetry}
          className="text-foreground"
        >
          <RotateCw /> Retry
        </Button>
      </div>
    </div>
  );
}
