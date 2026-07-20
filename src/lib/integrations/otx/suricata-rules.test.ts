import { describe, expect, it } from "vitest";
import { generateSuricataRules, sanitizeMsg } from "./suricata-rules";
import type { IocCandidate } from "./normalize";

const AT = new Date("2026-07-17T12:00:00Z");

function ioc(indicator: string, pulseId = "p1", pulseName = "Test pulse"): IocCandidate {
  return { indicator, pulses: [{ id: pulseId, name: pulseName }] };
}

describe("sanitizeMsg", () => {
  it("strips quote, semicolon, backslash, pipe and control chars", () => {
    expect(sanitizeMsg('Evil "C2"; drop\\table |now|\x07')).toBe("Evil C2 droptable now");
  });

  it("collapses whitespace and caps length", () => {
    expect(sanitizeMsg("a   b\n\tc")).toBe("a b c");
    expect(sanitizeMsg("x".repeat(300))).toHaveLength(160);
  });
});

describe("generateSuricataRules", () => {
  it("emits inbound+outbound IP rules per pulse and dns rules per domain", () => {
    const result = generateSuricataRules({
      ipIocs: [ioc("1.2.3.4"), ioc("5.6.7.8")],
      domainIocs: [ioc("evil.example", "p2", "Phishing kit")],
      sourceName: "otx-demo",
      generatedAt: AT,
    });
    expect(result.ipRuleCount).toBe(2);
    expect(result.dnsRuleCount).toBe(1);
    expect(result.pulseCount).toBe(1);
    expect(result.text).toContain("alert ip [1.2.3.4,5.6.7.8] any -> $HOME_NET any");
    expect(result.text).toContain("alert ip $HOME_NET any -> [1.2.3.4,5.6.7.8] any");
    expect(result.text).toContain('dns.query; content:"evil.example"; nocase; endswith;');
    expect(result.text).toContain("reference:url,otx.alienvault.com/pulse/p1;");
    expect(result.text).toContain('msg:"PolySIEM OTX inbound: Test pulse"');
  });

  it("is deterministic: same input yields identical text and SIDs", () => {
    const input = {
      ipIocs: [ioc("1.2.3.4"), ioc("5.6.7.8", "p2", "Other")],
      domainIocs: [ioc("bad.example", "p2", "Other")],
      sourceName: "otx",
      generatedAt: AT,
    };
    expect(generateSuricataRules(input).text).toBe(generateSuricataRules(input).text);
  });

  it("keeps SIDs stable for a pulse when unrelated pulses are added", () => {
    const base = generateSuricataRules({
      ipIocs: [ioc("1.2.3.4", "stable-pulse", "Stable")],
      domainIocs: [],
      sourceName: "otx",
      generatedAt: AT,
    });
    const grown = generateSuricataRules({
      ipIocs: [ioc("9.9.9.9", "new-pulse", "New"), ioc("1.2.3.4", "stable-pulse", "Stable")],
      domainIocs: [ioc("x.example", "new-pulse", "New")],
      sourceName: "otx",
      generatedAt: AT,
    });
    const sidOf = (text: string, msg: string) => text.match(new RegExp(`msg:"${msg}"; sid:(\\d+);`))?.[1];
    expect(sidOf(base.text, "PolySIEM OTX inbound: Stable")).toBeDefined();
    expect(sidOf(grown.text, "PolySIEM OTX inbound: Stable")).toBe(sidOf(base.text, "PolySIEM OTX inbound: Stable"));
  });

  it("assigns unique SIDs across all rules", () => {
    const ips = Array.from({ length: 200 }, (_, i) => ioc(`93.184.${Math.floor(i / 250)}.${i % 250}`, `p${i % 7}`, `Pulse ${i % 7}`));
    const result = generateSuricataRules({ ipIocs: ips, domainIocs: [], sourceName: "otx", generatedAt: AT });
    const sids = [...result.text.matchAll(/sid:(\d+);/g)].map((m) => m[1]);
    expect(new Set(sids).size).toBe(sids.length);
    expect(sids.length).toBe(result.ipRuleCount);
  });

  it("chunks big pulses into multiple numbered rules", () => {
    const ips = Array.from({ length: 100 }, (_, i) => ioc(`198.18.${Math.floor(i / 250)}.${i}`, "big", "Big pulse"));
    const result = generateSuricataRules({ ipIocs: ips, domainIocs: [], sourceName: "otx", generatedAt: AT });
    expect(result.ipRuleCount).toBe(4); // 2 chunks × in/out
    expect(result.text).toContain("Big pulse (1/2)");
    expect(result.text).toContain("Big pulse (2/2)");
  });

  it("renders a comment-only file when the feed is empty", () => {
    const result = generateSuricataRules({ ipIocs: [], domainIocs: [], sourceName: "otx", generatedAt: AT });
    expect(result.ipRuleCount).toBe(0);
    expect(result.text).toContain("# No indicators on the feed right now.");
    for (const line of result.text.split("\n")) {
      expect(line === "" || line.startsWith("#")).toBe(true);
    }
  });
});
