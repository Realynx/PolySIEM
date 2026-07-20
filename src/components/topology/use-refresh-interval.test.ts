import { describe, expect, it } from "vitest";
import {
  DEFAULT_REFRESH_MS,
  FOOTPRINT_REFRESH_STORAGE_KEY,
  REFRESH_OPTIONS,
  REFRESH_STORAGE_KEY,
  parseRefreshMs,
} from "./use-refresh-interval";

describe("lab map refresh interval", () => {
  it("defaults to two seconds", () => {
    expect(DEFAULT_REFRESH_MS).toBe(2_000);
    expect(REFRESH_OPTIONS.some((option) => option.ms === DEFAULT_REFRESH_MS)).toBe(true);
  });

  it("restores a previously stored rate", () => {
    for (const option of REFRESH_OPTIONS) {
      expect(parseRefreshMs(String(option.ms))).toBe(option.ms);
    }
  });

  it("falls back to the default for anything it does not offer", () => {
    // Nothing here may reach the poll loop: 0 would busy-loop and a negative
    // or non-numeric value would make setTimeout fire immediately.
    for (const raw of [null, "", "0", "-1", "500", "abc", "NaN", "1e9", "12000"]) {
      expect(parseRefreshMs(raw), `${raw} should fall back`).toBe(DEFAULT_REFRESH_MS);
    }
  });

  it("offers only rates the server can actually deliver", () => {
    // computeMetricsReport coalesces Proxmox calls to one per second, so a
    // faster option would poll for samples that cannot have changed.
    expect(Math.min(...REFRESH_OPTIONS.map((option) => option.ms))).toBeGreaterThanOrEqual(1_000);
  });

  it("keeps rates ascending and labelled", () => {
    const rates = REFRESH_OPTIONS.map((option) => option.ms);
    expect([...rates].sort((a, b) => a - b)).toEqual(rates);
    expect(new Set(rates).size).toBe(rates.length);
    expect(REFRESH_OPTIONS.every((option) => option.label.trim().length > 0)).toBe(true);
  });

  it("keeps LabMap and Footprint choices independently persisted", () => {
    expect(FOOTPRINT_REFRESH_STORAGE_KEY).not.toBe(REFRESH_STORAGE_KEY);
  });
});
