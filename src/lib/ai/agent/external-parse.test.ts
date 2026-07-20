import { describe, it, expect } from "vitest";
import {
  parseAbuseIpdb,
  parseRdap,
  pickPtr,
  type AbuseIpdbResponse,
  type RdapResponse,
} from "@/lib/ai/agent/external-parse";

describe("pickPtr", () => {
  it("returns the first hostname and strips a trailing dot", () => {
    expect(pickPtr(["one.dns.example.com.", "two.example.com"])).toBe("one.dns.example.com");
  });

  it("skips blank entries", () => {
    expect(pickPtr(["", "  ", "real.host"])).toBe("real.host");
  });

  it("returns null when nothing resolves", () => {
    expect(pickPtr([])).toBeNull();
  });
});

describe("parseRdap", () => {
  const cloudflareLike: RdapResponse = {
    handle: "1.1.1.0 - 1.1.1.255",
    startAddress: "1.1.1.0",
    endAddress: "1.1.1.255",
    name: "APNIC-LABS",
    country: "AU",
    arin_originas0_originautnums: [13335],
    entities: [
      {
        handle: "AR302-AP",
        roles: ["registrant"],
        vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "APNIC Research and Development"]]],
      },
    ],
  };

  it("extracts org, ASN, and country", () => {
    const info = parseRdap(cloudflareLike);
    expect(info.org).toBe("APNIC Research and Development");
    expect(info.asn).toBe("AS13335");
    expect(info.country).toBe("AU");
    expect(info.summary).toContain("APNIC Research and Development");
    expect(info.summary).toContain("AS13335");
    expect(info.summary).toContain("AU");
  });

  it("falls back to the network name when no entity has a full name", () => {
    const info = parseRdap({ name: "PRIVATE-NET", country: "US" });
    expect(info.org).toBe("PRIVATE-NET");
    expect(info.asn).toBeNull();
    expect(info.summary).toContain("US");
  });

  it("returns nulls for an empty response", () => {
    const info = parseRdap({});
    expect(info.org).toBeNull();
    expect(info.summary).toBeNull();
  });

  it("prefers a registrant/admin entity name over an unrelated one", () => {
    const res: RdapResponse = {
      name: "NET-BLOCK",
      entities: [
        { roles: ["technical"], vcardArray: ["vcard", [["fn", {}, "text", "Tech Contact"]]] },
        { roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", "Registrant Org"]]] },
      ],
    };
    expect(parseRdap(res).org).toBe("Registrant Org");
  });
});

describe("parseAbuseIpdb", () => {
  it("summarizes a flagged IP", () => {
    const res: AbuseIpdbResponse = {
      data: { abuseConfidenceScore: 100, totalReports: 42, usageType: "Data Center/Web Hosting/Transit" },
    };
    const info = parseAbuseIpdb(res);
    expect(info.score).toBe(100);
    expect(info.totalReports).toBe(42);
    expect(info.flagged).toBe(true);
    expect(info.summary).toContain("100%");
    expect(info.summary).toContain("42 reports");
  });

  it("does not flag a clean IP below threshold", () => {
    const info = parseAbuseIpdb({ data: { abuseConfidenceScore: 0, totalReports: 0 } });
    expect(info.flagged).toBe(false);
  });

  it("handles a missing score gracefully", () => {
    const info = parseAbuseIpdb({ data: {} });
    expect(info.score).toBeNull();
    expect(info.flagged).toBe(false);
    expect(info.summary).toContain("no confidence score");
  });
});
