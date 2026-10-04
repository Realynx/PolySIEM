/**
 * Shared input schemas and opaque cursor pagination for MCP list tools (pure).
 *
 * Cursors are opaque base64url offsets. They are stable for a given filter
 * and sort order, which is all an agent paging through a list needs; the
 * caller must pass the same filters with the cursor it got back.
 */
import { z } from "zod";
import { ApiError } from "@/lib/api";

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export const limitInput = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .optional()
  .describe(`Max items to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`);

export const cursorInput = z
  .string()
  .max(64)
  .optional()
  .describe("Opaque cursor from a previous call's nextCursor; repeat the same filters");

export const detailInput = z
  .enum(["summary", "full"])
  .optional()
  .describe("summary (default): ids + key fields. full: every documented field, relations and metadata");

export type Detail = "summary" | "full";

export function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const match = /^o:(\d{1,9})$/.exec(decoded);
  if (!match) {
    throw new ApiError(400, "invalid_cursor", "Invalid cursor. Pass the exact nextCursor value from the previous call, or omit it to start over.");
  }
  return Number(match[1]);
}

export interface PageWindow {
  skip: number;
  take: number;
  limit: number;
}

/** Prisma skip/take for a cursor+limit; fetches one extra row to detect more. */
export function pageWindow(args: { cursor?: string; limit?: number }): PageWindow {
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  return { skip: decodeCursor(args.cursor), take: limit + 1, limit };
}

export interface Page<T> {
  items: T[];
  total?: number;
  nextCursor: string | null;
}

/** Turn an over-fetched row list into a page with nextCursor. */
export function toPage<T>(rows: T[], window: PageWindow, total?: number): Page<T> {
  const hasMore = rows.length > window.limit;
  return {
    items: rows.slice(0, window.limit),
    ...(total !== undefined ? { total } : {}),
    nextCursor: hasMore ? encodeCursor(window.skip + window.limit) : null,
  };
}

/** Page an in-memory list (for derived data such as findings or graph edges). */
export function pageArray<T>(all: readonly T[], args: { cursor?: string; limit?: number }): Page<T> {
  const window = pageWindow(args);
  return toPage(all.slice(window.skip, window.skip + window.take), window, all.length);
}
