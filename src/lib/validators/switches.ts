import { z } from "zod";

/** Paste-a-config input for creating/replacing a switch. */
export const createSwitchSchema = z.object({
  /** Display name; defaults to the parsed hostname. */
  name: z.string().min(1).max(64).optional(),
  rawConfig: z
    .string()
    .min(10, "Paste the switch configuration")
    .max(500_000, "Configuration too large (500 KB max)"),
});
export type CreateSwitchInput = z.infer<typeof createSwitchSchema>;
