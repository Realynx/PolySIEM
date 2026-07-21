/**
 * LangChain tool-set composition for the PolySIEM agent.
 *
 * Tool definitions live in capability-focused modules. This registry owns the
 * cross-cutting availability policy for mode, role, and locked-demo state.
 */
import "server-only";

import { isAdmin, type ToolContext } from "@/lib/ai/agent/types";
import type { AnyTool } from "@/lib/ai/agent/tools/factory";
import { isLockedDemoMode } from "@/lib/demo/mode";
import { researchTools } from "@/lib/ai/agent/tools/research-tools";
import { externalTools } from "@/lib/ai/agent/tools/external-tools";
import { assistantReadTools } from "@/lib/ai/agent/tools/assistant-read-tools";
import { assistantWriteTools } from "@/lib/ai/agent/tools/assistant-write-tools";
import { interviewInteractionTools } from "@/lib/ai/agent/tools/interview-tools";

/**
 * Build the tool set for one agent run. Every mode gets the read tools, while
 * state-changing assistant tools are available only to admins in normal chat.
 * Documentation interviews receive only `write_doc`: they can maintain pages
 * as the interview progresses, but cannot run workflows or trigger syncs.
 * Locked public demos remain read-only.
 */
export function buildToolSet(ctx: ToolContext): AnyTool[] {
  const tools: AnyTool[] = [
    ...researchTools(ctx),
    ...externalTools(ctx),
    ...assistantReadTools(ctx),
  ];
  if (ctx.mode === "doc-interview") {
    tools.push(...interviewInteractionTools(ctx));
  }
  if (!isLockedDemoMode()) {
    const writeTools = assistantWriteTools(ctx);
    if (isAdmin(ctx) && ctx.mode === "chat") tools.push(...writeTools);
    if (ctx.mode === "doc-interview") {
      tools.push(...writeTools.filter((tool) => tool.name === "write_doc"));
    }
  }
  return tools;
}

/** Registered tool names, for validation/tests. */
export function toolNames(ctx: ToolContext): string[] {
  return buildToolSet(ctx).map((tool) => tool.name);
}
