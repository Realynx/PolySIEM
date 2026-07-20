import { describe, expect, it } from "vitest";
import { CENSYS_CACHE_TTL_MS, normalizeCensysHost } from "./censys";

describe("Censys host normalization", () => {
  it("returns bounded ownership, DNS, location and service evidence", () => {
    const host = normalizeCensysHost({
      result: {
        resource: {
          ip: "203.0.113.8",
          autonomous_system: { asn: 64500, name: "Example Transit", country_code: "US" },
          whois: { network: { cidr: "203.0.113.0/24", name: "EXAMPLE-NET" } },
          location: { city: "Ashburn", province: "Virginia", country: "United States" },
          dns: { names: ["edge.example.com"] },
          service_count: 1,
          services: [{
            port: 443,
            transport_protocol: "TCP",
            service_name: "HTTP",
            software: [{ vendor: "nginx", product: "nginx", version: "1.27" }],
          }],
        },
      },
    });

    expect(host).toMatchObject({
      ip: "203.0.113.8",
      ownership: { organization: "Example Transit", asn: 64500, network: "203.0.113.0/24" },
      location: { city: "Ashburn", region: "Virginia" },
      dnsNames: ["edge.example.com"],
      serviceCount: 1,
      services: [{ port: 443, transport: "TCP", protocol: "HTTP" }],
    });
  });

  it("uses a fixed four-day cache lifetime", () => {
    expect(CENSYS_CACHE_TTL_MS).toBe(4 * 24 * 60 * 60 * 1_000);
  });
});
