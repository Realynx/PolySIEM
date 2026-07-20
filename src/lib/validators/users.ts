import { z } from "zod";
import { passwordSchema, usernameSchema } from "./auth";

export const createUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  displayName: z.string().max(64).optional(),
  role: z.enum(["ADMIN", "USER"]).default("USER"),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  displayName: z.string().max(64).nullish(),
  role: z.enum(["ADMIN", "USER"]).optional(),
  disabled: z.boolean().optional(),
  newPassword: passwordSchema.optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
