import "server-only";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { isMockMode } from "@/lib/ai/ollama";
import { redactValue } from "@/lib/ai/agent/redact";
import {
  INVESTIGATE_SYSTEM_PROMPT,
  investigationReportSchema,
  type InvestigationReportModel,
} from "@/lib/ai/agent/prompts";
import { mockInvestigate } from "@/lib/ai/agent/mock";
import { synthesizeReport, type RawToolResult } from "@/lib/ai/agent/synthesize";
import type {
  AgentStreamEvent,
  AgentToolCall,
  InvestigationReport,
} from "@/lib/ai/agent/contract";
import {
  buildChatModel,
  configErrorFor,
  friendlyError,
  newContext,
  parseToolOutput,
  resolveModel,
  runAgentStream,
  shouldForceReportFailure,
  transcriptToResults,
  type AgentRunOptions,
  type RunState,
} from "./runtime-core";

export interface InvestigateInput {
  ips: string[];
  context?: string;
  /** Optional pre-formatted evidence lines from the ticket. */
  seedEvidence?: string;
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

async function* runMockInvestigation(
  input: InvestigateInput,
): AsyncGenerator<AgentStreamEvent, InvestigationReport> {
  const results: RawToolResult[] = [];
  const calls: AgentToolCall[] = [];
  let partialText = "";
  let generated: InvestigationReport | null = null;
  for await (const event of mockInvestigate(input.ips, input.context)) {
    if (event.type === "report") {
      generated = event.report;
      continue;
    }
    if (event.type === "done") continue;
    if (event.type === "token") partialText += event.text;
    if (event.type === "tool_result") {
      calls.push(event.call);
      results.push({ name: event.call.name, args: event.call.args, output: parseToolOutput(event.call.resultPreview ?? "") });
    }
    yield event;
  }
  const report = !shouldForceReportFailure() && generated
    ? generated
    : synthesizeReport({
        ips: input.ips, results, toolCalls: calls, partialText, model: "mock-agent:demo", externalSourcesUsed: [],
      });
  yield { type: "report", report };
  yield { type: "done", content: report.summary, toolCalls: report.meta.toolCalls };
  return report;
}

function investigationTask(input: InvestigateInput): string {
  return [
    input.ips.length
      ? `Investigate the following IP address(es): ${input.ips.join(", ")}.`
      : "Investigate the security concern described below.",
    input.context ? `\nTicket / context:\n${input.context}` : "",
    input.seedEvidence ? `\nEvidence from logs:\n${input.seedEvidence}` : "",
  ].join("");
}

function emptyInvestigation(state: RunState): boolean {
  return state.transcript.length === 0 && state.toolCalls.length === 0 && !state.finalText.trim();
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
    return yield* runMockInvestigation(input);
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

  const task = investigationTask(input);

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
    if (emptyInvestigation(state)) {
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
