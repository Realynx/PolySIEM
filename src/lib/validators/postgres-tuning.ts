import { z } from "zod";
import { MANAGED_SETTING_NAMES } from "@/lib/postgres-tuning/catalog";

const MB = 1024 * 1024;

/** Admin-entered resources for the database host; omitted keys fall back to detection. */
export const tuningOverridesSchema = z
  .object({
    memoryBytes: z.number().int().min(256 * MB).max(4 * 1024 * 1024 * MB).optional(),
    cpus: z.number().int().min(1).max(512).optional(),
    storage: z.enum(["ssd", "hdd", "unknown"]).optional(),
    sharesHostWithApp: z.boolean().optional(),
  })
  .strict();

export const applyTuningSchema = z
  .object({
    settings: z.array(z.enum(MANAGED_SETTING_NAMES)).min(1).max(MANAGED_SETTING_NAMES.length),
    overrides: tuningOverridesSchema.nullish(),
  })
  .strict();

export type TuningOverridesInput = z.infer<typeof tuningOverridesSchema>;
export type ApplyTuningInput = z.infer<typeof applyTuningSchema>;
