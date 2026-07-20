import "server-only";

import type { ListQuery } from "@/lib/validators/inventory";

export function paging(query: ListQuery) {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function baseWhere(query: ListQuery) {
  return {
    ...(query.q
      ? { name: { contains: query.q, mode: "insensitive" as const } }
      : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.status
      ? { status: query.status }
      : { status: { not: "REMOVED" as const } }),
  };
}

