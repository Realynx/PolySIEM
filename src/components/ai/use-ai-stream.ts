"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { aiTasks } from "@/lib/validators/ai";

export type AiTask = (typeof aiTasks)[number];

export type AiEntityType = "device" | "vm" | "container" | "network" | "service" | "firewall_rule";

export interface AiStreamState {
  status: "idle" | "streaming" | "done" | "error";
  text: string;
  error: string | null;
}

export interface AiStartOptions {
  entity?: { type: AiEntityType; id: string };
  text?: string;
}

const IDLE: AiStreamState = { status: "idle", text: "", error: null };

function requestBody(task: AiTask, opts: AiStartOptions): string {
  return JSON.stringify({
    task,
    ...(opts.entity ? { entityType: opts.entity.type, entityId: opts.entity.id } : {}),
    ...(opts.text !== undefined ? { text: opts.text } : {}),
  });
}

async function responseError(response: Response): Promise<Error> {
  let message = `AI request failed (HTTP ${response.status})`;
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) message = body.error.message;
  } catch { /* Keep the HTTP fallback. */ }
  return new Error(message);
}

async function readResponse(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onText(text);
  }
  return text + decoder.decode();
}

/**
 * Stream text from POST /api/ai/generate. `start` resolves with the full text
 * (or null on error/cancel); progressive chunks land in `text` as they arrive.
 */
export function useAiStream() {
  const [state, setState] = useState<AiStreamState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(IDLE);
  }, []);

  const start = useCallback(async (task: AiTask, opts: AiStartOptions = {}): Promise<string | null> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "streaming", text: "", error: null });

    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody(task, opts),
        signal: controller.signal,
      });

      if (!res.ok) throw await responseError(res);
      if (!res.body) throw new Error("The AI response had no body");
      const text = await readResponse(res.body, (value) => setState({ status: "streaming", text: value, error: null }));
      setState({ status: "done", text, error: null });
      return text;
    } catch (err) {
      if (controller.signal.aborted) {
        setState(IDLE);
        return null;
      }
      const message = err instanceof Error ? err.message : "AI request failed";
      setState((prev) => ({ status: "error", text: prev.text, error: message }));
      return null;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  return { ...state, start, cancel, reset };
}

export interface AiModelsInfo {
  models: string[];
  enabled: boolean;
  model: string;
}

/** Cached view of /api/ai/models — used by AI components to self-hide when disabled. */
export function useAiModels() {
  return useQuery<AiModelsInfo>({
    queryKey: ["ai", "models"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch("/api/ai/models");
      if (!res.ok) throw new Error(`Failed to load AI status (HTTP ${res.status})`);
      const body = (await res.json()) as { data: AiModelsInfo };
      return body.data;
    },
  });
}
