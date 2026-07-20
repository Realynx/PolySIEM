import { listQuerySchema, type ListQuery } from "@/lib/validators/inventory";

export type PageSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

/** Parse a page's ?q=&source=&status=&page= searchParams into a ListQuery (invalid → defaults). */
export function parseListParams(sp: PageSearchParams, pageSize = 50): ListQuery {
  const candidate = {
    q: first(sp.q),
    source: first(sp.source),
    status: first(sp.status),
    page: first(sp.page),
    pageSize: String(pageSize),
  };
  const parsed = listQuerySchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  return listQuerySchema.parse({ q: candidate.q, pageSize: String(pageSize) });
}
