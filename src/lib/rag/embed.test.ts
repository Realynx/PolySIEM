import { describe, expect, it } from "vitest";
import {
  MOCK_EMBED_DIM,
  isAzureEmbedBase,
  isOpenAIEmbedBase,
  mockEmbedding,
  parseEmbedResponse,
} from "./embed";

/** Local cosine so this pure test never loads the db-backed search module. */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe("parseEmbedResponse", () => {
  it("parses the newer /api/embed batch shape {embeddings:[[...]]}", () => {
    expect(
      parseEmbedResponse({
        embeddings: [
          [1, 2, 3],
          [4, 5, 6],
        ],
      }),
    ).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("parses the older /api/embeddings shape {embedding:[...]} into a single-row list", () => {
    expect(parseEmbedResponse({ embedding: [0.1, 0.2, 0.3] })).toEqual([
      [0.1, 0.2, 0.3],
    ]);
  });

  it("returns null for missing, empty, or non-numeric vectors", () => {
    expect(parseEmbedResponse(null)).toBeNull();
    expect(parseEmbedResponse({})).toBeNull();
    expect(parseEmbedResponse({ embedding: [] })).toBeNull();
    expect(parseEmbedResponse({ embeddings: [] })).toBeNull();
    expect(parseEmbedResponse({ embedding: ["a", "b"] })).toBeNull();
    expect(parseEmbedResponse({ embeddings: [[NaN]] })).toBeNull();
  });
});

describe("mockEmbedding", () => {
  it("is deterministic and of the fixed dimension", () => {
    const a = mockEmbedding("dixie the proxmox host");
    const b = mockEmbedding("dixie the proxmox host");
    expect(a).toHaveLength(MOCK_EMBED_DIM);
    expect(a).toEqual(b);
  });

  it("is L2-normalized (unit length)", () => {
    const v = mockEmbedding("the LocalServers network vlan 10");
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it("gives identical text cosine ~1 and shared-word text a positive score", () => {
    const base = mockEmbedding("proxmox cluster node dixie storage");
    expect(
      cosine(base, mockEmbedding("proxmox cluster node dixie storage")),
    ).toBeCloseTo(1, 6);
    // Overlapping vocabulary ⇒ some positive similarity.
    expect(cosine(base, mockEmbedding("dixie proxmox host"))).toBeGreaterThan(
      0,
    );
  });

  it("never returns a zero vector, even for symbol-only text", () => {
    const v = mockEmbedding("!!! ???");
    expect(v.some((x) => x !== 0)).toBe(true);
  });
});

describe("hosted embedding sentinels", () => {
  it("distinguishes Azure and OpenAI routing targets", () => {
    expect(isAzureEmbedBase("azure://openai")).toBe(true);
    expect(isAzureEmbedBase("openai://api")).toBe(false);
    expect(isOpenAIEmbedBase("openai://api")).toBe(true);
    expect(isOpenAIEmbedBase("http://localhost:11434")).toBe(false);
  });
});
