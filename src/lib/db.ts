import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Prisma's default pool is `physical_cpus * 2 + 1` connections — just 3 on a
 * 1-vCPU LXC. The dashboard fans out ~20 queries per load, so a tiny pool
 * serialises them into several round-trip waves. Give the pool a sane floor
 * unless the operator pinned `connection_limit` in DATABASE_URL themselves.
 */
export function withConnectionFloor(url: string | undefined, floor = 10): string | undefined {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("connection_limit")) return url;
    parsed.searchParams.set("connection_limit", String(floor));
    return parsed.toString();
  } catch {
    return url;
  }
}

const datasourceUrl = withConnectionFloor(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(datasourceUrl ? { datasourceUrl } : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
