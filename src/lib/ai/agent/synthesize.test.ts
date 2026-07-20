import { describe, it, expect } from "vitest";
import { synthesizeReport, type RawToolResult, type SynthesisInput } from "@/lib/ai/agent/synthesize";
import type { AgentToolCall } from "@/lib/ai/agent/contract";

/** Realistic tool outputs like the ones the research tools return. */
function externalIpResults(ip: string): RawToolResult[] {
  return [
    {
      name: "lookup_ip_identity",
      args: { ip },
      output: { ip, scope: "external", identity: null, network: null, vlanId: null, vendor: null, internal: false, valid: true },
    },
    {
      name: "query_logs",
      args: { term: ip, hours: 24 },
      output: {
        term: ip,
        totalMatches: 47,
        signatures: [{ value: "ET SCAN Suspicious inbound to mySQL port 3306", count: 47 }],
        topPorts: [{ value: "3306", count: 47 }],
        topEventTypes: [{ value: "alert", count: 47 }],
      },
    },
    {
      name: "check_threat_intel",
      args: { indicator: ip },
      output: { indicator: ip, isKnownIoc: true, pulses: ["Tor Exit Nodes", "Mass Scanner Blocklist"] },
    },
    {
      name: "whois_asn",
      args: { ip },
      output: { ip, org: "EXAMPLE-ISP", asn: "AS64500", country: "US", summary: "EXAMPLE-ISP (AS64500, US)" },
    },
    {
      name: "reverse_dns",
      args: { ip },
      output: { ip, hostname: "scanner.example-isp.net" },
    },
    {
      name: "ip_reputation",
      args: { ip },
      output: { ip, configured: true, reputation: { score: 100, totalReports: 42, flagged: true, summary: "AbuseIPDB 100%, 42 reports" } },
    },
  ];
}

const toolCalls: AgentToolCall[] = [
  { id: "1", kind: "lookup_ip_identity", name: "lookup_ip_identity", args: { ip: "185.220.101.34" }, label: "x", status: "success" },
];

function baseInput(overrides: Partial<SynthesisInput> = {}): SynthesisInput {
  return {
    ips: ["185.220.101.34"],
    results: externalIpResults("185.220.101.34"),
    toolCalls,
    partialText: "",
    model: "test-model",
    externalSourcesUsed: ["reverse-dns", "rdap", "abuseipdb"],
    ...overrides,
  };
}

describe("synthesizeReport", () => {
  it("extracts rich per-IP findings from tool outputs", () => {
    const report = synthesizeReport(baseInput());
    expect(report.ips).toHaveLength(1);
    const f = report.ips[0];
    expect(f.ip).toBe("185.220.101.34");
    expect(f.scope).toBe("external");
    expect(f.reverseDns).toBe("scanner.example-isp.net");
    expect(f.asn).toBe("EXAMPLE-ISP (AS64500, US)");
    expect(f.reputation).toContain("known IOC");
    expect(f.reputation).toContain("Tor Exit Nodes");
    expect(f.reputation).toContain("AbuseIPDB 100%");
    expect(f.activity).toContain("47 log events");
    expect(f.activity).toContain("ET SCAN Suspicious inbound to mySQL port 3306");
  });

  it("raises the verdict to suspicious on a hard threat signal, with lowered confidence", () => {
    const report = synthesizeReport(baseInput());
    expect(report.verdict).toBe("suspicious");
    expect(report.confidence).toBeLessThanOrEqual(50); // deliberately lowered vs a full model report
    expect(report.confidence).toBeGreaterThan(0);
    // A suspicious external IP earns a block step that changes infra state.
    expect(report.resolution.some((s) => s.changesState)).toBe(true);
  });

  it("defaults to inconclusive when nothing flags", () => {
    const results: RawToolResult[] = [
      {
        name: "lookup_ip_identity",
        args: { ip: "10.0.20.15" },
        output: { ip: "10.0.20.15", scope: "internal", identity: "db01 (VM)", internal: true, valid: true },
      },
      { name: "query_logs", args: { term: "10.0.20.15" }, output: { totalMatches: 0, signatures: [] } },
    ];
    const report = synthesizeReport(baseInput({ ips: ["10.0.20.15"], results }));
    expect(report.verdict).toBe("inconclusive");
    expect(report.ips[0].identity).toBe("db01 (VM)");
    expect(report.ips[0].scope).toBe("internal");
    expect(report.ips[0].activity).toContain("No matching log events");
  });

  it("always produces at least one resolution step and preserves provenance", () => {
    const report = synthesizeReport(baseInput());
    expect(report.resolution.length).toBeGreaterThanOrEqual(1);
    expect(report.resolution[0].order).toBe(1);
    expect(report.meta.model).toBe("test-model");
    expect(report.meta.toolCalls).toEqual(toolCalls);
    expect(report.meta.externalSourcesUsed).toEqual(["reverse-dns", "rdap", "abuseipdb"]);
    expect(report.summary).toContain("Automated synthesis");
  });

  it("weaves the model's partial narrative into the summary when substantial", () => {
    const narrative =
      "The external address repeatedly probed the exposed MySQL port and matches a known scanner blocklist, so it is very likely hostile reconnaissance.";
    const report = synthesizeReport(baseInput({ partialText: narrative }));
    expect(report.summary.startsWith(narrative)).toBe(true);
    expect(report.summary).toContain("Automated synthesis");
  });

  it("falls back to the address itself for scope when no identity result exists", () => {
    const results: RawToolResult[] = [
      { name: "query_logs", args: { term: "8.8.8.8" }, output: { totalMatches: 3, signatures: [] } },
    ];
    const report = synthesizeReport(baseInput({ ips: ["8.8.8.8"], results }));
    expect(report.ips[0].scope).toBe("external"); // 8.8.8.8 is public
  });

  it("derives IPs from tool args when none are supplied", () => {
    const report = synthesizeReport(baseInput({ ips: [] }));
    expect(report.ips.map((f) => f.ip)).toContain("185.220.101.34");
  });

  it("handles a run that gathered nothing but a narrative", () => {
    const report = synthesizeReport(baseInput({ ips: [], results: [], partialText: "" }));
    expect(report.ips).toHaveLength(0);
    expect(report.verdict).toBe("inconclusive");
    expect(report.resolution.length).toBeGreaterThanOrEqual(1);
  });

  it("tolerates non-object (string) tool outputs without throwing", () => {
    const results: RawToolResult[] = [
      { name: "lookup_ip_identity", args: { ip: "1.2.3.4" }, output: "scope=external" },
    ];
    const report = synthesizeReport(baseInput({ ips: ["1.2.3.4"], results }));
    expect(report.ips[0].ip).toBe("1.2.3.4");
    expect(report.ips[0].scope).toBe("external");
    expect(report.ips[0].identity).toBeNull();
  });
});
