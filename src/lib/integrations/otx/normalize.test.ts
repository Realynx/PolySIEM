import { describe, expect, it } from "vitest";
import { extractIpIocs, isPublicIpv4, normalizeIndicators, toPulseView, toUtcIso } from "./normalize";
import type { PulseIndicatorView } from "@/lib/types";

describe("toPulseView", () => {
  it("normalizes a full raw pulse", () => {
    const view = toPulseView({
      id: "abc123",
      name: "Test pulse",
      description: " desc ",
      author_name: "AlienVault",
      created: "2026-07-16T00:00:00Z",
      modified: "2026-07-17T00:00:00Z",
      tlp: "WHITE",
      adversary: "",
      tags: ["tor", " scanner "],
      targeted_countries: ["Germany"],
      malware_families: ["Mirai"],
      attack_ids: ["T1046"],
      references: ["https://example.com"],
      indicators: [
        { indicator: "1.2.3.4", type: "IPv4", description: "" },
        { indicator: "evil.example", type: "domain", description: "c2" },
        { indicator: "5.6.7.8", type: "IPv4" },
      ],
    });
    expect(view).not.toBeNull();
    expect(view!.tlp).toBe("white");
    expect(view!.adversary).toBeNull();
    expect(view!.indicatorCount).toBe(3);
    expect(view!.indicatorTypeCounts).toEqual([
      { type: "IPv4", count: 2 },
      { type: "domain", count: 1 },
    ]);
    expect(view!.url).toBe("https://otx.alienvault.com/pulse/abc123");
    expect(view!.indicators[1].description).toBe("c2");
  });

  it("accepts object-shaped list fields (malware_families as {display_name})", () => {
    const view = toPulseView({
      id: "x",
      name: "y",
      malware_families: [{ display_name: "AsyncRAT" }, { id: "trojan/Generic" }],
      attack_ids: [{ name: "T1566" }],
    });
    expect(view!.malwareFamilies).toEqual(["AsyncRAT", "trojan/Generic"]);
    expect(view!.attackIds).toEqual(["T1566"]);
  });

  it("returns null for pulses without id or name", () => {
    expect(toPulseView({ id: "", name: "n" })).toBeNull();
    expect(toPulseView({ id: "i" })).toBeNull();
  });

  it("stamps naive-UTC OTX datetimes with a Z suffix", () => {
    expect(toUtcIso("2026-07-17T20:00:00.123000")).toBe("2026-07-17T20:00:00.123000Z");
    expect(toUtcIso("2026-07-17T20:00:00")).toBe("2026-07-17T20:00:00Z");
    expect(toUtcIso("2026-07-17T20:00:00Z")).toBe("2026-07-17T20:00:00Z");
    expect(toUtcIso("2026-07-17T20:00:00+02:00")).toBe("2026-07-17T20:00:00+02:00");
    const view = toPulseView({ id: "x", name: "y", modified: "2026-07-17T20:00:00.123000" });
    expect(view!.modified).toBe("2026-07-17T20:00:00.123000Z");
  });

  it("survives malformed indicator entries", () => {
    expect(normalizeIndicators([null, "str", { indicator: "" }, { indicator: "ok", type: 5 }])).toEqual([
      { indicator: "ok", type: "unknown", description: null },
    ]);
    expect(normalizeIndicators(undefined)).toEqual([]);
  });
});

describe("isPublicIpv4", () => {
  it("accepts routable addresses", () => {
    expect(isPublicIpv4("185.220.101.34")).toBe(true);
    expect(isPublicIpv4("8.8.8.8")).toBe(true);
  });

  it("rejects private, loopback, CGNAT, documentation and multicast ranges", () => {
    for (const ip of [
      "10.1.2.3",
      "172.16.0.9",
      "172.31.255.1",
      "192.168.1.1",
      "127.0.0.1",
      "169.254.10.10",
      "100.64.0.1",
      "192.0.2.55",
      "198.51.100.7",
      "203.0.113.9",
      "224.0.0.5",
      "255.255.255.255",
      "0.0.0.0",
    ]) {
      expect(isPublicIpv4(ip), ip).toBe(false);
    }
  });

  it("rejects non-IPv4 strings", () => {
    expect(isPublicIpv4("evil.example")).toBe(false);
    expect(isPublicIpv4("2001:db8::1")).toBe(false);
    expect(isPublicIpv4("1.2.3.999")).toBe(false);
  });
});

describe("extractIpIocs", () => {
  const ind = (indicator: string, type = "IPv4"): PulseIndicatorView => ({ indicator, type, description: null });

  it("dedupes across pulses and records every referencing pulse", () => {
    const iocs = extractIpIocs([
      { id: "p1", name: "one", indicators: [ind("185.220.101.34"), ind("10.0.0.1"), ind("evil.example", "domain")] },
      { id: "p2", name: "two", indicators: [ind("185.220.101.34"), ind("91.92.240.116")] },
    ]);
    expect(iocs).toHaveLength(2);
    const tor = iocs.find((i) => i.indicator === "185.220.101.34")!;
    expect(tor.pulses.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("keeps the earliest (freshest) IOCs when over the cap", () => {
    const many = Array.from({ length: 10 }, (_, i) => ind(`93.184.216.${i + 1}`));
    const iocs = extractIpIocs([{ id: "p", name: "n", indicators: many }], 3);
    expect(iocs.map((i) => i.indicator)).toEqual(["93.184.216.1", "93.184.216.2", "93.184.216.3"]);
  });

  it("does not double-count a pulse listing the same IP twice", () => {
    const iocs = extractIpIocs([
      { id: "p1", name: "one", indicators: [ind("8.8.8.8"), ind("8.8.8.8")] },
    ]);
    expect(iocs[0].pulses).toHaveLength(1);
  });
});
