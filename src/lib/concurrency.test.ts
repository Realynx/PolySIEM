import { describe, expect, it } from "vitest";
import { runWithConcurrency } from "./concurrency";

describe("runWithConcurrency", () => {
  it("never exceeds the configured number of workers", async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];

    await runWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      seen.push(value);
      active -= 1;
    });

    expect(peak).toBe(2);
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("falls back to one worker for an invalid concurrency value", async () => {
    let active = 0;
    let peak = 0;

    await runWithConcurrency([1, 2, 3], Number.NaN, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
    });

    expect(peak).toBe(1);
  });

  it("handles an empty input without invoking the worker", async () => {
    let calls = 0;

    await runWithConcurrency([], 4, () => {
      calls += 1;
      return Promise.resolve();
    });

    expect(calls).toBe(0);
  });
});
