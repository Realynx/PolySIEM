import { z } from "zod";
import type { AgentToolCall } from "@/lib/ai/agent/contract";
import type { ActionDefinition, RunContext } from "../registry";

/**
 * ai.script — "English script": the operator writes an elaborate natural-language
 * instruction and the LangChain agent carries it out AGENTICALLY, with the same
 * tool surface the AI assistant uses (inventory, networks, docs, firewall,
 * workflows, logs/Elasticsearch, security tickets, threat intel, external IP
 * lookups). The MCP server's handlers are the same service-layer functions those
 * tools call, so the MCP surface is already reachable through them.
 *
 * Safety posture: tools are READ-ONLY by default. Mutating tools (write_doc,
 * run_workflow, trigger_sync) are only bound when the operator explicitly picks
 * the "read + write" mode, which maps to the agent's ADMIN role gate.
 */

const TOOL_MODES = ["none", "read", "write"] as const;
export type ScriptToolMode = (typeof TOOL_MODES)[number];

/**
 * The builder submits every rendered field, so blank optional/number inputs
 * arrive as "". Drop them before parsing so zod defaults apply instead of
 * coercing "" to 0 and failing the min() bound.
 */
export function stripBlankConfig(config: unknown): Record<string, unknown> {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  return Object.fromEntries(
    Object.entries(config as Record<string, unknown>).filter(
      ([, v]) => !(typeof v === "string" && v.trim() === ""),
    ),
  );
}

const scriptConfigSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  system: z.string().max(100_000).optional(),
  toolMode: z.enum(TOOL_MODES).default("read"),
  maxIterations: z.coerce.number().int().min(1).max(25).default(8),
  timeoutSeconds: z.coerce.number().int().min(15).max(600).default(180),
  maxOutputChars: z.coerce.number().int().min(200).max(200_000).default(20_000),
  model: z.string().max(200).optional(),
});

/**
 * The executor parses the node config with this schema before calling run(),
 * so the blank-stripping has to live inside it rather than in run().
 */
const configSchema = z.preprocess(stripBlankConfig, scriptConfigSchema);

export type ScriptConfig = z.infer<typeof scriptConfigSchema>;

/** Parse a node config, tolerating blank optional fields from the builder. */
export function parseScriptConfig(config: unknown): ScriptConfig {
  return configSchema.parse(config) as ScriptConfig;
}

/** Cap the model's answer, appending a visible note rather than silently cutting. */
export function capOutput(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, maxChars)}\n\n[Output truncated at ${maxChars} characters.]`,
    truncated: true,
  };
}

export interface ToolSummary {
  /** Total successful + failed tool invocations. */
  count: number;
  /** Distinct tool names, in first-use order. */
  names: string[];
  /** How many invocations returned an error payload. */
  errorCount: number;
}

/** Roll a run's tool-call trail up into the node's outputs. */
export function summarizeToolCalls(calls: AgentToolCall[]): ToolSummary {
  const names: string[] = [];
  let errorCount = 0;
  for (const call of calls) {
    if (!names.includes(call.name)) names.push(call.name);
    if (call.status === "error") errorCount += 1;
  }
  return { count: calls.length, names, errorCount };
}

/** Compact, non-secret trail persisted as an output for downstream steps. */
export function toolTranscript(calls: AgentToolCall[]): string {
  return JSON.stringify(
    calls.map((c) => ({ name: c.name, label: c.label, status: c.status })),
  );
}

/** Map the operator's tool mode onto the agent's tools/role gates. */
export function toolGates(
  mode: ScriptToolMode,
  ctx: Pick<RunContext, "actor">,
): { toolsEnabled: boolean; role: "ADMIN" | "USER"; userId?: string } {
  return {
    toolsEnabled: mode !== "none",
    // buildToolSet only binds write/infra tools for role "ADMIN"; read mode
    // deliberately downgrades so a prompt cannot reach them by accident.
    role: mode === "write" ? "ADMIN" : "USER",
    userId: ctx.actor.userId,
  };
}

export const aiScript: ActionDefinition = {
  meta: {
    kind: "ai.script",
    title: "English script",
    description:
      "Write an instruction in plain English and let the AI agent carry it out — it calls the same read-only PolySIEM tools as the assistant (inventory, networks, docs, firewall, logs/Elasticsearch, workflows, security tickets, threat intel, WHOIS/rDNS) and reports what it found. Every tool call is narrated in the run console.",
    category: "ai",
    inputs: [
      {
        key: "prompt",
        label: "Script",
        type: "text",
        required: true,
        placeholder:
          "Find every VM on VLAN 20, check the last 24h of logs for each one, and list any that logged an error. Reply with one line per VM: name, IP, error count.",
        help: "Plain English, as detailed as you like. Templateable, so {{input.x}} and {{nodes.<id>.<key>}} are substituted before the agent runs. There is no human to answer questions mid-run — state your assumptions and the desired output format here.",
      },
      {
        key: "system",
        label: "Extra system instructions",
        type: "text",
        required: false,
        help: "Optional standing rules appended to the agent's system prompt (tone, output format, things never to do).",
      },
      {
        key: "toolMode",
        label: "Tools",
        type: "select",
        required: false,
        defaultValue: "read",
        options: [
          { value: "read", label: "Read-only tools (recommended)" },
          { value: "none", label: "No tools — text only" },
          { value: "write", label: "Read + write tools (changes your lab)" },
        ],
        help: "Read-only lets the agent inspect inventory, docs, firewall config, logs, workflows, tickets and external IP data. 'Read + write' additionally allows it to create/update documentation pages, run other workflows, and trigger integration syncs — it can change your lab, so enable it only for scripts you trust. 'No tools' is a plain generation with no data access.",
      },
      {
        key: "maxIterations",
        label: "Max tool iterations",
        type: "number",
        required: false,
        defaultValue: 8,
        help: "Upper bound on the agent's think/act loop (1-25, default 8). Hitting it stops the run and keeps whatever the agent produced so far, with a note appended.",
      },
      {
        key: "timeoutSeconds",
        label: "Time budget (seconds)",
        type: "number",
        required: false,
        defaultValue: 180,
        help: "Wall-clock budget for the whole step (15-600, default 180). Workflow runs are synchronous, so keep this shorter than your reverse proxy's request timeout.",
      },
      {
        key: "maxOutputChars",
        label: "Max output characters",
        type: "number",
        required: false,
        defaultValue: 20_000,
        help: "The final text is truncated to this length before being handed to downstream nodes (200-200000, default 20000).",
      },
      {
        key: "model",
        label: "Model override",
        type: "string",
        required: false,
        help: "Optional model (or Azure deployment) name to use instead of the one in Settings → AI assistant. Credentials and endpoint are unchanged. It must support tool calling unless Tools is 'No tools'.",
      },
    ],
    outputs: [
      { key: "text", label: "Final answer" },
      { key: "toolCallCount", label: "Tool calls made" },
      { key: "toolsUsed", label: "Tools used" },
      { key: "toolErrorCount", label: "Failed tool calls" },
      { key: "toolTranscript", label: "Tool call transcript (JSON)" },
      { key: "truncated", label: "Output was truncated" },
    ],
  },
  configSchema,
  async run({ config, ctx }) {
    const cfg = parseScriptConfig(config);
    const gates = toolGates(cfg.toolMode, ctx);

    // Imported lazily: the agent runtime pulls in LangChain and the whole tool
    // surface, which no other registry consumer (catalog, validation) needs.
    const { runScript } = await import("@/lib/ai/agent/runtime");

    ctx.log(
      gates.toolsEnabled
        ? `Running English script with ${cfg.toolMode === "write" ? "read + write" : "read-only"} tools (max ${cfg.maxIterations} iterations, ${cfg.timeoutSeconds}s budget)`
        : `Running English script with no tools (${cfg.timeoutSeconds}s budget)`,
    );
    if (cfg.model) ctx.log(`Model override: ${cfg.model}`);

    const toolCalls: AgentToolCall[] = [];
    let finalText = "";
    let failure: string | null = null;

    const stream = runScript(cfg.prompt, {
      role: gates.role,
      userId: gates.userId,
      system: cfg.system,
      toolsEnabled: gates.toolsEnabled,
      maxIterations: cfg.maxIterations,
      modelOverride: cfg.model,
      timeoutMs: cfg.timeoutSeconds * 1_000,
      // Without this, a script in write mode could call run_workflow on the
      // workflow it is part of and recurse forever; passing the chain lets
      // executeWorkflow apply its usual cycle and depth guards.
      workflowChain: ctx.chain,
    });

    for await (const event of stream) {
      switch (event.type) {
        case "tool_call":
          ctx.log(`Tool ${toolCalls.length + 1}: ${event.call.label}…`, "DEBUG");
          break;
        case "tool_result": {
          toolCalls.push(event.call);
          const preview = event.call.resultPreview?.slice(0, 180) ?? "";
          ctx.log(
            `Tool ${toolCalls.length} ${event.call.status}: ${event.call.name}${preview ? ` → ${preview}` : ""}`,
            event.call.status === "error" ? "WARN" : "INFO",
          );
          break;
        }
        case "done":
          finalText = event.content;
          break;
        case "error":
          failure = event.message;
          break;
        default:
          // "token" (streamed text) and "report" are not useful as console
          // lines — the assembled answer is logged once at the end.
          break;
      }
    }

    if (failure) throw new Error(failure);

    const summary = summarizeToolCalls(toolCalls);
    const { text, truncated } = capOutput(finalText.trim(), cfg.maxOutputChars);

    ctx.log(
      summary.count
        ? `Script finished after ${summary.count} tool call${summary.count === 1 ? "" : "s"} (${summary.names.join(", ")}), ${text.length} characters of output`
        : `Script finished with no tool calls, ${text.length} characters of output`,
    );
    if (summary.errorCount) {
      ctx.log(
        `${summary.errorCount} tool call${summary.errorCount === 1 ? "" : "s"} returned an error — the answer may be incomplete`,
        "WARN",
      );
    }
    if (!text) {
      throw new Error(
        "The AI script produced no output. Check that the configured model supports tool calling, or lower the scope of the instruction.",
      );
    }

    return {
      text,
      toolCallCount: summary.count,
      toolsUsed: summary.names.join(", "),
      toolErrorCount: summary.errorCount,
      toolTranscript: toolTranscript(toolCalls),
      truncated,
    };
  },
};
