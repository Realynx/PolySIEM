import "server-only";
import { createAgent } from "langchain";
import { ChatOllama } from "@langchain/ollama";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  getAiScanConfig,
  getOllamaConfig,
  type AiConfig,
  type AiProvider,
} from "@/lib/settings";
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
import type { RawToolResult } from "@/lib/ai/agent/synthesize";
import type {
  AgentStreamEvent,
  AgentToolCall,
  AgentToolKind,
  ChatContext,
  ChatMessage,
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
  "compact_interview",
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
export interface ResolvedModel {
  provider: AiProvider;
  cfg: AiConfig;
  /** Ollama/base API URL. */
  baseUrl: string;
  /** Provider model/deployment name, also used as the report's model label. */
  model: string;
  enabled: boolean;
  ready: boolean;
}

export async function resolveModel(): Promise<ResolvedModel> {
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
export function buildChatModel(
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
export function configErrorFor(
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

export function friendlyError(err: unknown, model: string): string {
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

export interface RunState {
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
export function shouldForceReportFailure(): boolean {
  return (
    forceReportFailure || process.env.POLYSIEM_FORCE_REPORT_FAILURE === "true"
  );
}

/** Parse a tool's stringified output back to a value for synthesis (best-effort). */
export function parseToolOutput(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

/** Turn the gathered transcript into synthesis inputs. */
export function transcriptToResults(
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
export async function* runAgentStream(
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

export function newContext(
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

export interface AgentRunOptions {
  role: SessionRole;
  userId?: string;
  chatContext?: ChatContext;
  signal?: AbortSignal;
  /** Ticket under investigation, excluded from get_related_threats correlation. */
  ticketId?: string;
}

export function toLangchainMessages(messages: ChatMessage[]): BaseMessage[] {
  return messages.map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
  );
}

/** Run a multi-turn chat. Yields stream events and a terminal `done`. */
