import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { ticketCreateSchema, ticketListQuerySchema } from "@/lib/validators/scan";
import { createTicket, listTickets } from "@/lib/services/tickets";

export const dynamic = "force-dynamic";

export const GET = handleApi(async (req: NextRequest) => {
  await requireUser();
  const query = ticketListQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return jsonOk(await listTickets(query));
});

export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireUser();
  const body = await req.json().catch(() => {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  });
  const input = ticketCreateSchema.parse(body);
  return jsonOk(await createTicket({ type: "user", userId: user.id }, input));
});
