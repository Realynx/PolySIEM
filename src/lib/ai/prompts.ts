import "server-only";
import { ApiError } from "@/lib/api";
import type { AiGenerateInput } from "@/lib/validators/ai";
import {
  buildEntityFactSheet,
  buildFirewallRuleContext,
  DESCRIBABLE_ENTITY_TYPES,
  type DescribableEntityType,
} from "@/lib/ai/context";

export const SYSTEM_PROMPT =
  "You are a concise technical documentation assistant for a self-hosted homelab dashboard. " +
  "Write clean, well-formatted markdown. Be precise and factual; never invent details that are not " +
  "in the provided context. Output only the requested content with no preamble, postamble, or commentary.";

export interface BuiltPrompt {
  system: string;
  prompt: string;
}

/** Build the system+user prompt for a validated AI generate request. */
export async function buildPrompt(input: AiGenerateInput): Promise<BuiltPrompt> {
  switch (input.task) {
    case "describe_entity": {
      const entityType = input.entityType as DescribableEntityType;
      if (!DESCRIBABLE_ENTITY_TYPES.includes(entityType)) {
        throw new ApiError(400, "invalid_entity_type", "describe_entity supports device, vm, container, network and service");
      }
      const factSheet = await buildEntityFactSheet(entityType, input.entityId!);
      return {
        system: SYSTEM_PROMPT,
        prompt:
          `${factSheet}\n\n` +
          `Write a 2-4 sentence markdown description of this ${entityType} for homelab documentation. ` +
          `Cover what it is, what it runs or provides, and anything notable from the facts above.`,
      };
    }
    case "improve":
      return {
        system: SYSTEM_PROMPT,
        prompt:
          "Rewrite the following text to be clearer and tighter. Preserve the markdown formatting " +
          "and keep every technical detail intact. Return only the rewritten text.\n\n" +
          `Text:\n${input.text}`,
      };
    case "summarize":
      return {
        system: SYSTEM_PROMPT,
        prompt:
          "Summarize the following text as a short list of concise markdown bullet points. " +
          "Return only the bullet list.\n\n" +
          `Text:\n${input.text}`,
      };
    case "continue":
      return {
        system: SYSTEM_PROMPT,
        prompt:
          "Continue writing the following text in the same tone and markdown style. " +
          "Return only the continuation — do not repeat any of the original text.\n\n" +
          `Text:\n${input.text}`,
      };
    case "explain_rule": {
      const ruleContext = await buildFirewallRuleContext(input.entityId!);
      return {
        system: SYSTEM_PROMPT,
        prompt:
          `${ruleContext}\n\n` +
          "Explain this firewall rule in plain English in 1-3 sentences: what traffic it allows or blocks, " +
          "and why such a rule might exist in a homelab.",
      };
    }
  }
}
