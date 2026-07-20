"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { feedSse } from "@/components/chat/sse";
import type {
  AgentToolCall,
  ChatMessage,
  DocInterviewGoal,
  InterviewServicePlan,
} from "@/lib/ai/agent/contract";
import type { DocInterviewMode } from "@/lib/ai/agent/runtime";
import {
  compactInterviewMessages,
  interviewFailureMessage,
  interviewKickoff,
  parseInterviewServicePlan,
  upsertToolCall,
} from "./ai-interview-lib";

export type DocInterviewPhase = "interview" | "services";
export type DocInterviewStatus = "idle" | "streaming" | "error";

export interface DocInterviewStreamDraft {
  content: string;
  toolCalls: AgentToolCall[];
}

/** State and actions exposed to the interview panel presentation. */
export interface UseDocInterviewResult {
  messages: ChatMessage[];
  draft: DocInterviewStreamDraft | null;
  status: DocInterviewStatus;
  error: string | null;
  phase: DocInterviewPhase;
  servicePlan: InterviewServicePlan | null;
  goal: DocInterviewGoal;
  start: (selectedGoal: DocInterviewGoal) => void;
  answer: (text: string) => void;
  generateServices: () => void;
  retry: () => void;
  stop: () => void;
  backToInterview: () => void;
  reset: () => void;
}

/**
 * Drives the AI documentation interview: streams grounded questions, collects
 * answers, and transitions into service review when requested using the
 * frozen AgentStreamEvent SSE contract.
 */
export function useDocInterview(): UseDocInterviewResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<DocInterviewStreamDraft | null>(null);
  const [status, setStatus] = useState<DocInterviewStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<DocInterviewPhase>("interview");
  const [servicePlan, setServicePlan] = useState<InterviewServicePlan | null>(
    null,
  );
  const [goal, setGoal] = useState<DocInterviewGoal>("both");

  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const goalRef = useRef<DocInterviewGoal>("both");
  goalRef.current = goal;
  const abortRef = useRef<AbortController | null>(null);
  const lastRunRef = useRef<{
    messages: ChatMessage[];
    mode: DocInterviewMode;
  } | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const runStream = useCallback(
    async (sendMessages: ChatMessage[], mode: DocInterviewMode) => {
      lastRunRef.current = { messages: sendMessages, mode };
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      setStatus("streaming");
      setError(null);
      setDraft({ content: "", toolCalls: [] });

      let acc = "";
      let tools: AgentToolCall[] = [];
      let sawTerminal = false;
      let sawError = false;

      const finishInterview = () => {
        if (acc.trim() || tools.length > 0) {
          setMessages((previous) => [
            ...previous,
            {
              role: "assistant",
              content: acc,
              ...(tools.length > 0 ? { toolCalls: tools } : {}),
            },
          ]);
        }
        setDraft(null);
        setStatus("idle");
      };

      try {
        const requestMessages = compactInterviewMessages(
          sendMessages,
          mode === "services" ? 30 : 16,
        );
        const response = await fetch("/api/ai/doc-draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: requestMessages,
            mode,
            goal: goalRef.current,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          setStatus("error");
          setError(interviewFailureMessage(response.status));
          setDraft(null);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const handle = (chunk: string) => {
          const result = feedSse(buffer, chunk);
          buffer = result.buffer;
          for (const event of result.events) {
            switch (event.type) {
              case "token":
                acc += event.text;
                setDraft((current) => ({
                  content: (current?.content ?? "") + event.text,
                  toolCalls: current?.toolCalls ?? tools,
                }));
                break;
              case "tool_call":
              case "tool_result":
                tools = upsertToolCall(tools, event.call);
                setDraft((current) => ({
                  content: current?.content ?? acc,
                  toolCalls: tools,
                }));
                break;
              case "done":
                sawTerminal = true;
                if (event.content) acc = event.content;
                if (event.toolCalls.length > 0) tools = event.toolCalls;
                break;
              case "error":
                sawTerminal = true;
                sawError = true;
                setError(event.message);
                break;
              default:
                break;
            }
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          handle(decoder.decode(value, { stream: true }));
        }
        handle(decoder.decode());
        handle("\n\n");

        if (sawError) {
          setDraft(null);
          setStatus("error");
          return;
        }
        if (!sawTerminal) {
          setDraft(null);
          setStatus("error");
          setError("The interviewer stream ended unexpectedly.");
          return;
        }

        if (mode === "interview") {
          finishInterview();
        } else {
          try {
            setServicePlan(parseInterviewServicePlan(acc));
            setDraft(null);
            setStatus("idle");
            setPhase("services");
          } catch (parseError) {
            setDraft(null);
            setStatus("error");
            setError(
              parseError instanceof Error
                ? parseError.message
                : "The service proposal could not be reviewed.",
            );
          }
        }
      } catch (error) {
        if (controller.signal.aborted) {
          // reset/end intentionally discarded this run; do not resurrect its
          // partial assistant turn after the interview has been cleared.
          if (abortRef.current !== controller) return;
          // Stop pressed: keep whatever streamed so the user isn't stranded.
          if (mode === "interview") {
            finishInterview();
          } else {
            setDraft(null);
            setStatus("idle");
          }
        } else {
          setDraft(null);
          setStatus("error");
          setError(
            error instanceof Error && error.message
              ? `Could not reach the interviewer: ${error.message}`
              : "Could not reach the documentation interviewer.",
          );
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [],
  );

  const start = useCallback(
    (selectedGoal: DocInterviewGoal) => {
      if (messagesRef.current.length > 0) return;
      goalRef.current = selectedGoal;
      setGoal(selectedGoal);
      const seeded = [interviewKickoff(selectedGoal)];
      setMessages(seeded);
      void runStream(seeded, "interview");
    },
    [runStream],
  );

  const answer = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || abortRef.current) return;
      const next: ChatMessage[] = [
        ...messagesRef.current,
        { role: "user", content: trimmed },
      ];
      setMessages(next);
      void runStream(next, "interview");
    },
    [runStream],
  );

  const generateServices = useCallback(() => {
    if (abortRef.current || messagesRef.current.length < 2) return;
    setPhase("services");
    void runStream(messagesRef.current, "services");
  }, [runStream]);

  const retry = useCallback(() => {
    const last = lastRunRef.current;
    if (!last || abortRef.current) return;
    void runStream(last.messages, last.mode);
  }, [runStream]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const backToInterview = useCallback(() => {
    abortRef.current?.abort();
    setPhase("interview");
    setServicePlan(null);
    setStatus("idle");
    setError(null);
    setDraft(null);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    lastRunRef.current = null;
    setMessages([]);
    setDraft(null);
    setStatus("idle");
    setError(null);
    setPhase("interview");
    setServicePlan(null);
    setGoal("both");
  }, []);

  return {
    messages,
    draft,
    status,
    error,
    phase,
    servicePlan,
    goal,
    start,
    answer,
    generateServices,
    retry,
    stop,
    backToInterview,
    reset,
  };
}
