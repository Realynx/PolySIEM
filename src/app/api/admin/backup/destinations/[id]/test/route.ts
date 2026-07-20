import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { getDestinationConfig } from "@/lib/backup/service";
import { testDestination, type DestinationTestResult } from "@/lib/backup/destinations";

type Ctx = { params: Promise<{ id: string }> };

/** POST — probe connectivity by writing a tiny test object. */
export const POST = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const dest = await getDestinationConfig(id);
  let result: DestinationTestResult;
  try {
    result = await testDestination(dest);
  } catch (err) {
    result = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
  return jsonOk(result);
});
