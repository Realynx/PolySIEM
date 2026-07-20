import { z } from "zod";

export const createApiTokenSchema = z.object({
  name: z.string().min(1).max(64),
  scopes: z.array(z.enum(["read", "write_docs", "trigger_sync", "credentials"])).min(1),
  expiresInDays: z.number().int().min(1).max(3650).nullish(),
});
export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;
