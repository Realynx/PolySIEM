import type { NextRequest } from "next/server";
import { handleApi, jsonOk, ApiError } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { updateTunnelSchema, type UpdateTunnelInput } from "@/lib/validators/tunnels";
import { reconcileTunnelHostnames } from "@/lib/services/tunnel-dns";
import { toJsonSafe } from "@/lib/serialize";

type Params = { params: Promise<{ id: string }> };

/**
 * Parse the PATCH body, then drop keys the client did not send — the update
 * schema is `createTunnelSchema.partial()` and zod v4 still applies defaults
 * (provider, ingressHostnames) for absent keys, which would clobber fields the
 * client never touched.
 */
function parsePatch(body: unknown): UpdateTunnelInput {
  const parsed = updateTunnelSchema.parse(body) as Record<string, unknown>;
  const provided = new Set(Object.keys((body ?? {}) as Record<string, unknown>));
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => provided.has(key))) as UpdateTunnelInput;
}

export const PATCH = handleApi(async (req: NextRequest, { params }: Params) => {
  const { user } = await requireAdmin();
  const { id } = await params;
  const input = parsePatch(await req.json());
  const existing = await prisma.tunnel.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new ApiError(404, "not_found", "Tunnel not found");
  const tunnel = await prisma.tunnel.update({
    where: { id },
    data: input,
    include: {
      device: { select: { id: true, name: true } },
      vm: { select: { id: true, name: true } },
      container: { select: { id: true, name: true } },
    },
  });
  // Keep hostname rows in step with the array whenever the client sent it.
  if ("ingressHostnames" in input) await reconcileTunnelHostnames(id, tunnel.ingressHostnames);
  await audit({ type: "user", userId: user.id }, "tunnel.update", { type: "tunnel", id }, {
    fields: Object.keys(input),
  });
  return jsonOk(toJsonSafe(tunnel));
});

export const DELETE = handleApi(async (_req: NextRequest, { params }: Params) => {
  const { user } = await requireAdmin();
  const { id } = await params;
  const existing = await prisma.tunnel.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!existing) throw new ApiError(404, "not_found", "Tunnel not found");
  await prisma.tunnel.delete({ where: { id } });
  await audit({ type: "user", userId: user.id }, "tunnel.delete", { type: "tunnel", id }, {
    name: existing.name,
  });
  return jsonOk({ deleted: true });
});
