import { describe, expect, it } from "vitest";
import {
  esTriggerNodes,
  isDue,
  scheduleIntervalMinutes,
  securityTrailsTriggerNodes,
  threatTriggerNodes,
} from "./scheduler";
import type { WorkflowGraph } from "./types";

const NOW = new Date("2026-07-17T12:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

describe("isDue", () => {
  it("is due when the workflow has never run", () => {
    expect(isDue(null, 5, NOW)).toBe(true);
  });

  it("is not due before the interval has elapsed", () => {
    expect(isDue(minutesAgo(4), 5, NOW)).toBe(false);
    expect(isDue(minutesAgo(0), 5, NOW)).toBe(false);
  });

  it("is due exactly at and after the interval boundary", () => {
    expect(isDue(minutesAgo(5), 5, NOW)).toBe(true);
    expect(isDue(minutesAgo(6), 5, NOW)).toBe(true);
    expect(isDue(minutesAgo(1440), 1440, NOW)).toBe(true);
  });

  it("handles a last run in the future (clock skew) as not due", () => {
    expect(isDue(minutesAgo(-3), 5, NOW)).toBe(false);
  });
});

function graphWith(config: Record<string, unknown>, kind = "trigger.schedule"): WorkflowGraph {
  return {
    nodes: [{ id: "t", kind, label: null, position: { x: 0, y: 0 }, config }],
    edges: [],
  };
}

describe("scheduleIntervalMinutes", () => {
  it("returns the configured interval", () => {
    expect(scheduleIntervalMinutes(graphWith({ intervalMinutes: 30, params: [] }))).toBe(30);
  });

  it("clamps below 5 and above 1440 minutes", () => {
    expect(scheduleIntervalMinutes(graphWith({ intervalMinutes: 1 }))).toBe(5);
    expect(scheduleIntervalMinutes(graphWith({ intervalMinutes: 99_999 }))).toBe(1440);
  });

  it("rounds fractional intervals", () => {
    expect(scheduleIntervalMinutes(graphWith({ intervalMinutes: 7.4 }))).toBe(7);
  });

  it("returns null without a schedule trigger", () => {
    expect(scheduleIntervalMinutes(graphWith({ params: [] }, "trigger.manual"))).toBeNull();
    expect(scheduleIntervalMinutes({ nodes: [], edges: [] })).toBeNull();
  });

  it("returns null for missing or non-numeric intervals (unconfigured drafts)", () => {
    expect(scheduleIntervalMinutes(graphWith({}))).toBeNull();
    expect(scheduleIntervalMinutes(graphWith({ intervalMinutes: "15" }))).toBeNull();
    expect(scheduleIntervalMinutes(graphWith({ intervalMinutes: NaN }))).toBeNull();
  });
});

describe("threatTriggerNodes", () => {
  const n = (id: string, kind: string) => ({ id, kind, label: null, position: { x: 0, y: 0 }, config: {} });

  it("picks out threat trigger nodes and leaves the others alone", () => {
    const graph = {
      nodes: [
        n("t1", "trigger.manual"),
        n("t2", "trigger.threat-ticket"),
        n("t3", "trigger.es-match"),
        n("t4", "trigger.threat-ticket"),
        n("a", "logs.stats"),
        n("st1", "trigger.securitytrails-lookup-complete"),
        n("st2", "trigger.securitytrails-result-changed"),
      ],
      edges: [],
    };
    expect(threatTriggerNodes(graph).map((x) => x.id)).toEqual(["t2", "t4"]);
    expect(esTriggerNodes(graph).map((x) => x.id)).toEqual(["t3"]);
    expect(securityTrailsTriggerNodes(graph).map((x) => x.id)).toEqual([
      "st1",
      "st2",
    ]);
  });

  it("survives a malformed graph without throwing", () => {
    expect(threatTriggerNodes({} as never)).toEqual([]);
    expect(esTriggerNodes({ nodes: undefined } as never)).toEqual([]);
    expect(securityTrailsTriggerNodes({ nodes: undefined } as never)).toEqual(
      [],
    );
  });
});
