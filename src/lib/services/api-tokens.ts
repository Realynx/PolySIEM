import "server-only";
import { prisma } from "@/lib/db";
import { createApiToken, type TokenScope } from "@/lib/auth/api-token";
import { audit, type AuditActor } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import type { CreateApiTokenInput } from "@/lib/validators/tokens";

/** Public shape — never exposes tokenHash. */
const TOKEN_SELECT = {
  id: true,
  name: true,
  tokenPrefix: true,
  scopes: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  user: { select: { username: true } },
} as const;

export async function listApiTokens() {
  return prisma.apiToken.findMany({ select: TOKEN_SELECT, orderBy: { createdAt: "desc" } });
}

/** Create a token for a user; the raw token is returned exactly once. */
export async function createToken(actor: AuditActor, userId: string, input: CreateApiTokenInput) {
  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
    : null;
  const { token, record } = await createApiToken({
    name: input.name,
    userId,
    scopes: input.scopes as TokenScope[],
    expiresAt,
  });
  await audit(actor, "api_token.create", { type: "api_token", id: record.id }, {
    name: record.name,
    scopes: record.scopes,
  });
  const sanitized = await prisma.apiToken.findUniqueOrThrow({
    where: { id: record.id },
    select: TOKEN_SELECT,
  });
  return { token, record: sanitized };
}

export async function revokeApiToken(actor: AuditActor, id: string) {
  const existing = await prisma.apiToken.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "not_found", "API token not found");
  if (existing.revokedAt) throw new ApiError(400, "already_revoked", "This token is already revoked");
  const updated = await prisma.apiToken.update({
    where: { id },
    data: { revokedAt: new Date() },
    select: TOKEN_SELECT,
  });
  await audit(actor, "api_token.revoke", { type: "api_token", id }, { name: existing.name });
  return updated;
}

export async function deleteApiToken(actor: AuditActor, id: string) {
  const existing = await prisma.apiToken.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "not_found", "API token not found");
  await prisma.apiToken.delete({ where: { id } });
  await audit(actor, "api_token.delete", { type: "api_token", id }, { name: existing.name });
}
