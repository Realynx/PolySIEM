import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { createTunnelSchema } from "@/lib/validators/tunnels";
import { reconcileTunnelHostnames } from "@/lib/services/tunnel-dns";
import { toJsonSafe } from "@/lib/serialize";

const tunnelInclude = {
  device: { select: { id: true, name: true } },
  vm: { select: { id: true, name: true } },
  container: { select: { id: true, name: true } },
} as const;

export const GET = handleApi(async () => {
  await requireUser();
  const tunnels = await prisma.tunnel.findMany({
    orderBy: { name: "asc" },
    include: tunnelInclude,
  });
  return jsonOk(toJsonSafe(tunnels));
});

export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireAdmin();
  const input = createTunnelSchema.parse(await req.json());
  const tunnel = await prisma.tunnel.create({ data: input, include: tunnelInclude });
  await reconcileTunnelHostnames(tunnel.id, tunnel.ingressHostnames);
  await audit({ type: "user", userId: user.id }, "tunnel.create", { type: "tunnel", id: tunnel.id }, {
    name: tunnel.name,
    provider: tunnel.provider,
    hostnames: tunnel.ingressHostnames.length,
  });
  return jsonOk(toJsonSafe(tunnel), { status: 201 });
});
