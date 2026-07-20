import { describe, it, expect } from "vitest";
import {
  refsIntersect,
  selectRelated,
  summarizeRelated,
  toRelatedRow,
  type TicketRowInput,
} from "@/lib/ai/agent/related";

function ticket(overrides: Partial<TicketRowInput>): TicketRowInput {
  return {
    id: "t1",
    title: "Suspicious scan",
    severity: "HIGH",
    status: "OPEN",
    category: "recon",
    summary: "Something happened",
    sourceRefs: null,
    lastSeenAt: new Date("2026-07-17T10:00:00Z"),
    ...overrides,
  };
}

describe("refsIntersect", () => {
  it("matches on a shared source/destination IP (case-insensitive)", () => {
    const refs = { srcIps: ["185.220.101.34"], destIps: ["10.0.20.15"] };
    expect(refsIntersect(refs, { ips: ["10.0.20.15"], signatures: [] })).toBe(true);
    expect(refsIntersect(refs, { ips: ["185.220.101.34"], signatures: [] })).toBe(true);
  });

  it("matches signatures either-direction substring", () => {
    const refs = { signatures: ["ET SCAN Suspicious inbound to mySQL port 3306"] };
    expect(refsIntersect(refs, { ips: [], signatures: ["ET SCAN Suspicious inbound to mySQL port 3306"] })).toBe(true);
    expect(refsIntersect(refs, { ips: [], signatures: ["mySQL port 3306"] })).toBe(true);
  });

  it("returns false with no refs or no overlap", () => {
    expect(refsIntersect(null, { ips: ["1.1.1.1"], signatures: [] })).toBe(false);
    expect(refsIntersect({ srcIps: ["1.1.1.1"] }, { ips: ["2.2.2.2"], signatures: [] })).toBe(false);
  });
});

describe("selectRelated", () => {
  const pool: TicketRowInput[] = [
    ticket({ id: "match-ip", sourceRefs: { srcIps: ["185.220.101.34"] } }),
    ticket({ id: "open-context", status: "OPEN", sourceRefs: { srcIps: ["9.9.9.9"] } }),
    ticket({ id: "closed-nocontext", status: "CLOSED", sourceRefs: { srcIps: ["8.8.8.8"] } }),
    ticket({ id: "match-sig", sourceRefs: { signatures: ["ET SCAN mySQL"] } }),
  ];

  it("puts ref-intersecting tickets first, then recent OPEN tickets as context", () => {
    const rows = selectRelated(pool, { ips: ["185.220.101.34"], signatures: ["ET SCAN mySQL"] }, 10);
    const ids = rows.map((r) => r.id);
    // both matches come before the open context, and the closed non-match is excluded
    expect(ids.slice(0, 2).sort()).toEqual(["match-ip", "match-sig"]);
    expect(ids).toContain("open-context");
    expect(ids).not.toContain("closed-nocontext");
    expect(rows.find((r) => r.id === "match-ip")?.matched).toBe(true);
    expect(rows.find((r) => r.id === "open-context")?.matched).toBe(false);
  });

  it("respects the limit", () => {
    const rows = selectRelated(pool, { ips: ["185.220.101.34"], signatures: [] }, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("match-ip");
  });
});

describe("toRelatedRow", () => {
  it("truncates long summaries and serializes lastSeenAt", () => {
    const row = toRelatedRow(ticket({ summary: "x".repeat(500) }), true);
    expect(row.summary.endsWith("…")).toBe(true);
    expect(row.summary.length).toBeLessThan(500);
    expect(row.lastSeenAt).toBe("2026-07-17T10:00:00.000Z");
    expect(row.matched).toBe(true);
  });
});

describe("summarizeRelated", () => {
  it("renders compact one-liners with refs and a match tag", () => {
    const rows = selectRelated(
      [ticket({ id: "match-ip", sourceRefs: { srcIps: ["185.220.101.34"] } })],
      { ips: ["185.220.101.34"], signatures: [] },
      5,
    );
    const text = summarizeRelated(rows);
    expect(text).toContain("[HIGH/OPEN]");
    expect(text).toContain("shared indicator");
    expect(text).toContain("185.220.101.34");
  });

  it("is empty when there is nothing to correlate", () => {
    expect(summarizeRelated([])).toBe("");
  });
});
