import { describe, expect, it } from "vitest";
import { decideUpsert, EVIDENCE_SAMPLE_CAP, isMoreSevere, mergeEvidence, planFinding } from "./policy";

describe("decideUpsert", () => {
  it("creates when no ticket matches the dedupe key", () => {
    expect(decideUpsert(null)).toBe("create");
  });

  it("bumps an open ticket", () => {
    expect(decideUpsert({ status: "OPEN" })).toBe("bump");
  });

  it("always suppresses a closed ticket — never reopens", () => {
    // Regardless of how long ago it was closed, a closed ticket stays closed.
    expect(decideUpsert({ status: "CLOSED" })).toBe("suppress");
  });
});

describe("planFinding", () => {
  it("creates when neither a match nor a dedupe ticket exists", () => {
    expect(planFinding(null, null)).toBe("create");
  });

  it("attaches to an explicitly matched OPEN ticket", () => {
    expect(planFinding({ status: "OPEN" }, null)).toBe("attach-open");
  });

  it("attaches to an explicitly matched CLOSED ticket WITHOUT reopening", () => {
    expect(planFinding({ status: "CLOSED" }, null)).toBe("attach-closed");
  });

  it("prefers the explicit match over the mechanical dedupe ticket", () => {
    // Matched closed wins even when the dedupe ticket is open — no duplicate, no reopen.
    expect(planFinding({ status: "CLOSED" }, { status: "OPEN" })).toBe("attach-closed");
    expect(planFinding({ status: "OPEN" }, { status: "CLOSED" })).toBe("attach-open");
  });

  it("falls back to the dedupe ticket when there is no explicit match", () => {
    expect(planFinding(null, { status: "OPEN" })).toBe("attach-open");
    expect(planFinding(null, { status: "CLOSED" })).toBe("suppress");
  });

  it("never produces a reopen for any input combination", () => {
    const states: Array<{ status: "OPEN" | "CLOSED" } | null> = [null, { status: "OPEN" }, { status: "CLOSED" }];
    for (const matched of states) {
      for (const dedupe of states) {
        expect(["create", "attach-open", "attach-closed", "suppress"]).toContain(planFinding(matched, dedupe));
      }
    }
  });
});

describe("isMoreSevere", () => {
  it("is true only when the incoming severity outranks the current one", () => {
    expect(isMoreSevere("CRITICAL", "HIGH")).toBe(true);
    expect(isMoreSevere("HIGH", "HIGH")).toBe(false);
    expect(isMoreSevere("LOW", "MEDIUM")).toBe(false);
    expect(isMoreSevere("MEDIUM", "INFO")).toBe(true);
  });
});

describe("mergeEvidence", () => {
  const sample = (n: number) => ({ timestamp: `2026-07-17T10:0${n % 10}:00Z`, message: `event ${n}` });

  it("prepends incoming samples to existing ones", () => {
    const merged = mergeEvidence(
      { samples: [sample(1)], scope: "suricata" },
      { samples: [sample(2)], scope: "suricata" },
    );
    expect(merged.samples.map((s) => s.message)).toEqual(["event 2", "event 1"]);
  });

  it("caps the merged sample list", () => {
    const existing = { samples: Array.from({ length: 30 }, (_, i) => sample(i)) };
    const merged = mergeEvidence(existing, { samples: [sample(99)] });
    expect(merged.samples).toHaveLength(EVIDENCE_SAMPLE_CAP);
    expect(merged.samples[0].message).toBe("event 99");
  });

  it("handles a ticket with no prior evidence", () => {
    expect(mergeEvidence(null, { samples: [sample(1)] }).samples).toHaveLength(1);
  });
});
