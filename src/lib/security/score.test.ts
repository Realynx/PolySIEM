import { describe, expect, it } from "vitest";
import { computeScore, scoreGrade, sortFindings } from "./score";
import type { SecurityFinding } from "./types";

function finding(partial: Partial<SecurityFinding>): SecurityFinding {
  return {
    id: partial.id ?? "test-finding",
    severity: "low",
    category: "firewall",
    title: "t",
    detail: "d",
    remediation: "r",
    affected: [],
    ...partial,
  };
}

describe("computeScore", () => {
  it("returns a perfect score with no findings", () => {
    const result = computeScore([]);
    expect(result.score).toBe(100);
    expect(result.deducted).toBe(0);
    expect(result.ceiling).toBe(250);
    expect(result.categories).toHaveLength(5);
    for (const cat of result.categories) {
      expect(cat.score).toBe(100);
      expect(cat.findingCount).toBe(0);
    }
  });

  it("deducts by severity weight against the 250-point pool", () => {
    const result = computeScore([
      finding({ id: "a", severity: "critical" }), // 35
      finding({ id: "b", severity: "high" }), // 18
      finding({ id: "c", severity: "medium" }), // 8
      finding({ id: "d", severity: "low" }), // 3
      finding({ id: "e", severity: "info" }), // 0
    ]);
    expect(result.deducted).toBe(64);
    // round(100 - 100 * 64 / 250) = round(74.4)
    expect(result.score).toBe(74);
    expect(result.bySeverity).toEqual({ critical: 1, high: 1, medium: 1, low: 1, info: 1 });
  });

  it("honors an explicit per-finding weight override", () => {
    const result = computeScore([finding({ id: "w", severity: "low", weight: 50, category: "exposure" })]);
    expect(result.deducted).toBe(50);
    expect(result.score).toBe(80); // round(100 - 100*50/250)
    // exposure ceiling 65 -> round(100 - 100*50/65) = round(23.08)
    expect(result.categories.find((c) => c.id === "exposure")?.score).toBe(23);
  });

  it("floors the overall score at 0", () => {
    const findings = Array.from({ length: 8 }, (_, i) => finding({ id: `c${i}`, severity: "critical" }));
    const result = computeScore(findings);
    expect(result.score).toBe(0);
    expect(result.deducted).toBe(280);
  });

  it("computes independent per-category subscores against category ceilings", () => {
    const result = computeScore([
      finding({ id: "a", severity: "critical", category: "access" }), // 35
      finding({ id: "b", severity: "medium", category: "access" }), // 8
      finding({ id: "c", severity: "low", category: "documentation" }), // 3
    ]);
    const access = result.categories.find((c) => c.id === "access");
    const docs = result.categories.find((c) => c.id === "documentation");
    const exposure = result.categories.find((c) => c.id === "exposure");
    // access ceiling 45, deducted 43 -> round(100 - 100*43/45)
    expect(access?.score).toBe(4);
    expect(access?.findingCount).toBe(2);
    // docs ceiling 30, deducted 3 -> round(100 - 10)
    expect(docs?.score).toBe(90);
    expect(exposure?.score).toBe(100);
    // overall 46 / 250 -> round(81.6)
    expect(result.score).toBe(82);
  });

  it("floors category subscores at 0", () => {
    const findings = Array.from({ length: 2 }, (_, i) =>
      finding({ id: `x${i}`, severity: "critical", category: "exposure" }),
    );
    // exposure ceiling 65, deducted 70 -> floored 0
    const result = computeScore(findings);
    expect(result.categories.find((c) => c.id === "exposure")?.score).toBe(0);
  });
});

describe("scoreGrade", () => {
  it("buckets scores", () => {
    expect(scoreGrade(100)).toBe("excellent");
    expect(scoreGrade(90)).toBe("excellent");
    expect(scoreGrade(89)).toBe("good");
    expect(scoreGrade(75)).toBe("good");
    expect(scoreGrade(74)).toBe("fair");
    expect(scoreGrade(50)).toBe("fair");
    expect(scoreGrade(49)).toBe("at-risk");
    expect(scoreGrade(0)).toBe("at-risk");
  });
});

describe("sortFindings", () => {
  it("orders worst-first with a stable tiebreak", () => {
    const sorted = sortFindings([
      finding({ id: "b-low", severity: "low" }),
      finding({ id: "a-crit", severity: "critical" }),
      finding({ id: "z-high", severity: "high" }),
      finding({ id: "a-high", severity: "high" }),
    ]);
    expect(sorted.map((f) => f.id)).toEqual(["a-crit", "a-high", "z-high", "b-low"]);
  });

  it("does not mutate the input", () => {
    const input = [finding({ id: "b", severity: "low" }), finding({ id: "a", severity: "critical" })];
    sortFindings(input);
    expect(input[0].id).toBe("b");
  });
});
