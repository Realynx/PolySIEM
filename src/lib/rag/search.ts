import "server-only";
import { prisma } from "@/lib/db";
import { embedText } from "./embed";
import { resolveEmbeddingConfig } from "./config";
import type { RagSourceType } from "./index";

/**
 * Cosine similarity of two equal-length vectors. Returns 0 for empty,
 * mismatched-length, or zero-magnitude vectors (never NaN).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Build a short single-line snippet from chunk content, centered on the first
 * query term that appears (or the start of the text when none match).
 */
export function buildSnippet(content: string, query: string, maxLen = 240): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLen) return flat;

  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  let at = -1;
  const lower = flat.toLowerCase();
  for (const t of terms) {
    const idx = lower.indexOf(t);
    if (idx !== -1) {
      at = idx;
      break;
    }
  }
  if (at <= 0) return `${flat.slice(0, maxLen).trimEnd()}…`;

  const start = Math.max(0, at - Math.floor(maxLen / 3));
  const end = Math.min(flat.length, start + maxLen);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}

export interface RagSearchResult {
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  title: string;
  snippet: string;
  score: number;
  href: string | null;
}

export interface RagSearchOptions {
  limit?: number;
  sourceTypes?: RagSourceType[];
  /** Drop results at or below this cosine score (default 0). */
  minScore?: number;
}

export interface RagSearchResponse {
  query: string;
  model: string;
  mock: boolean;
  results: RagSearchResult[];
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;

/**
 * Embed the query, score it against every stored chunk for the active model
 * with cosine similarity, and return the top matches. Similarity is computed
 * in-app (homelab scale — no pgvector).
 */
export async function ragSearch(query: string, opts: RagSearchOptions = {}): Promise<RagSearchResponse> {
  const q = query.trim();
  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const cfg = await resolveEmbeddingConfig();
  const base: RagSearchResponse = { query: q, model: cfg.model, mock: cfg.isMock, results: [] };
  if (!q) return base;

  const queryVec = await embedText({ baseUrl: cfg.baseUrl, model: cfg.model }, q);

  const rows = await prisma.embeddingChunk.findMany({
    where: {
      model: cfg.model,
      ...(opts.sourceTypes && opts.sourceTypes.length > 0 ? { sourceType: { in: opts.sourceTypes } } : {}),
    },
    select: {
      sourceType: true,
      sourceId: true,
      chunkIndex: true,
      title: true,
      content: true,
      embedding: true,
      href: true,
    },
  });

  const minScore = opts.minScore ?? 0;
  const scored: RagSearchResult[] = [];
  for (const r of rows) {
    const score = cosineSimilarity(queryVec, r.embedding);
    if (score <= minScore) continue;
    scored.push({
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      chunkIndex: r.chunkIndex,
      title: r.title,
      snippet: buildSnippet(r.content, q),
      score,
      href: r.href,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return { ...base, results: scored.slice(0, limit) };
}
