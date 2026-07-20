import { describe, expect, it, vi } from "vitest";

// search.ts imports the db-backed prisma client transitively (via ./config →
// settings); stub it so the pure helpers below load without a database.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { buildSnippet, cosineSimilarity } from "./search";

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([2, 4, 6], [1, 2, 3])).toBeCloseTo(1, 10); // scale-invariant
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0, 0], [0, 5, 0])).toBe(0);
  });

  it("is -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 10);
  });

  it("returns 0 (never NaN) for zero, empty, or mismatched-length vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });
});

describe("buildSnippet", () => {
  it("returns the whole text (whitespace-collapsed) when short", () => {
    expect(buildSnippet("  hello   world ", "world")).toBe("hello world");
  });

  it("truncates from the start with an ellipsis when no term matches", () => {
    const text = "a ".repeat(400);
    const snip = buildSnippet(text, "zzz", 40);
    expect(snip.endsWith("…")).toBe(true);
    expect(snip.length).toBeLessThanOrEqual(41);
  });

  it("centers the window on the first matching query term", () => {
    const text = `${"x ".repeat(200)}NEEDLE ${"y ".repeat(200)}`;
    const snip = buildSnippet(text, "needle", 60);
    expect(snip).toContain("NEEDLE");
    expect(snip.startsWith("…")).toBe(true);
    expect(snip.endsWith("…")).toBe(true);
  });
});
