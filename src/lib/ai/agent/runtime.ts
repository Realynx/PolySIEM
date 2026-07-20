/**
 * LangChain agent runtime: builds a ChatOllama, binds the mode-appropriate
 * tool set, runs the v1 agent, and yields AgentStreamEvent objects mapped from
 * `.streamEvents(v2)`. For investigate it finishes with a structured
 * InvestigationReport (a follow-up withStructuredOutput call).
 */
import "server-only";
import { createAgent } from "langchain";
import { ChatOllama } from "@langchain/ollama";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  getOllamaConfig,
  getAiScanConfig,
  type AiConfig,
  type AiProvider,
} from "@/lib/settings";
import { isMockMode } from "@/lib/ai/ollama";
import {
  buildHostedTextModel,
  resolveProvider,
  toAzureRuntime,
  toHostedRuntime,
} from "@/lib/ai/provider";
import { ApiError } from "@/lib/api";
import { redactValue, toResultPreview } from "@/lib/ai/agent/redact";
import { buildToolSet } from "@/lib/ai/agent/tools";
import type { AgentMode, SessionRole, ToolContext } from "@/lib/ai/agent/types";
import {
  CHAT_SYSTEM_PROMPT,
  INVESTIGATE_SYSTEM_PROMPT,
  DOC_SERVICE_PLAN_INSTRUCTION,
  DOC_SERVICE_PLAN_SYSTEM_PROMPT,
  SCRIPT_SYSTEM_PROMPT,
  contextPrimer,
  docInterviewSystemPrompt,
  interviewServicePlanSchema,
  investigationReportSchema,
  type InvestigationReportModel,
} from "@/lib/ai/agent/prompts";
import { mockChat, mockInvestigate } from "@/lib/ai/agent/mock";
import {
  synthesizeReport,
  type RawToolResult,
} from "@/lib/ai/agent/synthesize";
import type {
  AgentStreamEvent,
  AgentToolCall,
  AgentToolKind,
  ChatContext,
  ChatMessage,
  DocInterviewGoal,
  InvestigationReport,
} from "@/lib/ai/agent/contract";

const KNOWN_KINDS = new Set<AgentToolKind>([
  "lookup_ip_identity",
  "query_logs",
  "discover_elasticsearch_fields",
  "search_elasticsearch",
  "check_threat_intel",
  "get_firewall_context",
  "get_related_threats",
  "reverse_dns",
  "whois_asn",
  "ip_reputation",
  "search_inventory",
  "get_lab_overview",
  "get_asset_topology",
  "get_entity",
  "list_security_tickets",
  "get_security_ticket",
  "get_integration_health",
  "list_workflows",
  "run_workflow",
  "write_doc",
  "ask_question",
  "trigger_sync",
]);

/** Prevent a provider that stops streaming from leaving the UI busy forever. */
const AGENT_TIMEOUT_MS = 90_000;

function toKind(name: string): AgentToolKind {
  return KNOWN_KINDS.has(name as AgentToolKind)
    ? (name as AgentToolKind)
    : "other";
}

function labelFor(name: string, args: Record<string, unknown>): string {
  const target =
    args.ip ??
    args.term ??
    args.indicator ??
    args.query ??
    args.fullText ??
    args.fieldPattern ??
    args.entityId ??
    args.id ??
    args.slugOrId ??
    args.title ??
    args.question ??
    "";
  const pretty = name.replace(/_/g, " ");
  return target ? `${pretty}: ${String(target).slice(0, 48)}` : pretty;
}

function asRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input))
    return input as Record<string, unknown>;
  return { input };
}

function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const content = (output as { content?: unknown }).content;
    if (typeof content === "string") return content;
    try {
      return JSON.stringify(output);
    } catch {
      return String(output);
    }
  }
  return String(output ?? "");
}

/** Resolved model connection for the agent, provider-aware. */
interface ResolvedModel {
  provider: AiProvider;
  cfg: AiConfig;
  /** Ollama/base API URL. */
  baseUrl: string;
  /** Provider model/deployment name, also used as the report's model label. */
  model: string;
  enabled: boolean;
  ready: boolean;
}

async function resolveModel(): Promise<ResolvedModel> {
  const cfg = await getOllamaConfig();
  if (cfg.provider !== "ollama") {
    const { ready } = resolveProvider(cfg);
    const hostedBlock =
      cfg.provider === "azure" ? undefined : cfg[cfg.provider];
    return {
      provider: cfg.provider,
      cfg,
      baseUrl:
        cfg.provider === "azure"
          ? (cfg.azure?.endpoint ?? "")
          : (hostedBlock?.baseUrl ?? ""),
      model:
        cfg.provider === "azure"
          ? (cfg.azure?.deployment ?? "")
          : (hostedBlock?.model ?? ""),
      enabled: cfg.enabled,
      ready,
    };
  }
  let { baseUrl, model } = cfg;
  if (!model || !baseUrl) {
    const scan = await getAiScanConfig();
    baseUrl = baseUrl || scan.baseUrl;
    model = model || scan.model;
  }
  return {
    provider: "ollama",
    cfg,
    baseUrl,
    model,
    enabled: cfg.enabled,
    ready: Boolean(model),
  };
}

/**
 * Build the LangChain chat model for the active provider (tool-binding/streaming
 * are identical). `modelOverride` swaps the model/deployment name for this run
 * only — credentials and base URL always come from the configured provider.
 */
function buildChatModel(
  resolved: ResolvedModel,
  modelOverride?: string,
): BaseChatModel {
  const override = modelOverride?.trim();
  if (resolved.provider !== "ollama") {
    const runtime =
      resolved.provider === "azure"
        ? toAzureRuntime(resolved.cfg)
        : toHostedRuntime(resolved.cfg);
    if (!runtime) {
      throw new ApiError(
        400,
        `${resolved.provider}_not_configured`,
        `${providerLabel(resolved.provider)} is selected but not fully configured.`,
      );
    }
    if (!override) return buildHostedTextModel(runtime);
    return buildHostedTextModel(
      runtime.provider === "azure"
        ? { ...runtime, deployment: override }
        : { ...runtime, model: override },
    );
  }
  // think:false disables "thinking" models' (e.g. qwen3) chain-of-thought,
  // which otherwise makes every agent turn minutes-slow and can time out.
  // Non-thinking models ignore it.
  return new ChatOllama({
    baseUrl: resolved.baseUrl,
    model: override || resolved.model,
    temperature: 0,
    think: false,
  });
}

/**
 * Return the friendly "not configured" error for the active provider, or null
 * when a model is available. `ollamaMsg` preserves each feature's existing copy.
 */
function configErrorFor(
  resolved: ResolvedModel,
  ollamaMsg: string,
): string | null {
  if (resolved.provider !== "ollama") {
    return resolved.ready
      ? null
      : `${providerLabel(resolved.provider)} is selected but not fully configured. Add its API key and model under Settings → AI assistant.`;
  }
  return resolved.model ? null : ollamaMsg;
}

function providerLabel(provider: AiProvider): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "deepseek") return "DeepSeek";
  if (provider === "anthropic") return "Anthropic";
  if (provider === "azure") return "Azure OpenAI";
  return "Ollama";
}

function isToolSupportError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("does not support tools") ||
    (msg.includes("tool") && msg.includes("support"))
  );
}

function friendlyError(err: unknown, model: string): string {
  if (err instanceof ApiError) return err.message;
  const raw = err instanceof Error ? err.message : String(err);
  if (
    (err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError")) ||
    /aborted|timed?\s*out/i.test(raw)
  ) {
    return `The model "${model}" stopped responding and was cancelled after 90 seconds.`;
  }
  if (isToolSupportError(err)) {
    return `The configured model "${model}" does not support tool-calling, which this feature requires. Choose a tool-capable model (e.g. a cloud model like qwen3.5:cloud) in Settings, or use mock:// mode for a demo.`;
  }
  if (
    /(?:\b429\b|rate.?limit|usage.?limit|quota|insufficient.?credit|too many requests)/i.test(
      raw,
    )
  ) {
    return "The AI provider's usage limit was reached. Completed documentation edits are already saved and your latest answer is still in this interview. Wait for the limit to reset or switch providers, then choose Retry.";
  }
  return raw;
}

interface RunState {
  ctx: ToolContext;
  toolCalls: AgentToolCall[];
  transcript: Array<{
    tool: string;
    args: Record<string, unknown>;
    output: string;
  }>;
  finalText: string;
}

/** Test/ops seam: force the structured-report step to fail so the synthesis
 * fallback is exercised end-to-end. Set via env for tsx scripts. */
let forceReportFailure = process.env.POLYSIEM_FORCE_REPORT_FAILURE === "true";
export function __setForceReportFailure(value: boolean): void {
  forceReportFailure = value;
}
function shouldForceReportFailure(): boolean {
  return (
    forceReportFailure || process.env.POLYSIEM_FORCE_REPORT_FAILURE === "true"
  );
}

/** Parse a tool's stringified output back to a value for synthesis (best-effort). */
function parseToolOutput(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

/** Turn the gathered transcript into synthesis inputs. */
function transcriptToResults(
  transcript: RunState["transcript"],
): RawToolResult[] {
  return transcript.map((t) => ({
    name: t.tool,
    args: t.args,
    output: parseToolOutput(t.output),
  }));
}

/** Per-run overrides for runAgentStream; every field is optional so the
 * chat/investigate/doc-interview callers keep their existing behaviour. */
interface AgentStreamOptions {
  /** false binds NO tools — a plain single-shot generation. Default: tools on. */
  toolsEnabled?: boolean;
  /** LangGraph super-step cap. Omitted = LangGraph's default. */
  recursionLimit?: number;
  /** Wall-clock budget. Omitted = AGENT_TIMEOUT_MS. */
  timeoutMs?: number;
}

/**
 * Drive the agent and map LangChain stream events to AgentStreamEvent. Mutates
 * `state` (toolCalls, transcript, finalText) so the caller can build a report.
 */
async function* runAgentStream(
  model: BaseChatModel,
  systemPrompt: string,
  messages: BaseMessage[],
  state: RunState,
  opts: AgentStreamOptions = {},
): AsyncGenerator<AgentStreamEvent> {
  const agent = createAgent({
    model,
    tools: opts.toolsEnabled === false ? [] : buildToolSet(state.ctx),
    systemPrompt,
  });
  const inFlight = new Map<string, AgentToolCall>();

  const timeout = AbortSignal.timeout(opts.timeoutMs ?? AGENT_TIMEOUT_MS);
  const signal = state.ctx.signal
    ? AbortSignal.any([state.ctx.signal, timeout])
    : timeout;
  const stream = agent.streamEvents(
    { messages },
    {
      version: "v2",
      signal,
      ...(opts.recursionLimit ? { recursionLimit: opts.recursionLimit } : {}),
    },
  );

  for await (const event of stream) {
    switch (event.event) {
      case "on_chat_model_start":
        state.finalText = "";
        break;
      case "on_chat_model_stream": {
        const chunk = event.data.chunk as { content?: unknown } | undefined;
        const text = typeof chunk?.content === "string" ? chunk.content : "";
        if (text) {
          state.finalText += text;
          yield { type: "token", text };
        }
        break;
      }
      case "on_tool_start": {
        const args = redactValue(asRecord(event.data.input), state.ctx.secrets);
        const call: AgentToolCall = {
          id: event.run_id,
          kind: toKind(event.name),
          name: event.name,
          args,
          label: labelFor(event.name, args),
          status: "running",
        };
        inFlight.set(event.run_id, call);
        yield { type: "tool_call", call };
        break;
      }
      case "on_tool_end": {
        const started = inFlight.get(event.run_id);
        const raw = outputText(event.data.output);
        state.transcript.push({
          tool: event.name,
          args: started?.args ?? {},
          output: raw.slice(0, 2_000),
        });
        const isError = /"error"\s*:/.test(raw);
        const call: AgentToolCall = {
          id: event.run_id,
          kind: toKind(event.name),
          name: event.name,
          args: started?.args ?? {},
          label: started?.label ?? labelFor(event.name, {}),
          status: isError ? "error" : "success",
          resultPreview: toResultPreview(raw, 600, state.ctx.secrets),
        };
        inFlight.delete(event.run_id);
        state.toolCalls.push(call);
        yield { type: "tool_result", call };
        break;
      }
      default:
        break;
    }
  }
}

function newContext(
  mode: AgentMode,
  role: SessionRole,
  opts: {
    userId?: string;
    chatContext?: ChatContext;
    signal?: AbortSignal;
    secrets?: string[];
    ticketId?: string;
    workflowChain?: string[];
  },
): ToolContext {
  return {
    mode,
    role,
    chatContext: opts.chatContext,
    secrets: opts.secrets ?? [],
    externalSources: new Set<string>(),
    signal: opts.signal,
    userId: opts.userId,
    workflowChain: opts.workflowChain,
    ticketId: opts.ticketId,
  };
}

export interface InvestigateInput {
  ips: string[];
  context?: string;
  /** Optional pre-formatted evidence lines from the ticket. */
  seedEvidence?: string;
}

export interface AgentRunOptions {
  role: SessionRole;
  userId?: string;
  chatContext?: ChatContext;
  signal?: AbortSignal;
  /** Ticket under investigation, excluded from get_related_threats correlation. */
  ticketId?: string;
}

/** Normalize a structured-output result into a full InvestigationReport. */
function normalizeStructuredReport(
  structured: InvestigationReportModel,
  model: string,
  state: RunState,
): InvestigationReport {
  return {
    ...structured,
    ips: structured.ips ?? [],
    resolution: (structured.resolution ?? []).map((step, i) => ({
      ...step,
      order: step.order ?? i + 1,
    })),
    meta: {
      model,
      toolCalls: state.toolCalls,
      generatedAt: new Date().toISOString(),
      externalSourcesUsed: [...state.ctx.externalSources],
    },
  };
}

/**
 * Ask the model for the final structured report. Never throws: returns null on
 * any failure (model error, timeout/abort, empty output) so the caller can
 * retry or fall back to synthesis instead of discarding the run.
 */
async function generateStructuredReport(
  chat: BaseChatModel,
  task: string,
  state: RunState,
  model: string,
  signal: AbortSignal | undefined,
  repair: boolean,
): Promise<InvestigationReport | null> {
  try {
    const findings = state.transcript
      .map((t) => `## ${t.tool}\n${t.output}`)
      .join("\n\n");
    const reportModel = chat.withStructuredOutput(investigationReportSchema, {
      name: "investigation_report",
    });
    const repairNote = repair
      ? "\n\nThe previous attempt failed to return a valid report. Return ONLY the InvestigationReport object, strictly matching the schema, with no extra prose."
      : "";
    const structured = (await reportModel.invoke(
      [
        new SystemMessage(
          `${INVESTIGATE_SYSTEM_PROMPT}\n\nProduce ONLY the final InvestigationReport as structured JSON. Base every field strictly on the tool findings.${repairNote}`,
        ),
        new HumanMessage(
          `${task}\n\nTool findings collected during the investigation:\n${findings || "(no tool findings)"}\n\nYour narrative so far:\n${state.finalText || "(none)"}\n\nNow produce the structured InvestigationReport.`,
        ),
      ],
      { signal },
    )) as InvestigationReportModel;
    if (
      !structured ||
      typeof structured.summary !== "string" ||
      !structured.summary.trim()
    )
      return null;
    return normalizeStructuredReport(structured, model, state);
  } catch {
    return null;
  }
}

/**
 * Run an investigation. Yields stream events and, once complete, a terminal
 * `report` + `done`. The InvestigationReport is also the generator's return
 * value so callers (the background worker / SSE route) can persist it.
 *
 * Robustness contract: a run that did real research is NEVER discarded. If the
 * structured-report step fails, we retry once with a repair prompt and then
 * synthesize a best-effort report from the gathered tool results. The run only
 * returns null (a hard failure) when nothing at all was gathered — e.g. the
 * very first model call failed.
 */
export async function* runInvestigation(
  input: InvestigateInput,
  opts: AgentRunOptions,
): AsyncGenerator<AgentStreamEvent, InvestigationReport | null> {
  const resolved = await resolveModel();
  const { baseUrl, model } = resolved;

  if (resolved.provider === "ollama" && isMockMode(baseUrl)) {
    // Mock mode still exercises the synthesis fallback (via the force seam) so
    // the robustness path is demoable without a live model.
    const mockResults: RawToolResult[] = [];
    const mockCalls: AgentToolCall[] = [];
    let partialText = "";
    let mockReport: InvestigationReport | null = null;
    for await (const ev of mockInvestigate(input.ips, input.context)) {
      if (ev.type === "report") {
        mockReport = ev.report;
        continue;
      }
      if (ev.type === "done") continue;
      if (ev.type === "token") partialText += ev.text;
      if (ev.type === "tool_result") {
        mockCalls.push(ev.call);
        mockResults.push({
          name: ev.call.name,
          args: ev.call.args,
          output: parseToolOutput(ev.call.resultPreview ?? ""),
        });
      }
      yield ev;
    }
    const report =
      !shouldForceReportFailure() && mockReport
        ? mockReport
        : synthesizeReport({
            ips: input.ips,
            results: mockResults,
            toolCalls: mockCalls,
            partialText,
            model: "mock-agent:demo",
            externalSourcesUsed: [],
          });
    yield { type: "report", report };
    yield {
      type: "done",
      content: report.summary,
      toolCalls: report.meta.toolCalls,
    };
    return report;
  }

  const cfgErr = configErrorFor(
    resolved,
    "No Ollama model is configured. Set one in Settings to run investigations.",
  );
  if (cfgErr) {
    yield { type: "error", message: cfgErr };
    return null;
  }

  const ctx = newContext("investigate", opts.role, opts);
  const state: RunState = { ctx, toolCalls: [], transcript: [], finalText: "" };
  const chat = buildChatModel(resolved);

  const task = [
    input.ips.length
      ? `Investigate the following IP address(es): ${input.ips.join(", ")}.`
      : "Investigate the security concern described below.",
    input.context ? `\nTicket / context:\n${input.context}` : "",
    input.seedEvidence ? `\nEvidence from logs:\n${input.seedEvidence}` : "",
  ].join("");

  // Phase 1: tool-calling research.
  let phase1Failed = false;
  try {
    yield* runAgentStream(
      chat,
      INVESTIGATE_SYSTEM_PROMPT,
      [new HumanMessage(task)],
      state,
    );
  } catch (err) {
    // Nothing gathered at all → a hard failure (model unreachable / no tool
    // support). With research in hand, keep it and fall through to synthesis.
    if (state.transcript.length === 0 && state.toolCalls.length === 0) {
      yield { type: "error", message: friendlyError(err, model) };
      return null;
    }
    phase1Failed = true;
  }

  // Phase 2: structured report — attempt, retry once, then synthesize.
  let report: InvestigationReport | null = null;
  if (!phase1Failed && !shouldForceReportFailure()) {
    report = await generateStructuredReport(
      chat,
      task,
      state,
      model,
      opts.signal,
      false,
    );
    if (!report)
      report = await generateStructuredReport(
        chat,
        task,
        state,
        model,
        opts.signal,
        true,
      );
  }
  if (!report) {
    const nothingGathered =
      state.transcript.length === 0 &&
      state.toolCalls.length === 0 &&
      !state.finalText.trim();
    if (nothingGathered) {
      yield {
        type: "error",
        message: "The investigation could not gather any findings.",
      };
      return null;
    }
    report = synthesizeReport({
      ips: input.ips,
      results: transcriptToResults(state.transcript),
      toolCalls: state.toolCalls,
      partialText: state.finalText,
      model,
      externalSourcesUsed: [...ctx.externalSources],
    });
  }

  const clean = redactValue(report, ctx.secrets);
  yield { type: "report", report: clean };
  yield { type: "done", content: clean.summary, toolCalls: state.toolCalls };
  return clean;
}

/** Convert stored ChatMessages to LangChain messages. */
function toLangchainMessages(messages: ChatMessage[]): BaseMessage[] {
  return messages.map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
  );
}

/** Run a multi-turn chat. Yields stream events and a terminal `done`. */
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
  const systemPrompt =
    opts.mode === "services"
      ? DOC_SERVICE_PLAN_SYSTEM_PROMPT
      : docInterviewSystemPrompt(opts.goal);

  const lcMessages = toLangchainMessages(messages);
  if (opts.mode === "services")
    lcMessages.push(new HumanMessage(DOC_SERVICE_PLAN_INSTRUCTION));

  try {
    yield* runAgentStream(chat, systemPrompt, lcMessages, state);
  } catch (err) {
    yield { type: "error", message: friendlyError(err, model) };
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

/* ------------------------- doc interview (mock mode) ---------------------- */

function mockDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function* mockStreamText(text: string): AsyncGenerator<AgentStreamEvent> {
  for (const word of text.split(" ")) {
    yield { type: "token", text: `${word} ` };
    await mockDelay(6);
  }
}

let mockDocSeq = 0;
async function* mockDocToolChip(
  kind: AgentToolCall["kind"],
  name: string,
  label: string,
  args: Record<string, unknown>,
  preview: string,
): AsyncGenerator<AgentStreamEvent, AgentToolCall> {
  mockDocSeq += 1;
  const base: AgentToolCall = {
    id: `mockdoc-${Date.now()}-${mockDocSeq}`,
    kind,
    name,
    args,
    label,
    status: "running",
  };
  yield { type: "tool_call", call: base };
  await mockDelay(110);
  const done: AgentToolCall = {
    ...base,
    status: "success",
    resultPreview: preview,
  };
  yield { type: "tool_result", call: done };
  return done;
}

const MOCK_INTERVIEW_QUESTIONS = [
  {
    question:
      "What is the primary purpose of vm-nextcloud, and who depends on it?",
    options: [
      {
        label: "Private file sync",
        answer:
          "It provides private file sync for household users and their mobile devices.",
        description: "Personal storage and device synchronization",
      },
      {
        label: "Team collaboration",
        answer:
          "It is our small-team collaboration hub for shared files, calendars, and contacts.",
      },
      {
        label: "Application storage",
        answer:
          "Other internal applications depend on it as their shared document store.",
      },
    ],
  },
  {
    question:
      "vm-nextcloud is on VLAN 20 (IoT). Is that intentional, and what access does it need?",
    options: [
      {
        label: "Reverse proxy only",
        answer:
          "The placement is intentional. Inbound access should come only through the reverse proxy, with normal outbound update access.",
      },
      {
        label: "LAN and internet",
        answer:
          "The placement is intentional; trusted LAN clients connect directly and the VM also needs outbound internet access.",
      },
      {
        label: "Needs moving",
        answer:
          "The IoT placement is accidental. It should move to the server VLAN and retain only reverse-proxy ingress.",
      },
    ],
  },
  {
    question: "How is vm-nextcloud backed up, and has restore been tested?",
    options: [
      {
        label: "Nightly snapshots",
        answer:
          "It receives nightly Proxmox snapshots, but a full restore has not been tested yet.",
      },
      {
        label: "App and off-site backup",
        answer:
          "The database and data directory are backed up nightly and copied off-site; restores are tested quarterly.",
      },
      {
        label: "Not backed up yet",
        answer:
          "There is no reliable backup yet. Add backup setup and a restore test as urgent TODOs.",
      },
    ],
  },
  {
    question: "If pve-node-01 fails, what is the recovery order?",
    options: [
      {
        label: "Restore VM first",
        answer:
          "Restore vm-nextcloud from the newest backup, start it, then verify the database, storage, and HTTPS endpoint.",
      },
      {
        label: "Dependencies first",
        answer:
          "Bring up DNS, storage, and the database first; then restore vm-nextcloud and finally the reverse proxy route.",
      },
      {
        label: "Manual recovery",
        answer:
          "Recovery is currently manual and undocumented. Mark the exact order and validation checks as TODOs.",
      },
    ],
  },
  {
    question: "Where are this service's credentials and certificates managed?",
    options: [
      {
        label: "Password manager",
        answer:
          "Administrative credentials are in the team password manager; certificates are managed by the reverse proxy.",
      },
      {
        label: "Secrets vault",
        answer:
          "Credentials and API tokens are stored in the internal secrets vault, and certificates renew automatically.",
      },
      {
        label: "Host configuration",
        answer:
          "Their locations are recorded in protected host configuration files; document the paths only, never their values.",
      },
    ],
  },
  {
    question: "What operational gotcha should the documentation emphasize?",
    options: [
      {
        label: "Upgrade order",
        answer:
          "Application upgrades must run one major version at a time, with maintenance mode enabled first.",
      },
      {
        label: "Storage pressure",
        answer:
          "Watch free space closely; failed uploads and database issues begin when the data volume is nearly full.",
      },
      {
        label: "No known gotchas",
        answer:
          "There are no known special gotchas beyond the normal backup and update procedure.",
      },
    ],
  },
];

/** Deterministic canned interview stream for mock:// demo mode. */
async function* mockDocInterview(
  messages: ChatMessage[],
  mode: DocInterviewMode,
): AsyncGenerator<AgentStreamEvent, void> {
  const toolCalls: AgentToolCall[] = [];

  if (mode === "services") {
    toolCalls.push(
      yield* mockDocToolChip(
        "search_inventory",
        "search_inventory",
        'Search "vm-nextcloud"',
        { query: "vm-nextcloud", kinds: ["vm", "service"] },
        "1 vm, no matching service entry",
      ),
    );
    const plan = JSON.stringify({
      services: [
        {
          name: "Nextcloud",
          url: "https://nextcloud.example.test",
          port: 443,
          protocol: "https",
          description: "Private file sync and collaboration service.",
          target: { kind: "vm", id: "mock-vm-nextcloud", name: "vm-nextcloud" },
          evidence: "The operator confirmed this service during the interview.",
        },
      ],
      notes: ["Confirm the production URL before creating this demo entry."],
    });
    yield* mockStreamText(plan);
    yield { type: "done", content: plan, toolCalls };
    return;
  }

  // interview mode — how many real answers has the operator given so far?
  const answered = Math.max(
    0,
    messages.filter((m) => m.role === "user").length - 1,
  );

  if (answered === 0) {
    toolCalls.push(
      yield* mockDocToolChip(
        "search_inventory",
        "search_inventory",
        'Search "hosts"',
        { query: "hosts" },
        "3 devices, 2 vms, 4 containers",
      ),
    );
    toolCalls.push(
      yield* mockDocToolChip(
        "other",
        "list_networks",
        "List networks",
        {},
        "VLAN 10 (LAN), VLAN 20 (IoT), VLAN 30 (DMZ)",
      ),
    );
    const prompt = MOCK_INTERVIEW_QUESTIONS[0];
    toolCalls.push(
      yield* mockDocToolChip(
        "ask_question",
        "ask_question",
        prompt.question,
        prompt,
        `${prompt.options.length} suggested answers plus custom speech or text`,
      ),
    );
    const opener =
      "I found vm-nextcloud on pve-node-01 and checked its VLAN context.";
    yield* mockStreamText(opener);
    yield { type: "done", content: opener, toolCalls };
    return;
  }

  if (answered >= MOCK_INTERVIEW_QUESTIONS.length) {
    const complete =
      "The selected documentation scope is covered with no remaining mock assumptions. You can end the interview, or type another subject you want to document.";
    yield* mockStreamText(complete);
    yield { type: "done", content: complete, toolCalls };
    return;
  }

  const prompt =
    MOCK_INTERVIEW_QUESTIONS[
      Math.min(answered, MOCK_INTERVIEW_QUESTIONS.length - 1)
    ];
  // Occasionally pull data mid-interview so the user sees grounded tool calls.
  if (answered === 1) {
    toolCalls.push(
      yield* mockDocToolChip(
        "get_firewall_context",
        "get_firewall_rules",
        "Firewall rules (VLAN 20)",
        { interface: "iot" },
        "2 pass rules, 1 port-forward",
      ),
    );
  }
  toolCalls.push(
    yield* mockDocToolChip(
      "ask_question",
      "ask_question",
      prompt.question,
      prompt,
      `${prompt.options.length} suggested answers plus custom speech or text`,
    ),
  );
  const confirmation = "Thanks — I’ve incorporated that answer into the interview context.";
  yield* mockStreamText(confirmation);
  yield { type: "done", content: confirmation, toolCalls };
}
