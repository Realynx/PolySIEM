import "server-only";

import { z } from "zod";
import type { ToolContext } from "@/lib/ai/agent/types";
import { makeTool, type AnyTool } from "@/lib/ai/agent/tools/factory";

/** Direct-interaction tools available only during documentation interviews. */
export function interviewInteractionTools(ctx: ToolContext): AnyTool[] {
  const questionSchema = z.object({
    question: z.string().min(1).max(500).describe("Focused question to ask"),
    options: z.array(z.object({
      label: z.string().min(1).max(80).describe("Short option label"),
      answer: z.string().min(1).max(500).describe("Complete answer sent when selected"),
      description: z.string().max(180).optional().describe("Optional clarification shown below the label"),
    })).min(2).max(4),
  });

  const askQuestion = makeTool(
    ctx,
    "ask_question",
    "Present the operator with 1-5 focused interview questions at once. Each question has 2-4 likely single-select answers, and the UI also offers a custom typed or spoken answer.",
    z.object({
      questions: z.array(questionSchema).min(1).max(5).describe("Related questions the operator can answer together"),
    }),
    async (args) => ({
      presented: true,
      questionCount: args.questions.length,
      optionCount: args.questions.reduce((total, question) => total + question.options.length, 0),
    }),
  );

  // Returning directly hands control to the operator instead of inviting the
  // model to repeat the question until LangGraph's recursion guard aborts.
  askQuestion.returnDirect = true;
  const compactInterview = makeTool(
    ctx,
    "compact_interview",
    "Compact older documentation-interview turns before the automatic 90% context threshold. Summarize confirmed facts, decisions, and unresolved questions from older turns; the recent five user/assistant pairs remain verbatim.",
    z.object({
      summary: z.string().min(1).max(4_000).describe("Concise durable summary of older confirmed facts, decisions, and unresolved questions"),
    }),
    async (args) => ({ compacted: true, summary: args.summary }),
  );
  return [askQuestion, compactInterview];
}
