import "server-only";
import type { ApiToken } from "@prisma/client";
import { prisma } from "@/lib/db";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { ApiError } from "@/lib/api";

export const TOKEN_SCOPES = ["read", "write_docs", "trigger_sync", "credentials"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export const TOKEN_PREFIX = "ps_";

/** Create a new API token; the raw token is returned exactly once. */
export async function createApiToken(input: {
  name: string;
  userId: string;
  scopes: TokenScope[];
  expiresAt?: Date | null;
}): Promise<{ token: string; record: ApiToken }> {
  const raw = `${TOKEN_PREFIX}${randomToken(32)}`;
  const record = await prisma.apiToken.create({
    data: {
      name: input.name,
      userId: input.userId,
      scopes: input.scopes,
      tokenHash: sha256Hex(raw),
      tokenPrefix: raw.slice(0, 11),
      expiresAt: input.expiresAt ?? null,
    },
  });
  return { token: raw, record };
}

/** Validate a Bearer token string; returns the token record or null. */
export async function validateApiToken(raw: string): Promise<ApiToken | null> {
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const record = await prisma.apiToken.findUnique({ where: { tokenHash: sha256Hex(raw) } });
  if (!record) return null;
  if (record.revokedAt) return null;
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return null;
  prisma.apiToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return record;
}

/** Extract and validate a Bearer token from a Request; throws 401 on failure. */
export async function requireApiToken(req: Request): Promise<ApiToken> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiError(401, "unauthorized", "Missing Bearer token");
  const record = await validateApiToken(match[1].trim());
  if (!record) throw new ApiError(401, "unauthorized", "Invalid or expired API token");
  return record;
}

export function requireScope(token: ApiToken, scope: TokenScope) {
  if (!token.scopes.includes(scope)) {
    throw new ApiError(403, "forbidden", `Token is missing the "${scope}" scope`);
  }
}
