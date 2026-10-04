import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { createPrivacyRouterSchema } from "@/lib/validators/privacy-router";
import { createPrivacyRouter, listPrivacyRouters, privacyRouterSshEndpointSchema } from "@/lib/services/privacy-router";

/**
 * Privacy routers — the managed LAN boxes that decide, per flow, whether traffic
 * egresses over the WAN or over one of their WireGuard exits.
 *
 * The body carries the router itself and the SSH endpoint side by side, parsed
 * by two schemas: what a router IS lives in `validators/privacy-router.ts`, while
 * host / port / username belong to the shared managed-host encoding. Both read
 * the same object; zod strips what each does not own.
 */
export const GET = handleApi(async () => {
  await requireUser();
  return jsonOk(toJsonSafe(await listPrivacyRouters()));
});

export const POST = handleApi(async (req: NextRequest) => {
  const session = await requireAdmin();
  const body = await req.json();
  const input = createPrivacyRouterSchema.parse(body);
  const ssh = privacyRouterSshEndpointSchema.parse(body);
  const router = await createPrivacyRouter({ type: "user", userId: session.user.id }, input, ssh);
  return jsonOk(toJsonSafe(router), { status: 201 });
});
