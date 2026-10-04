import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { applyTuning } from "@/lib/postgres-tuning/apply";
import { detectTuningState } from "@/lib/postgres-tuning/detect";
import { applyTuningSchema } from "@/lib/validators/postgres-tuning";

export const dynamic = "force-dynamic";

/** Detected resources, current vs recommended settings, and what this install can do. */
export const GET = handleApi(async () => {
  await requireAdmin();
  return jsonOk(await detectTuningState());
});

/**
 * Apply the recommended value for each selected setting. Values are recomputed
 * server-side from detection + `overrides`; a `{ mode: "manual" }` result
 * carries the exact SQL when the database role lacks the privileges.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireAdmin();
  const body = applyTuningSchema.parse(await req.json());
  return jsonOk(await applyTuning(user.id, { settings: body.settings, overrides: body.overrides ?? null }));
});
