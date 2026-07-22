import "server-only";
import { randomUUID } from "node:crypto";
import { HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { isMockMode } from "@/lib/ai/ollama";
import {
  CHAT_SYSTEM_PROMPT,
  DOC_SERVICE_PLAN_INSTRUCTION,
  DOC_SERVICE_PLAN_SYSTEM_PROMPT,
  SCRIPT_SYSTEM_PROMPT,
  contextPrimer,
  docInterviewSystemPrompt,
  interviewServicePlanSchema,
} from "@/lib/ai/agent/prompts";
import { mockChat } from "@/lib/ai/agent/mock";
import type {
  AgentStreamEvent,
  ChatMessage,
  DocInterviewGoal,
} from "@/lib/ai/agent/contract";
import {
  buildChatModel,
  configErrorFor,
  friendlyError,
  newContext,
  resolveModel,
  runAgentStream,
  toLangchainMessages,
  type AgentRunOptions,
  type RunState,
} from "./runtime-core";
import { mockDocInterview } from "./runtime-interview-mock";
import { compactInterviewMessages } from "./interview-context";

export async function* runChat(
  messages: ChatMessage[],
  opts: AgentRunOptions,
): AsyncGenerator<AgentStreamEvent, void> {
  const resolved = await resolveModel();
  const { baseUrl, model } = resolved;

  if (resolved.provider === "ollama" && isMockMode(baseUrl)) {
    yield* mockChat(messages);
    return;
  }

  const cfgErr = configErrorFor(
    resolved,
    "No Ollama model is configured. Set one in Settings to use the assistant.",
  );
  if (cfgErr) {
    yield { type: "error", message: cfgErr };
    return;
  }

  const ctx = newContext("chat", opts.role, opts);
  const state: RunState = { ctx, toolCalls: [], transcript: [], finalText: "" };
  const chat = buildChatModel(resolved);
  const systemPrompt = `${CHAT_SYSTEM_PROMPT}${contextPrimer(opts.chatContext)}`;

  try {
    yield* runAgentStream(
      chat,
      systemPrompt,
      toLangchainMessages(messages),
      state,
    );
  } catch (err) {
    yield { type: "error", message: friendlyError(err, model) };
    return;
  }

  yield { type: "done", content: state.finalText, toolCalls: state.toolCalls };
}

/* ------------------------------ english script ---------------------------- */

export interface ScriptRunOptions extends AgentRunOptions {
  /** Extra operator instructions appended to the script system prompt. */
  system?: string;
  /**
   * Bind the tool set (default true). Read/write gating still follows
   * buildToolSet: write tools require role "ADMIN".
   */
  toolsEnabled?: boolean;
  /** Max tool-calling iterations before the run is stopped. */
  maxIterations?: number;
  /** Model/deployment name for this run only; credentials stay as configured. */
  modelOverride?: string;
  /** Wall-clock budget in ms (default AGENT_TIMEOUT_MS). */
  timeoutMs?: number;
  /**
   * Workflow-id call chain of the run this script is a step of, including the
   * current workflow. Threaded to the run_workflow tool so launching a
   * workflow from a script obeys the engine's cycle/depth guards.
   */
  workflowChain?: string[];
}

/** LangGraph counts a model turn and a tool turn as separate super-steps. */
function recursionLimitFor(maxIterations: number | undefined): number | undefined {
  if (!maxIterations || maxIterations < 1) return undefined;
  return maxIterations * 2 + 1;
}

function isRecursionLimitError(err: unknown): boolean {
  if (err instanceof Error && err.name === "GraphRecursionError") return true;
  const raw = err instanceof Error ? err.message : String(err);
  return /recursion limit/i.test(raw);
}

/**
 * Run one self-directed natural-language "script": a single elaborate operator
 * instruction the agent carries out with the normal PolySIEM tool surface. Same
 * machinery as runChat (provider resolution, tool set, streaming, redaction),
 * with the knobs a workflow node needs — tools on/off, an iteration cap, a time
 * budget, and a per-run model override.
 *
 * Never throws: configuration and model failures surface as a terminal `error`
 * event. A run that hits the iteration cap after doing real work still finishes
 * with `done` (its content carries a visible truncation note) so partial
 * findings are not discarded.
 */
export async function* runScript(
  script: string,
  opts: ScriptRunOptions,
): AsyncGenerator<AgentStreamEvent, void> {
  const resolved = await resolveModel();
  const { baseUrl, model } = resolved;
  const label = opts.modelOverride?.trim() || model;

  if (resolved.provider === "ollama" && isMockMode(baseUrl)) {
    yield* mockChat([{ role: "user", content: script }]);
    return;
  }

  const cfgErr = configErrorFor(
    resolved,
    "No Ollama model is configured. Set one under Settings → AI assistant to run English script steps.",
  );
  if (cfgErr) {
    yield { type: "error", message: cfgErr };
    return;
  }

  const ctx = newContext("chat", opts.role, opts);
  const state: RunState = { ctx, toolCalls: [], transcript: [], finalText: "" };

  let chat: BaseChatModel;
  try {
    chat = buildChatModel(resolved, opts.modelOverride);
  } catch (err) {
    yield { type: "error", message: friendlyError(err, label) };
    return;
  }

  const extra = opts.system?.trim();
  const systemPrompt = extra
    ? `${SCRIPT_SYSTEM_PROMPT}\n\nAdditional operator instructions:\n${extra}`
    : SCRIPT_SYSTEM_PROMPT;

  try {
    yield* runAgentStream(
      chat,
      systemPrompt,
      [new HumanMessage(script)],
      state,
      {
        toolsEnabled: opts.toolsEnabled !== false,
        recursionLimit: recursionLimitFor(opts.maxIterations),
        timeoutMs: opts.timeoutMs,
      },
    );
  } catch (err) {
    if (isRecursionLimitError(err)) {
      const note = `[Stopped: reached the ${opts.maxIterations}-iteration tool-call limit before the script finished.]`;
      if (state.toolCalls.length || state.finalText.trim()) {
        yield {
          type: "done",
          content: `${state.finalText.trim()}\n\n${note}`.trim(),
          toolCalls: state.toolCalls,
        };
        return;
      }
      yield {
        type: "error",
        message: `The script hit its tool-call iteration limit (${opts.maxIterations}) without producing an answer. Raise the limit or simplify the instruction.`,
      };
      return;
    }
    yield { type: "error", message: friendlyError(err, label) };
    return;
  }

  yield { type: "done", content: state.finalText, toolCalls: state.toolCalls };
}

/* --------------------------- documentation interview ---------------------- */

export type DocInterviewMode = "interview" | "services";

export interface DocInterviewOptions extends AgentRunOptions {
  /** Live documentation interview or reviewable service-inventory proposal. */
  mode: DocInterviewMode;
  goal: DocInterviewGoal;
}

function interviewPrompt(opts: DocInterviewOptions): string {
  return opts.mode === "services" ? DOC_SERVICE_PLAN_SYSTEM_PROMPT : docInterviewSystemPrompt(opts.goal);
}

/**
 * Interview turns often need to inspect inventory and several documentation
 * pages before writing and asking a question. LangGraph's default of 25
 * super-steps is too small for that legitimate work (each model/tool round
 * consumes two); the wall-clock timeout remains the primary runaway guard.
 */
const DOC_INTERVIEW_RECURSION_LIMIT = 64;
const DEFAULT_CONTEXT_WINDOW_TOKENS = 32_768;
const contextWindowCache = new Map<string, Promise<number>>();

function contextLengthFromModelInfo(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const [key, candidate] of Object.entries(value)) {
    if (
      key.endsWith(".context_length") &&
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate > 0
    ) {
      return Math.floor(candidate);
    }
  }
  return null;
}

/** Resolve the actual local model window when possible; hosted defaults are
 * conservative and only control when conversation history is compacted. */
async function contextWindowFor(resolved: Awaited<ReturnType<typeof resolveModel>>): Promise<number> {
  if (resolved.provider === "anthropic") return 200_000;
  if (resolved.provider === "deepseek") return 64_000;
  if (resolved.provider !== "ollama") return 128_000;

  const key = `${resolved.baseUrl}\n${resolved.model}`;
  const cached = contextWindowCache.get(key);
  if (cached) return cached;

  const lookup = (async () => {
    try {
      const response = await fetch(
        `${resolved.baseUrl.replace(/\/+$/, "")}/api/show`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: resolved.model }),
          cache: "no-store",
          signal: AbortSignal.timeout(2_000),
        },
      );
      if (!response.ok) return DEFAULT_CONTEXT_WINDOW_TOKENS;
      const body = (await response.json()) as { model_info?: unknown };
      return (
        contextLengthFromModelInfo(body.model_info) ??
        DEFAULT_CONTEXT_WINDOW_TOKENS
      );
    } catch {
      return DEFAULT_CONTEXT_WINDOW_TOKENS;
    }
  })();
  contextWindowCache.set(key, lookup);
  return lookup;
}

/**
 * Run one turn of the AI documentation interview. Reuses the chat tool set +
 * SSE contract as runChat, but swaps the system prompt:
 *   - mode "interview": the agent inspects real inventory and asks the next
 *     focused question. Yields token / tool_call / tool_result then `done`
 *     whose `content` is the question.
 * Documentation changes happen through write_doc tool calls before the next
 * question is returned.
 * Never throws to the caller: model/timeout failures surface as a terminal
 * `error` event so the UI can show a clean retry.
 */
export async function* runDocInterview(
  messages: ChatMessage[],
  opts: DocInterviewOptions,
): AsyncGenerator<AgentStreamEvent, void> {
  const resolved = await resolveModel();
  const { baseUrl, model } = resolved;

  if (resolved.provider === "ollama" && isMockMode(baseUrl)) {
    yield* mockDocInterview(messages, opts.mode);
    return;
  }

  const cfgErr = configErrorFor(
    resolved,
    "No Ollama model is configured. Set one in Settings to use the documentation interviewer.",
  );
  if (cfgErr) {
    yield { type: "error", message: cfgErr };
    return;
  }

  const ctx = newContext("doc-interview", opts.role, opts);
  const state: RunState = { ctx, toolCalls: [], transcript: [], finalText: "" };
  const chat = buildChatModel(resolved);
  const systemPrompt = interviewPrompt(opts);

  const contextWindowTokens = await contextWindowFor(resolved);
  const prepared = compactInterviewMessages(messages, {
    contextWindowTokens,
    systemPrompt,
  });
  const runMessages = prepared.messages;

  if (prepared.compacted) {
    const id = `auto-compact-${randomUUID()}`;
    const args = {
      reason: "automatic",
      summary:
        "Confirmed facts from earlier turns are saved in the documentation; reread the relevant pages before continuing.",
    };
    const running = {
      id,
      kind: "compact_interview" as const,
      name: "compact_interview",
      args,
      label: "Compacting earlier interview context",
      status: "running" as const,
    };
    yield { type: "tool_call", call: running };
    const completed = {
      ...running,
      status: "success" as const,
      resultPreview: JSON.stringify({
        automatic: true,
        estimatedTokens: prepared.estimatedTokens,
        thresholdTokens: prepared.thresholdTokens,
      }),
    };
    state.toolCalls.push(completed);
    yield { type: "tool_result", call: completed };
  }

  const lcMessages = toLangchainMessages(runMessages);
  if (opts.mode === "services")
    lcMessages.push(new HumanMessage(DOC_SERVICE_PLAN_INSTRUCTION));

  try {
    yield* runAgentStream(chat, systemPrompt, lcMessages, state, {
      recursionLimit: DOC_INTERVIEW_RECURSION_LIMIT,
    });
  } catch (err) {
    if (isRecursionLimitError(err)) {
      // A question tool may have completed on the final allowed super-step.
      // It is already visible in the stream and is safe to answer, so do not
      // replace that useful turn with a failure banner.
      const presentedQuestion = state.toolCalls.some(
        (call) => call.name === "ask_question" && call.status === "success",
      );
      if (opts.mode === "interview" && presentedQuestion) {
        yield {
          type: "done",
          content: state.finalText,
          toolCalls: state.toolCalls,
        };
        return;
      }
      yield {
        type: "error",
        message:
          "The interviewer made too many tool calls in one turn. Completed documentation edits are already saved; retry to continue from them.",
      };
      return;
    }
    yield { type: "error", message: friendlyError(err, model) };
    return;
  }

  if (
    opts.mode === "interview" &&
    !state.finalText.trim() &&
    !state.toolCalls.some(
      (call) => call.name === "ask_question" && call.status === "success",
    )
  ) {
    yield {
      type: "error",
      message:
        "The interviewer completed its tool work but did not produce the next question. Completed documentation edits are saved; retry to continue.",
    };
    return;
  }

  if (opts.mode === "services") {
    const cleaned = state.finalText
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    try {
      state.finalText = JSON.stringify(
        interviewServicePlanSchema.parse(JSON.parse(cleaned)),
      );
    } catch {
      yield {
        type: "error",
        message:
          "The interviewer could not produce a valid service proposal. Retry, or return to the interview and clarify what runs where.",
      };
      return;
    }
  }

  yield { type: "done", content: state.finalText, toolCalls: state.toolCalls };
}
