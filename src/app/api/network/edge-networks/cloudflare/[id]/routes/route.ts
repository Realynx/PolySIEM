import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import {
  createCloudflarePublishedRoute,
  deleteCloudflarePublishedRoute,
} from "@/lib/services/cloudflare-published-routes";
import {
  cloudflarePublishedRouteSchema,
  deleteCloudflarePublishedRouteSchema,
} from "@/lib/validators/cloudflare-routes";

type Params = { params: Promise<{ id: string }> };

export const POST = handleApi(async (req: NextRequest, { params }: Params) => {
  const session = await requireAdmin();
  const { id } = await params;
  const input = cloudflarePublishedRouteSchema.parse(await req.json());
  return jsonOk(await createCloudflarePublishedRoute({ type: "user", userId: session.user.id }, id, input), { status: 201 });
});

export const DELETE = handleApi(async (req: NextRequest, { params }: Params) => {
  const session = await requireAdmin();
  const { id } = await params;
  const input = deleteCloudflarePublishedRouteSchema.parse(await req.json());
  return jsonOk(await deleteCloudflarePublishedRoute({ type: "user", userId: session.user.id }, id, input));
});
