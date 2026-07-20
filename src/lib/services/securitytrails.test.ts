import { describe, expect, it } from "vitest";
import {
  normalizeSecurityTrailsDomain,
  normalizeSecurityTrailsDomainWhois,
  normalizeSecurityTrailsIpWhois,
  normalizeSecurityTrailsSubdomains,
  SECURITYTRAILS_CACHE_TTL_MS,
} from "./securitytrails";

describe("SecurityTrails response normalization", () => {
  it("returns bounded current DNS evidence", () => {
    const result = normalizeSecurityTrailsDomain({
      hostname: "example.com",
      apex_domain: "example.com",
      current_dns: {
        a: { values: [{ ip: "203.0.113.8", first_seen: "2026-01-01", organizations: ["Example Transit"] }] },
        mx: { values: [{ hostname: "mail.example.com", priority: 10 }] },
      },
      computed: { alexa_rank: 42 },
    }, "example.com");

    expect(result).toMatchObject({
      kind: "domain",
      domain: "example.com",
      apexDomain: "example.com",
      records: {
        A: [{ value: "203.0.113.8", organizations: ["Example Transit"] }],
        MX: [{ value: "mail.example.com", priority: 10 }],
      },
    });
  });

  it("expands relative subdomain labels and caps tool output", () => {
    const labels = Array.from({ length: 1_100 }, (_, index) => `host-${index}`);
    const result = normalizeSecurityTrailsSubdomains({ subdomain_count: 1_100, subdomains: labels }, "example.com");
    expect(result.count).toBe(1_100);
    expect(result.subdomains).toHaveLength(1_000);
    expect(result.subdomains[0]).toBe("host-0.example.com");
  });

  it("extracts compact domain and IPv4 WHOIS evidence", () => {
    expect(normalizeSecurityTrailsDomainWhois({ current: {
      registrar: { name: "Example Registrar" },
      name_servers: ["ns1.example.net"],
      registrant_organization: "Example Org",
    } }, "example.com")).toMatchObject({
      whois: { registrar: "Example Registrar", nameservers: ["ns1.example.net"], organization: "Example Org" },
    });
    expect(normalizeSecurityTrailsIpWhois({ current: {
      org: "Example Transit", asn: 64500, cidr: "203.0.113.0/24", country_code: "US",
    } }, "203.0.113.8")).toMatchObject({
      ip: "203.0.113.8", organization: "Example Transit", asn: 64500, network: "203.0.113.0/24", country: "US",
    });
  });

  it("uses a fixed four-day cache lifetime", () => {
    expect(SECURITYTRAILS_CACHE_TTL_MS).toBe(4 * 24 * 60 * 60 * 1_000);
  });
});
