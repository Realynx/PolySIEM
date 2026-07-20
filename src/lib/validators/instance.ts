import { z } from "zod";

export const INSTANCE_ACTION_CONFIRMATIONS = {
  reset: "RESET POLYSIEM",
  reinstall: "REINSTALL POLYSIEM",
} as const;

export const instanceActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reset"),
    password: z.string().min(1, "Your password is required").max(128),
    confirmation: z.literal(INSTANCE_ACTION_CONFIRMATIONS.reset),
  }),
  z.object({
    action: z.literal("reinstall"),
    password: z.string().min(1, "Your password is required").max(128),
    confirmation: z.literal(INSTANCE_ACTION_CONFIRMATIONS.reinstall),
  }),
]);

export type InstanceActionInput = z.infer<typeof instanceActionSchema>;
