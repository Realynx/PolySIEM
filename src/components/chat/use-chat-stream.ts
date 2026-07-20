"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ChatContext, ChatMessage } from "@/lib/ai/agent/contract";
import { feedSse } from "./sse";
import {
  canRetry,
  initialTranscriptState,
  transcriptReducer,
  type ChatTranscriptState,
} from "./transcript";

/**
 * Chat streaming hook: POSTs the transcript to /api/ai/chat, consumes the SSE
 * response (token / tool_call / tool_result / done / error events) and drives
 * the pure transcript reducer. AbortController backs the stop button.
 */

function failureMessage(status: number): string {
  if (status === 404 || status === 501) {
    return "The assistant endpoint is not available yet. Try again once the AI service is set up.";
  }
  if (status === 401) return "Your session has expired — sign in again to use the assistant.";
  if (status === 403) return "You do not have permission to use the assistant.";
  if (status === 429) return "The assistant is busy right now. Give it a moment and retry.";
  return `The assistant request failed (HTTP ${status}).`;
}

export interface UseChatStreamResult {
  state: ChatTranscriptState;
  /** True when retry() would do something useful. */
  retryable: boolean;
  send: (text: string, context?: ChatContext) => void;
  retry: (context?: ChatContext) => void;
  /** Abort the in-flight stream, keeping any partial answer. */
  stop: () => void;
  /** Clear the conversation ("New chat"). */
  reset: () => void;
  /** Restore a persisted transcript (e.g. from sessionStorage). */
  hydrate: (messages: ChatMessage[]) => void;
}

export function useChatStream(): UseChatStreamResult {
  const [state, dispatch] = useReducer(transcriptReducer, initialTranscriptState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const runStream = useCallback(async (messages: ChatMessage[], context?: ChatContext) => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context ? { messages, context } : { messages }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        dispatch({ type: "fail", message: failureMessage(res.status) });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawTerminal = false;

      const emit = (chunk: string) => {
        const result = feedSse(buffer, chunk);
        buffer = result.buffer;
        for (const event of result.events) {
          if (event.type === "done" || event.type === "error") sawTerminal = true;
          dispatch({ type: "event", event });
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        emit(decoder.decode(value, { stream: true }));
      }
      // Flush any trailing frame that was not double-newline terminated.
      emit(decoder.decode());
      emit("\n\n");

      if (!sawTerminal) {
        dispatch({ type: "fail", message: "The assistant stream ended unexpectedly." });
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // User pressed stop (or the dock unmounted) — keep the partial answer.
        dispatch({ type: "stop" });
      } else {
        dispatch({
          type: "fail",
          message:
            err instanceof Error && err.message
              ? `Could not reach the assistant: ${err.message}`
              : "Could not reach the assistant.",
        });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  const send = useCallback(
    (text: string, context?: ChatContext) => {
      const trimmed = text.trim();
      if (!trimmed || stateRef.current.status === "streaming") return;
      const messages: ChatMessage[] = [
        ...stateRef.current.messages,
        { role: "user", content: trimmed },
      ];
      dispatch({ type: "send", text: trimmed });
      void runStream(messages, context);
    },
    [runStream],
  );

  const retry = useCallback(
    (context?: ChatContext) => {
      if (!canRetry(stateRef.current)) return;
      dispatch({ type: "resend" });
      void runStream(stateRef.current.messages, context);
    },
    [runStream],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "reset" });
  }, []);

  const hydrate = useCallback((messages: ChatMessage[]) => {
    if (stateRef.current.status === "streaming") return;
    dispatch({ type: "hydrate", messages });
  }, []);

  return { state, retryable: canRetry(state), send, retry, stop, reset, hydrate };
}
