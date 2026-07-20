import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";

const auditQuerySchema = z.object({
  entityType: z.string().max(64).optional(),
  entityId: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = handleApi(async (req: NextRequest) => {
  const { user } = await requireUser();
  const { searchParams } = new URL(req.url);
  const query = auditQuerySchema.parse({
    entityType: searchParams.get("entityType") ?? undefined,
    entityId: searchParams.get("entityId") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });

  // Non-admins may only read the audit trail for a specific entity (the
  // per-entity "history" panel). The unscoped, system-wide log — which exposes
  // admin activity, token names, and integration errors — is admin-only.
  if (user.role !== "ADMIN" && !(query.entityType && query.entityId)) {
    throw new ApiError(403, "forbidden", "Viewing the full audit log requires administrator access");
  }

  const rows = await prisma.auditLog.findMany({
    where: {
      entityType: query.entityType,
      entityId: query.entityId,
    },
    orderBy: { createdAt: "desc" },
    take: query.limit,
    include: { user: { select: { username: true } } },
  });
  return jsonOk(toJsonSafe(rows));
});
