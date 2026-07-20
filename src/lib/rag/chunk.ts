/**
 * Pure text chunking for the RAG index (no server/db imports).
 *
 * Documents are split into overlapping word windows (~500 words ≈ 650 tokens),
 * and inventory entities are flattened into a single compact descriptive blob.
 */

export interface TextChunk {
  index: number;
  content: string;
}

export interface ChunkOptions {
  /** Target window size in words (~1.3 tokens/word ⇒ ~500-800 tokens). */
  maxWords?: number;
  /** Words of overlap between consecutive windows. */
  overlapWords?: number;
}

const DEFAULT_MAX_WORDS = 500;
const DEFAULT_OVERLAP_WORDS = 60;

/** Collapse all runs of whitespace to single spaces and trim. */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Split text into overlapping word windows. Text at or below the window size
 * yields a single chunk; empty text yields no chunks.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): TextChunk[] {
  const maxWords = Math.max(1, opts.maxWords ?? DEFAULT_MAX_WORDS);
  const overlap = Math.min(Math.max(0, opts.overlapWords ?? DEFAULT_OVERLAP_WORDS), maxWords - 1);
  const step = maxWords - overlap; // always >= 1

  const words = normalizeText(text).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  if (words.length <= maxWords) return [{ index: 0, content: words.join(" ") }];

  const chunks: TextChunk[] = [];
  for (let start = 0, index = 0; start < words.length; start += step, index++) {
    chunks.push({ index, content: words.slice(start, start + maxWords).join(" ") });
    // Stop once this window already reached the end (no tiny trailing duplicate).
    if (start + maxWords >= words.length) break;
  }
  return chunks;
}

/** One labelled fact about an entity; empty values are skipped in the blob. */
export interface EntityFact {
  label: string;
  value: string | number | null | undefined;
}

export interface EntityBlobInput {
  /** device | vm | container | network | service */
  kind: string;
  name: string;
  /** Short qualifier shown in the header, e.g. the device kind or runtime. */
  subtitle?: string | null;
  facts?: EntityFact[];
  description?: string | null;
}

/**
 * Build a compact, human-readable text blob describing one inventory entity,
 * suitable for embedding as a single chunk. Empty facts are omitted.
 */
export function entityToBlob(e: EntityBlobInput): string {
  const header = e.subtitle ? `${e.name} — ${e.kind} (${e.subtitle})` : `${e.name} — ${e.kind}`;
  const lines = [header];
  for (const f of e.facts ?? []) {
    if (f.value === null || f.value === undefined || f.value === "") continue;
    lines.push(`${f.label}: ${f.value}`);
  }
  const desc = e.description?.trim();
  if (desc) lines.push(`Description: ${desc}`);
  return lines.join("\n");
}
