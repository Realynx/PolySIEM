import { z } from "zod";

export const createDocSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().max(500_000).default(""),
  parentId: z.string().nullish(),
  slug: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and dashes only")
    .optional(),
});
export type CreateDocInput = z.infer<typeof createDocSchema>;

export const updateDocSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  content: z.string().max(500_000).optional(),
  parentId: z.string().nullish(),
});
export type UpdateDocInput = z.infer<typeof updateDocSchema>;

export const tagSchema = z.object({
  name: z.string().min(1).max(48),
  color: z
    .enum(["gray", "red", "orange", "amber", "green", "emerald", "blue", "violet", "rose"])
    .default("gray"),
});
export type TagInput = z.infer<typeof tagSchema>;

export const assignTagSchema = z.object({
  tagId: z.string().min(1),
  entityType: z.enum(["device", "vm", "container", "network", "service", "doc"]),
  entityId: z.string().min(1),
});
export type AssignTagInput = z.infer<typeof assignTagSchema>;
