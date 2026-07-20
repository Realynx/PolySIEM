import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { getAssociatedLogs } from "@/lib/services/associated-logs";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  entity: z.enum(["hosts", "containers", "vms"]),
  id: z.string().min(1),
});
const querySchema = z.object({
  integrationId: z.string().min(1).optional(),
  hours: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(24),
});

/** Live, secret-free Elasticsearch events associated with an inventory asset. */
export const GET = handleApi(
  async (
    req: NextRequest,
    context: { params: Promise<{ entity: string; id: string }> },
  ) => {
    await requireUser();
    const params = paramsSchema.parse(await context.params);
    const query = querySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams),
    );
    return jsonOk(
      await getAssociatedLogs({ type: params.entity, id: params.id, ...query }),
    );
  },
);
