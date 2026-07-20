import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { ticketPatchSchema } from "@/lib/validators/scan";
import { getTicket, patchTicket } from "@/lib/services/tickets";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = handleApi(async (_req: NextRequest, { params }: Params) => {
  await requireUser();
  const { id } = await params;
  return jsonOk(await getTicket(id));
});

export const PATCH = handleApi(async (req: NextRequest, { params }: Params) => {
  const { user } = await requireUser();
  const { id } = await params;
  const body = await req.json().catch(() => {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  });
  const input = ticketPatchSchema.parse(body);
  return jsonOk(await patchTicket({ type: "user", userId: user.id }, id, input));
});
