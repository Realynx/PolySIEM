import { describe, expect, it } from "vitest";
import { deleteWithConcurrency } from "./index";

describe("deleteWithConcurrency", () => {
  it("bounds requests and counts only successful deletions", async () => {
    let active = 0;
    let peak = 0;
    const deleted = await deleteWithConcurrency(["a", "b", "c", "d", "e"], async (key) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (key === "c") throw new Error("provider failure");
    }, 2);
    expect(peak).toBe(2);
    expect(deleted).toBe(4);
  });

  it("falls back to one request for an invalid concurrency value", async () => {
    let active = 0;
    let peak = 0;
    await deleteWithConcurrency(["a", "b", "c"], async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
    }, Number.NaN);
    expect(peak).toBe(1);
  });
});
