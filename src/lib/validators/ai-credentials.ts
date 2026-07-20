import { z } from "zod";

/**
 * Credential names are lowercase slugs — they are the lookup key AI assistants
 * pass to the MCP `get_ai_credential` tool.
 */
const credentialNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9-_.]*$/,
    "Use a lowercase slug: start with a letter/digit, then letters, digits, '-', '_' or '.'",
  );

export const createAiCredentialSchema = z.object({
  name: credentialNameSchema,
  description: z.string().max(500).optional(),
  username: z.string().max(128).optional(),
  secret: z.string().min(1).max(4096),
  url: z.string().max(512).optional(),
});
export type CreateAiCredentialInput = z.infer<typeof createAiCredentialSchema>;

/** All fields optional; an absent secret keeps the stored one untouched. */
export const updateAiCredentialSchema = z.object({
  name: credentialNameSchema.optional(),
  description: z.string().max(500).nullish(),
  username: z.string().max(128).nullish(),
  secret: z.string().min(1).max(4096).optional(),
  url: z.string().max(512).nullish(),
});
export type UpdateAiCredentialInput = z.infer<typeof updateAiCredentialSchema>;
