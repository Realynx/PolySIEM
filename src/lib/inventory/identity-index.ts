import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface InventoryIdentityMatch {
  id: string;
  kind: "device" | "vm" | "container";
  name: string;
}

const IDENTITY_QUERY_CHUNK_SIZE = 5_000;

export function normalizedIdentityKey(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "").split(".")[0] ?? "";
}

/**
 * Resolve only the inventory rows whose normalized first DNS label is relevant
 * to an integration snapshot. Functional indexes added by the matching
 * migration keep this bounded without transferring complete inventory tables.
 */
export async function findInventoryByIdentityKeys(
  values: readonly string[],
  options?: { excludeDeviceSource?: string },
): Promise<InventoryIdentityMatch[]> {
  const keys = [...new Set(values.map(normalizedIdentityKey).filter(Boolean))];
  if (keys.length === 0) return [];
  const sourceFilter = options?.excludeDeviceSource
    ? Prisma.sql`AND "source"::text <> ${options.excludeDeviceSource}`
    : Prisma.empty;
  const matches: InventoryIdentityMatch[] = [];
  for (let offset = 0; offset < keys.length; offset += IDENTITY_QUERY_CHUNK_SIZE) {
    const chunk = keys.slice(offset, offset + IDENTITY_QUERY_CHUNK_SIZE);
    matches.push(...await prisma.$queryRaw<InventoryIdentityMatch[]>(Prisma.sql`
      SELECT "id", 'device'::text AS "kind", "name"
      FROM "Device"
      WHERE "status"::text <> 'REMOVED'
        ${sourceFilter}
        AND lower(split_part(rtrim("name", '.'), '.', 1)) IN (${Prisma.join(chunk)})
      UNION ALL
      SELECT "id", 'vm'::text AS "kind", "name"
      FROM "VirtualMachine"
      WHERE "status"::text <> 'REMOVED'
        AND lower(split_part(rtrim("name", '.'), '.', 1)) IN (${Prisma.join(chunk)})
      UNION ALL
      SELECT "id", 'container'::text AS "kind", "name"
      FROM "Container"
      WHERE "status"::text <> 'REMOVED'
        AND lower(split_part(rtrim("name", '.'), '.', 1)) IN (${Prisma.join(chunk)})
    `));
  }
  return matches;
}
