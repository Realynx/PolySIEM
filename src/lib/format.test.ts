import { describe, expect, it } from "vitest";
import { formatBytes, formatRelative } from "./format";

describe("formatBytes", () => {
  it("formats common sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KiB");
    expect(formatBytes(BigInt(8 * 1024 ** 3))).toBe("8.0 GiB");
    expect(formatBytes(1536)).toBe("1.5 KiB");
  });

  it("handles null/undefined/negative", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(-5)).toBe("—");
  });
});

describe("formatRelative", () => {
  it("handles recent and null values", () => {
    expect(formatRelative(null)).toBe("never");
    expect(formatRelative(new Date())).toBe("just now");
    expect(formatRelative(new Date(Date.now() - 5 * 60_000))).toBe("5m ago");
    expect(formatRelative(new Date(Date.now() - 3 * 3600_000))).toBe("3h ago");
  });
});
