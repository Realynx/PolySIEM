import "server-only";

import { tool } from "@langchain/core/tools";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

import { ApiError } from "@/lib/api";
import { redactValue } from "@/lib/ai/agent/redact";
import type { ToolContext } from "@/lib/ai/agent/types";
import { toJsonSafe } from "@/lib/serialize";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = DynamicStructuredTool<any, any, any, any, any, any>;

/** Wrap a data-gathering function as a redacted, JSON-returning LangChain tool. */
export function makeTool<S extends z.ZodObject<z.ZodRawShape>>(
  ctx: ToolContext,
  name: string,
  description: string,
  schema: S,
  run: (args: z.infer<S>) => Promise<unknown>,
): AnyTool {
  return tool(
    async (args: z.infer<S>) => {
      try {
        const result = await run(args);
        return JSON.stringify(redactValue(toJsonSafe(result), ctx.secrets));
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        return JSON.stringify({ error: redactValue(message, ctx.secrets) });
      }
    },
    { name, description, schema },
  ) as AnyTool;
}
