/**
 * Ollama embedding client + pure helpers for the RAG index.
 *
 * Supports both Ollama embedding endpoints:
 *   - POST {baseUrl}/api/embed       (newer)  body {model, input}  -> {embeddings: [[...]]}
 *   - POST {baseUrl}/api/embeddings  (older)  body {model, prompt} -> {embedding: [...]}
 *
 * In mock mode (baseUrl starting "mock://", or MOCK_AI=true) it returns a
 * deterministic pseudo-embedding so tests and the demo work fully offline.
 *
 * This module deliberately avoids importing "server-only"/next so its pure
 * parts (response-shape parsing, mock embedding) stay unit-testable in vitest.
 */

export interface EmbedTarget {
  baseUrl: string;
  model: string;
}

/** Dimension of the deterministic mock embedding. */
export const MOCK_EMBED_DIM = 64;

/**
 * Sentinel base URL that routes embeddings to Azure OpenAI. `resolveEmbeddingConfig`
 * sets it (with the deployment as the "model") when the embedding provider is
 * Azure; `embedTexts` detects it and delegates to the Azure client. Mirrors how
 * "mock://" selects the offline backend, so index.ts / search.ts stay unchanged.
 */
export const AZURE_EMBED_BASE = "azure://openai";
export const OPENAI_EMBED_BASE = "openai://api";

const EMBED_TIMEOUT_MS = 60_000;

/** Thrown when the embedding backend is unreachable or returns an unusable body. */
export class EmbedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbedError";
  }
}

export function isMockEmbedBase(baseUrl: string): boolean {
  return baseUrl.startsWith("mock://") || process.env.MOCK_AI === "true";
}

/** True when the target selects the Azure OpenAI embedding backend. */
export function isAzureEmbedBase(baseUrl: string): boolean {
  return baseUrl.startsWith("azure://");
}

/** True when the target selects the OpenAI embedding backend. */
export function isOpenAIEmbedBase(baseUrl: string): boolean {
  return baseUrl.startsWith("openai://");
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function isAbort(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

/** FNV-1a 32-bit hash of a string (deterministic across runs). */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function isNumberArray(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/**
 * Deterministic pseudo-embedding: a hashed, sign-split bag of words, L2
 * normalized. The same text always yields the same vector, and texts that
 * share words get a positive cosine similarity, so mock-mode search still
 * ranks sensibly.
 */
export function mockEmbedding(text: string, dim = MOCK_EMBED_DIM): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const token of tokens) {
    const h = fnv1a(token);
    const bucket = h % dim;
    const sign = (h & 0x100) === 0 ? 1 : -1;
    vec[bucket] += sign;
  }
  // Guarantee a non-zero vector even for empty / symbol-only text.
  if (tokens.length === 0) vec[fnv1a(text) % dim] = 1;
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

/**
 * Parse an Ollama embedding response into a list of vectors, accepting both
 * the newer /api/embed ({embeddings:[[...]]}) and the older /api/embeddings
 * ({embedding:[...]}) shapes. Returns null when neither shape carries a usable
 * numeric vector.
 */
export function parseEmbedResponse(body: unknown): number[][] | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as { embeddings?: unknown; embedding?: unknown };
  if (Array.isArray(obj.embeddings)) {
    const rows = obj.embeddings
      .filter(isNumberArray)
      .filter((r) => r.length > 0);
    return rows.length > 0 ? rows : null;
  }
  if (isNumberArray(obj.embedding) && obj.embedding.length > 0) {
    return [obj.embedding];
  }
  return null;
}

async function postJson(
  url: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (isAbort(err)) throw new EmbedError("Embedding request timed out");
    throw new EmbedError(`Could not reach the embedding backend (${url}).`);
  }
  if (!res.ok) {
    let message = `Embedding backend returned HTTP ${res.status}.`;
    try {
      const b = (await res.json()) as { error?: string };
      if (b?.error) message = b.error;
    } catch {
      // keep the HTTP status message
    }
    throw new EmbedError(message);
  }
  return res.json();
}

/**
 * Embed a batch of texts. Tries the newer batch /api/embed endpoint first and
 * falls back to the older per-input /api/embeddings endpoint (both response
 * shapes handled). Throws EmbedError when the backend is unreachable or returns
 * an unusable response.
 */
export async function embedTexts(
  target: EmbedTarget,
  inputs: string[],
  signal?: AbortSignal,
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  if (isMockEmbedBase(target.baseUrl))
    return inputs.map((t) => mockEmbedding(t));

  // Azure backend: delegate to the provider abstraction (lazy import keeps the
  // Azure SDK / server-only settings out of this file's pure surface).
  if (isAzureEmbedBase(target.baseUrl) || isOpenAIEmbedBase(target.baseUrl)) {
    const { hostedEmbedTexts } = await import("@/lib/ai/provider");
    return hostedEmbedTexts(inputs);
  }

  const base = normalizeBaseUrl(target.baseUrl);
  const timeout = AbortSignal.timeout(EMBED_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  // Preferred: batch /api/embed. A 404 (older Ollama) or shape mismatch falls
  // through to /api/embeddings; a timeout aborts outright.
  try {
    const body = await postJson(
      `${base}/api/embed`,
      { model: target.model, input: inputs },
      combined,
    );
    const vectors = parseEmbedResponse(body);
    if (vectors && vectors.length === inputs.length) return vectors;
  } catch (err) {
    if (
      isAbort(err) ||
      (err instanceof EmbedError && /timed out/.test(err.message))
    )
      throw err;
    // otherwise fall through to the legacy endpoint
  }

  // Fallback: older /api/embeddings, one prompt per call.
  const out: number[][] = [];
  for (const input of inputs) {
    const body = await postJson(
      `${base}/api/embeddings`,
      { model: target.model, prompt: input },
      combined,
    );
    const vectors = parseEmbedResponse(body);
    if (!vectors)
      throw new EmbedError("The embedding backend returned no vector.");
    out.push(vectors[0]);
  }
  return out;
}

/** Embed a single text; convenience wrapper over embedTexts. */
export async function embedText(
  target: EmbedTarget,
  input: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const [vec] = await embedTexts(target, [input], signal);
  if (!vec) throw new EmbedError("The embedding backend returned no vector.");
  return vec;
}
