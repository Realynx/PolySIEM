import { describe, expect, it } from "vitest";
import {
  ES_ABSENCE_KIND,
  ES_MATCH_KIND,
  ES_METRIC_KIND,
  ES_THRESHOLD_KIND,
  aggregateNumbers,
  compare,
  decideAbsence,
  decideCount,
  decideMetric,
  esMatchConfigSchema,
  esMetricConfigSchema,
  isCursorKind,
  isEsTriggerKind,
  windowStart,
} from "./es-trigger-logic";

const NOW = new Date("2026-07-19T12:00:00.000Z");

describe("kind helpers", () => {
  it("recognises the four Elasticsearch trigger kinds", () => {
    for (const kind of [ES_MATCH_KIND, ES_ABSENCE_KIND, ES_THRESHOLD_KIND, ES_METRIC_KIND]) {
      expect(isEsTriggerKind(kind)).toBe(true);
    }
    expect(isEsTriggerKind("trigger.manual")).toBe(false);
    expect(isEsTriggerKind("logs.search")).toBe(false);
  });

  it("marks only the count-based kinds as cursor based", () => {
    expect(isCursorKind(ES_MATCH_KIND)).toBe(true);
    expect(isCursorKind(ES_THRESHOLD_KIND)).toBe(true);
    expect(isCursorKind(ES_ABSENCE_KIND)).toBe(false);
    expect(isCursorKind(ES_METRIC_KIND)).toBe(false);
  });
});

describe("windowStart", () => {
  it("uses the plain window when there is no cursor", () => {
    expect(windowStart(ES_MATCH_KIND, {}, 15, NOW).toISOString()).toBe("2026-07-19T11:45:00.000Z");
  });

  it("resumes just after a cursor inside the window, so the last entry cannot re-fire", () => {
    // +1ms: the range filter's lower bound is inclusive, so resuming *at* the
    // cursor would match the already-consumed document again.
    const state = { cursorTs: "2026-07-19T11:52:00.000Z" };
    expect(windowStart(ES_MATCH_KIND, state, 15, NOW).toISOString()).toBe("2026-07-19T11:52:00.001Z");
  });

  it("clamps an old cursor to the window so a restart cannot replay history", () => {
    const state = { cursorTs: "2026-07-01T00:00:00.000Z" };
    expect(windowStart(ES_MATCH_KIND, state, 15, NOW).toISOString()).toBe("2026-07-19T11:45:00.000Z");
  });

  it("ignores the cursor for edge-triggered kinds — they describe the whole window", () => {
    const state = { cursorTs: "2026-07-19T11:52:00.000Z" };
    expect(windowStart(ES_ABSENCE_KIND, state, 15, NOW).toISOString()).toBe("2026-07-19T11:45:00.000Z");
    expect(windowStart(ES_METRIC_KIND, state, 15, NOW).toISOString()).toBe("2026-07-19T11:45:00.000Z");
  });

  it("survives a corrupt cursor", () => {
    const state = { cursorTs: "not-a-date" };
    expect(windowStart(ES_MATCH_KIND, state, 15, NOW).toISOString()).toBe("2026-07-19T11:45:00.000Z");
  });
});

describe("decideCount", () => {
  const newestTs = "2026-07-19T11:59:00.000Z";

  it("fires and advances the cursor when the count is reached", () => {
    const d = decideCount({ count: 3, required: 1, newestTs, state: {} });
    expect(d.fired).toBe(true);
    expect(d.nextState.cursorTs).toBe(newestTs);
  });

  it("does not advance the cursor when short of the requirement, so hits accumulate", () => {
    const state = { cursorTs: "2026-07-19T11:50:00.000Z" };
    const d = decideCount({ count: 2, required: 5, newestTs, state });
    expect(d.fired).toBe(false);
    expect(d.nextState.cursorTs).toBe("2026-07-19T11:50:00.000Z");
  });

  it("does not fire on zero matches", () => {
    expect(decideCount({ count: 0, required: 1, newestTs: null, state: {} }).fired).toBe(false);
  });

  it("re-firing is impossible for documents already behind the cursor", () => {
    // First evaluation consumes the batch...
    const first = decideCount({ count: 4, required: 1, newestTs, state: {} });
    expect(first.fired).toBe(true);
    // ...and a later evaluation over a window starting at the cursor sees none.
    const second = decideCount({ count: 0, required: 1, newestTs: null, state: first.nextState });
    expect(second.fired).toBe(false);
    expect(second.nextState.cursorTs).toBe(newestTs);
  });
});

describe("decideAbsence", () => {
  it("fires when the window falls silent", () => {
    const d = decideAbsence({ count: 0, state: { breaching: false } });
    expect(d.fired).toBe(true);
    expect(d.nextState.breaching).toBe(true);
  });

  it("fires on a first-ever evaluation that is already silent", () => {
    expect(decideAbsence({ count: 0, state: {} }).fired).toBe(true);
  });

  it("stays quiet while the silence continues", () => {
    const d = decideAbsence({ count: 0, state: { breaching: true } });
    expect(d.fired).toBe(false);
    expect(d.nextState.breaching).toBe(true);
  });

  it("re-arms once logs return, then fires again on the next outage", () => {
    const recovered = decideAbsence({ count: 7, state: { breaching: true } });
    expect(recovered.fired).toBe(false);
    expect(recovered.nextState.breaching).toBe(false);
    expect(decideAbsence({ count: 0, state: recovered.nextState }).fired).toBe(true);
  });
});

describe("decideMetric", () => {
  it("fires on the transition into breach", () => {
    const d = decideMetric({ value: 2500, comparison: "gt", threshold: 2000, state: {} });
    expect(d.fired).toBe(true);
    expect(d.nextState.breaching).toBe(true);
  });

  it("does not re-fire while still breaching", () => {
    const d = decideMetric({ value: 2500, comparison: "gt", threshold: 2000, state: { breaching: true } });
    expect(d.fired).toBe(false);
  });

  it("re-arms when the value recovers", () => {
    const d = decideMetric({ value: 100, comparison: "gt", threshold: 2000, state: { breaching: true } });
    expect(d.fired).toBe(false);
    expect(d.nextState.breaching).toBe(false);
  });

  it("treats a missing reading as no evidence and preserves the previous state", () => {
    const d = decideMetric({ value: null, comparison: "gt", threshold: 2000, state: { breaching: true } });
    expect(d.fired).toBe(false);
    expect(d.nextState.breaching).toBe(true);
  });

  it("supports every comparison", () => {
    expect(compare(5, "gt", 4)).toBe(true);
    expect(compare(4, "gt", 4)).toBe(false);
    expect(compare(4, "gte", 4)).toBe(true);
    expect(compare(3, "lt", 4)).toBe(true);
    expect(compare(4, "lte", 4)).toBe(true);
  });
});

describe("aggregateNumbers", () => {
  it("computes each aggregation", () => {
    const values = [10, 20, 60];
    expect(aggregateNumbers(values, "avg")).toBe(30);
    expect(aggregateNumbers(values, "sum")).toBe(90);
    expect(aggregateNumbers(values, "max")).toBe(60);
    expect(aggregateNumbers(values, "min")).toBe(10);
  });

  it("returns null for no readings rather than a misleading zero", () => {
    expect(aggregateNumbers([], "avg")).toBeNull();
    expect(aggregateNumbers([], "sum")).toBeNull();
  });

  it("handles negatives and a single reading", () => {
    expect(aggregateNumbers([-5, 5], "avg")).toBe(0);
    expect(aggregateNumbers([-5, -1], "max")).toBe(-1);
    expect(aggregateNumbers([42], "avg")).toBe(42);
  });
});

describe("config schemas", () => {
  it("applies window and count defaults", () => {
    const parsed = esMatchConfigSchema.parse({});
    expect(parsed.windowMinutes).toBe(15);
    expect(parsed.minCount).toBe(1);
    expect(parsed.level).toBe("any");
    expect(parsed.params).toEqual([]);
  });

  it("coerces the numeric strings a form sends", () => {
    const parsed = esMatchConfigSchema.parse({ windowMinutes: "30", minCount: "5" });
    expect(parsed.windowMinutes).toBe(30);
    expect(parsed.minCount).toBe(5);
  });

  it("rejects an out-of-range window", () => {
    expect(() => esMatchConfigSchema.parse({ windowMinutes: 0 })).toThrow();
    expect(() => esMatchConfigSchema.parse({ windowMinutes: 5000 })).toThrow();
  });

  it("requires a field for the metric trigger", () => {
    expect(() => esMetricConfigSchema.parse({})).toThrow();
    expect(esMetricConfigSchema.parse({ field: "http.duration" }).aggregation).toBe("avg");
  });
});
