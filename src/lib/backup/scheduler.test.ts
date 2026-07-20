import { describe, expect, it } from "vitest";
import { isBackupDue } from "./scheduler";

const NOW = new Date("2026-07-17T12:00:00.000Z");

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60_000);
}

describe("isBackupDue", () => {
  it("is never due when the schedule is off", () => {
    expect(isBackupDue(null, "off", NOW)).toBe(false);
    expect(isBackupDue(hoursAgo(1000), "off", NOW)).toBe(false);
  });

  it("is due when a daily/weekly schedule has never run", () => {
    expect(isBackupDue(null, "daily", NOW)).toBe(true);
    expect(isBackupDue(null, "weekly", NOW)).toBe(true);
  });

  it("respects the daily interval", () => {
    expect(isBackupDue(hoursAgo(23), "daily", NOW)).toBe(false);
    expect(isBackupDue(hoursAgo(24), "daily", NOW)).toBe(true);
    expect(isBackupDue(hoursAgo(25), "daily", NOW)).toBe(true);
  });

  it("respects the weekly interval", () => {
    expect(isBackupDue(hoursAgo(24 * 6), "weekly", NOW)).toBe(false);
    expect(isBackupDue(hoursAgo(24 * 7), "weekly", NOW)).toBe(true);
  });

  it("treats a last run in the future (clock skew) as not due", () => {
    expect(isBackupDue(hoursAgo(-5), "daily", NOW)).toBe(false);
  });
});
