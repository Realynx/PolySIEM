import { describe, expect, it } from "vitest";
import type { PulseView } from "@/lib/types";
import { withThreatIntelReadState } from "./read-state";

function pulse(id: string, modified: string): PulseView {
  return {
    id,
    name: `Report ${id}`,
    description: "",
    author: "OTX",
    created: modified,
    modified,
    tlp: "white",
    adversary: null,
    tags: [],
    targetedCountries: [],
    malwareFamilies: [],
    attackIds: [],
    references: [],
    indicatorCount: 0,
    indicatorTypeCounts: [],
    indicators: [],
    url: `https://otx.example/${id}`,
  };
}

describe("withThreatIntelReadState", () => {
  it("marks reports without a receipt unread", () => {
    expect(withThreatIntelReadState([pulse("a", "2026-07-20T10:00:00Z")], new Map())[0]?.readAt).toBeNull();
  });

  it("keeps a report read when its receipt is newer than its last update", () => {
    const readAt = "2026-07-20T11:00:00Z";
    expect(
      withThreatIntelReadState(
        [pulse("a", "2026-07-20T10:00:00Z")],
        new Map([["a", readAt]]),
      )[0]?.readAt,
    ).toBe(readAt);
  });

  it("makes a report unread again when OTX updates it after it was read", () => {
    expect(
      withThreatIntelReadState(
        [pulse("a", "2026-07-20T12:00:00Z")],
        new Map([["a", "2026-07-20T11:00:00Z"]]),
      )[0]?.readAt,
    ).toBeNull();
  });
});
