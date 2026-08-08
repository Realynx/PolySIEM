import "server-only";

import { isIP } from "node:net";
import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto";

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface BucketRow {
  count: number;
  expiresAt: Date;
}

function bucketKey(namespace: string, identity: string): string {
  return `${namespace}:${sha256Hex(identity)}`;
}

/**
 * Shared fixed-window limiter backed by PostgreSQL. The single UPSERT is atomic,
 * so limits hold across multiple PolySIEM replicas and concurrent requests.
 */
export async function consumeRateLimit(
  namespace: string,
  identity: string,
  policy: RateLimitPolicy,
): Promise<RateLimitResult> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + policy.windowMs);
  const key = bucketKey(namespace, identity);
  const rows = await prisma.$queryRaw<BucketRow[]>(Prisma.sql`
    INSERT INTO "RateLimitBucket" ("key", "count", "windowStartedAt", "expiresAt", "updatedAt")
    VALUES (${key}, 1, ${now}, ${expiresAt}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN 1
        ELSE "RateLimitBucket"."count" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN ${now}
        ELSE "RateLimitBucket"."windowStartedAt"
      END,
      "expiresAt" = CASE
        WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN ${expiresAt}
        ELSE "RateLimitBucket"."expiresAt"
      END,
      "updatedAt" = ${now}
    RETURNING "count", "expiresAt"
  `);
  const bucket = rows[0];
  if (!bucket) throw new Error("Rate limiter did not return a bucket");

  return {
    allowed: bucket.count <= policy.limit,
    remaining: Math.max(0, policy.limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.expiresAt.getTime() - now.getTime()) / 1000)),
  };
}

/** Clear identity-specific failures after a successful authentication. */
export async function clearRateLimit(namespace: string, identity: string): Promise<void> {
  await prisma.rateLimitBucket.deleteMany({
    where: { key: bucketKey(namespace, identity) },
  });
}

/** Remove a bounded batch of expired counters so cleanup cannot monopolize a login request. */
export async function pruneExpiredRateLimits(now = new Date(), limit = 1_000): Promise<number> {
  const normalizedLimit = Math.min(10_000, Math.max(1, Math.floor(limit)));
  const rows = await prisma.$queryRaw<Array<{ key: string }>>(Prisma.sql`
    WITH expired AS (
      SELECT "key"
      FROM "RateLimitBucket"
      WHERE "expiresAt" <= ${now}
      ORDER BY "expiresAt" ASC
      LIMIT ${normalizedLimit}
    )
    DELETE FROM "RateLimitBucket" AS bucket
    USING expired
    WHERE bucket."key" = expired."key"
      AND bucket."expiresAt" <= ${now}
    RETURNING bucket."key"
  `);
  return rows.length;
}

/**
 * Read a client address only when the deployment explicitly trusts its reverse
 * proxy. This avoids letting callers forge X-Forwarded-For and bypass an IP
 * limit. Account-based limiting remains active when proxy trust is disabled.
 */
export function trustedClientIp(req: NextRequest): string | null {
  if (process.env.TRUST_PROXY_HEADERS !== "true") return null;
  const candidates = [
    req.headers.get("cf-connecting-ip"),
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    req.headers.get("x-real-ip"),
  ];
  for (const candidate of candidates) {
    if (candidate && isIP(candidate)) return candidate;
  }
  return null;
}
