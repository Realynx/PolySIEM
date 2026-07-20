import { z } from "zod";

export const aiTasks = ["describe_entity", "improve", "summarize", "continue", "explain_rule"] as const;

export const aiGenerateSchema = z
  .object({
    task: z.enum(aiTasks),
    entityType: z.enum(["device", "vm", "container", "network", "service", "firewall_rule"]).optional(),
    entityId: z.string().optional(),
    text: z.string().max(100_000).optional(),
  })
  .refine(
    (v) =>
      v.task === "describe_entity" || v.task === "explain_rule"
        ? Boolean(v.entityType && v.entityId)
        : Boolean(v.text?.trim()),
    { message: "describe_entity/explain_rule require entityType+entityId; other tasks require text" },
  );
export type AiGenerateInput = z.infer<typeof aiGenerateSchema>;
