import { z } from "zod";

const subjectSchema = z.string().trim().min(1).max(253).transform((value, ctx) => {
  const normalized = value.replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0]?.replace(/\.$/, "").toLowerCase() ?? "";
  if (!normalized || /\s/.test(normalized)) {
    ctx.addIssue({ code: "custom", message: "Enter an IP address or domain name, not a search phrase." });
    return z.NEVER;
  }
  return normalized;
});

export const createSecurityResearchPageSchema = z.object({
  subject: subjectSchema,
  title: z.string().trim().max(160).optional(),
});

export const updateSecurityResearchPageSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  notes: z.string().max(50_000).nullable().optional(),
  verdict: z.enum(["unknown", "benign", "suspicious", "malicious"]).optional(),
  status: z.enum(["open", "archived"]).optional(),
});

export const collectSecurityResearchSchema = z.object({
  hours: z.number().int().min(1).max(168).default(24),
  forceRefresh: z.boolean().default(false),
  providers: z.array(z.enum(["dns", "polysiem", "elasticsearch", "censys", "securitytrails"]))
    .min(1)
    .max(5)
    .optional(),
});

export type CreateSecurityResearchPageInput = z.infer<typeof createSecurityResearchPageSchema>;
export type UpdateSecurityResearchPageInput = z.infer<typeof updateSecurityResearchPageSchema>;
