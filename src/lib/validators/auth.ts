import { z } from "zod";

export const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(32, "Username must be at most 32 characters")
  .regex(/^[a-zA-Z0-9._-]+$/, "Only letters, numbers, dots, dashes and underscores");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const setupSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  displayName: z.string().max(64).optional(),
  instanceName: z.string().min(1).max(64).default("PolySIEM"),
  themeColor: z.enum(["blue", "emerald", "violet", "amber", "rose"]).default("blue"),
});
export type SetupInput = z.infer<typeof setupSchema>;

export const setupProgressSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_stage"),
    stage: z.enum(["ai", "integrations", "tutorial"]),
  }),
  z.object({
    action: z.literal("set_ai"),
    enabled: z.boolean(),
    configureNow: z.boolean(),
  }),
  z.object({
    action: z.literal("complete"),
    tutorialSkipped: z.boolean().default(false),
  }),
]);
export type SetupProgressInput = z.infer<typeof setupProgressSchema>;

export const updateProfileSchema = z.object({
  displayName: z.string().max(64).nullish(),
  themeColor: z.enum(["blue", "emerald", "violet", "amber", "rose"]).optional(),
  themeMode: z.enum(["light", "dark", "system"]).optional(),
  anonymousMode: z.boolean().optional(),
  shieldOnCapture: z.boolean().optional(),
  shieldOnBlur: z.boolean().optional(),
  currentPassword: z.string().optional(),
  newPassword: passwordSchema.optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
