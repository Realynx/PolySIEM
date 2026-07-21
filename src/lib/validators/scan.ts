import { z } from "zod";
import { TICKET_CATEGORIES } from "@/lib/types";

export const ticketSeverityEnum = z.enum([
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFO",
]);
export const ticketCategoryEnum = z.enum(TICKET_CATEGORIES);

/** PUT /api/logs/scan/config body. */
export const aiScanConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z
    .enum(["ollama", "openai", "deepseek", "anthropic", "azure"])
    .optional()
    .default("ollama"),
  baseUrl: z.url().or(z.string().startsWith("mock://")).or(z.literal("")),
  model: z.string().max(128),
  integrationId: z.string().max(64),
  intervalMinutes: z.number().int().min(5).max(1440),
  lookbackMinutes: z.number().int().min(5).max(1440),
  maxLogsPerQuery: z.number().int().min(10).max(500),
  scopes: z.object({
    suricata: z.boolean(),
    cloudflared: z.boolean(),
    general: z.boolean(),
  }),
  customIndices: z.string().max(512),
  // Additive: auto-investigate new HIGH/CRITICAL tickets after a scan (default off).
  autoInvestigate: z.boolean().optional().default(false),
});
export type AiScanConfigInput = z.infer<typeof aiScanConfigSchema>;

/** POST /api/logs/tickets body (manual ticket). */
export const ticketCreateSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(20_000),
  severity: ticketSeverityEnum,
  category: ticketCategoryEnum.default("other"),
});
export type TicketCreateInput = z.infer<typeof ticketCreateSchema>;

/**
 * PATCH /api/logs/tickets/[id] body. All keys optional; absent keys must stay
 * absent (no .default() here — see the zod v4 .partial() gotcha).
 */
export const ticketPatchSchema = z.object({
  status: z.enum(["OPEN", "CLOSED"]).optional(),
  resolution: z.string().trim().min(3).max(20_000).optional(),
  title: z.string().min(1).max(200).optional(),
  summary: z.string().min(1).max(20_000).optional(),
  severity: ticketSeverityEnum.optional(),
  category: ticketCategoryEnum.optional(),
}).superRefine((input, ctx) => {
  if (input.status === "CLOSED" && !input.resolution) {
    ctx.addIssue({
      code: "custom",
      path: ["resolution"],
      message: "Add a closure rationale so the AI scanner can learn whether this traffic is benign or handled.",
    });
  }
});
export type TicketPatchInput = z.infer<typeof ticketPatchSchema>;

/** Query params for GET /api/logs/tickets. */
export const ticketListQuerySchema = z.object({
  status: z.enum(["open", "closed", "all"]).default("open"),
  severity: z.string().max(64).optional(), // CSV of severities
  q: z.string().max(256).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;

/** Query params for GET /api/logs/scan/runs. */
export const scanRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ScanRunsQuery = z.infer<typeof scanRunsQuerySchema>;

/** Shape the model is asked to return — one finding per detected issue. */
export const scanFindingSchema = z.object({
  title: z.string().min(1).max(300),
  severity: z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(ticketSeverityEnum),
  category: z
    .string()
    .transform((s) => s.toLowerCase())
    .pipe(ticketCategoryEnum)
    .catch("anomaly"),
  summary: z.string().min(1).max(20_000),
  suggestions: z.string().max(20_000).optional(),
  dedupe: z.string().min(1).max(300),
  /**
   * Handle of an existing ticket this finding maps to (from the existing-ticket
   * context in the prompt). When set and resolvable, the engine ATTACHES this
   * finding's evidence to that ticket instead of creating a duplicate. `dedupe`
   * remains the mechanical fallback when this is absent or unresolvable.
   */
  matchesExisting: z.string().max(300).nullish(),
  refs: z
    .object({
      srcIps: z.array(z.string().max(64)).max(20).optional(),
      destIps: z.array(z.string().max(64)).max(20).optional(),
      signatures: z.array(z.string().max(300)).max(20).optional(),
      hosts: z.array(z.string().max(255)).max(20).optional(),
    })
    .optional(),
});
export type ScanFinding = z.infer<typeof scanFindingSchema>;
