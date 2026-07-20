import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { createDestinationSchema } from "@/lib/validators/backup";
import { createDestination, listDestinations } from "@/lib/backup/service";

export const GET = handleApi(async () => {
  await requireAdmin();
  return jsonOk(await listDestinations());
});

export const POST = handleApi(async (req: NextRequest) => {
  const session = await requireAdmin();
  const input = createDestinationSchema.parse(await req.json());
  const destination = await createDestination({ type: "user", userId: session.user.id }, input);
  return jsonOk(destination, { status: 201 });
});
