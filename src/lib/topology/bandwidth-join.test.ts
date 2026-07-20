import { describe, expect, it } from "vitest";
import { edgeRateBps, rateStrokeBonus } from "./bandwidth-join";
import { formatBps } from "@/lib/format";

describe("edgeRateBps", () => {
  const rates = new Map<string, number>([
    ["uuid-dns", 81_000],
    ["uuid-web", 4_900_000],
  ]);

  it("sums the rates of an edge's rules by uuid", () => {
    expect(
      edgeRateBps([{ externalId: "uuid-dns" }, { externalId: "uuid-web" }], rates),
    ).toBe(4_981_000);
  });

  it("ignores rules without an externalId (manual rules) and unknown uuids", () => {
    expect(
      edgeRateBps([{ externalId: null }, { externalId: "uuid-unknown" }, { externalId: "uuid-dns" }], rates),
    ).toBe(81_000);
  });

  it("dedupes a uuid appearing twice on one edge", () => {
    expect(edgeRateBps([{ externalId: "uuid-dns" }, { externalId: "uuid-dns" }], rates)).toBe(81_000);
  });

  it("is 0 for no rules or an empty rate map", () => {
    expect(edgeRateBps([], rates)).toBe(0);
    expect(edgeRateBps([{ externalId: "uuid-dns" }], new Map())).toBe(0);
  });
});

describe("rateStrokeBonus", () => {
  it("has exactly two steps", () => {
    expect(rateStrokeBonus(0)).toBe(0);
    expect(rateStrokeBonus(99_999)).toBe(0);
    expect(rateStrokeBonus(100_000)).toBe(0.5);
    expect(rateStrokeBonus(4_999_999)).toBe(0.5);
    expect(rateStrokeBonus(5_000_000)).toBe(1);
    expect(rateStrokeBonus(800_000_000)).toBe(1);
  });
});

describe("formatBps", () => {
  it("uses SI network prefixes", () => {
    expect(formatBps(0)).toBe("0 b/s");
    expect(formatBps(950)).toBe("950 b/s");
    expect(formatBps(81_000)).toBe("81.0 kb/s");
    expect(formatBps(4_200_000)).toBe("4.2 Mb/s");
    expect(formatBps(123_000_000)).toBe("123 Mb/s");
    expect(formatBps(1_500_000_000)).toBe("1.5 Gb/s");
  });

  it("handles nullish and bad input", () => {
    expect(formatBps(null)).toBe("—");
    expect(formatBps(undefined)).toBe("—");
    expect(formatBps(-5)).toBe("—");
    expect(formatBps(Number.NaN)).toBe("—");
  });
});
