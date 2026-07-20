import { describe, expect, it } from "vitest";
import { dedupeKeyFor, extractJson, parseFindings } from "./parse";

const FINDING = {
  title: "Repeated scan alerts",
  severity: "high",
  category: "recon",
  summary: "A host scanned ports.",
  suggestions: "Block it.",
  dedupe: "et-scan-1.2.3.4",
  refs: { srcIps: ["1.2.3.4"] },
};

describe("extractJson", () => {
  it("parses a plain JSON object", () => {
    expect(extractJson('{"findings": []}')).toEqual({ findings: [] });
  });

  it("strips markdown code fences", () => {
    expect(extractJson('```json\n{"findings": []}\n```')).toEqual({ findings: [] });
  });

  it("skips leading prose before the JSON", () => {
    expect(extractJson('Here are my findings:\n{"findings": []}')).toEqual({ findings: [] });
  });

  it("tolerates trailing prose after the JSON", () => {
    expect(extractJson('{"findings": []}\nLet me know if you need more.')).toEqual({ findings: [] });
  });

  it("returns null for garbage", () => {
    expect(extractJson("no structured content here")).toBeNull();
    expect(extractJson("")).toBeNull();
  });
});

describe("parseFindings", () => {
  it("parses the canonical {findings: [...]} wrapper", () => {
    const findings = parseFindings(JSON.stringify({ findings: [FINDING] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("HIGH");
    expect(findings[0].category).toBe("recon");
  });

  it("accepts a bare array of findings", () => {
    expect(parseFindings(JSON.stringify([FINDING, FINDING]))).toHaveLength(2);
  });

  it("accepts a single finding object without the wrapper", () => {
    expect(parseFindings(JSON.stringify(FINDING))).toHaveLength(1);
  });

  it("normalizes severity case and falls back on unknown categories", () => {
    const [finding] = parseFindings(JSON.stringify({ ...FINDING, severity: "Critical", category: "weird-thing" }));
    expect(finding.severity).toBe("CRITICAL");
    expect(finding.category).toBe("anomaly");
  });

  it("drops malformed findings but keeps valid siblings", () => {
    const findings = parseFindings(JSON.stringify({ findings: [FINDING, { title: "missing everything" }] }));
    expect(findings).toHaveLength(1);
  });

  it("returns [] for garbage", () => {
    expect(parseFindings("the model rambled with no JSON")).toEqual([]);
  });

  it("carries matchesExisting through when present and tolerates its absence", () => {
    const [withMatch] = parseFindings(JSON.stringify({ ...FINDING, matchesExisting: "T2" }));
    expect(withMatch.matchesExisting).toBe("T2");
    const [without] = parseFindings(JSON.stringify(FINDING));
    expect(without.matchesExisting == null).toBe(true);
    const [nulled] = parseFindings(JSON.stringify({ ...FINDING, matchesExisting: null }));
    expect(nulled.matchesExisting).toBeNull();
  });
});

describe("dedupeKeyFor", () => {
  it("is stable for the same input", () => {
    expect(dedupeKeyFor("suricata", "et-scan-1.2.3.4")).toBe(dedupeKeyFor("suricata", "et-scan-1.2.3.4"));
  });

  it("normalizes case, whitespace and punctuation", () => {
    expect(dedupeKeyFor("suricata", "ET Scan  1.2.3.4!")).toBe(dedupeKeyFor("suricata", "et-scan-1.2.3.4"));
  });

  it("scopes keys so the same slug in different scopes differs", () => {
    expect(dedupeKeyFor("suricata", "same-slug")).not.toBe(dedupeKeyFor("general", "same-slug"));
  });

  it("emits 16 hex chars", () => {
    expect(dedupeKeyFor("suricata", "x")).toMatch(/^[0-9a-f]{16}$/);
  });
});
