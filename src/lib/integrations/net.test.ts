import { describe, expect, it } from "vitest";
import { ipInCidr, pickNetworkForIp } from "./net";

describe("ipInCidr", () => {
  it("matches addresses inside the block", () => {
    expect(ipInCidr("10.0.10.53", "10.0.10.0/24")).toBe(true);
    expect(ipInCidr("10.0.11.53", "10.0.10.0/24")).toBe(false);
    expect(ipInCidr("192.168.1.1", "192.168.0.0/16")).toBe(true);
    expect(ipInCidr("10.0.10.7", "10.0.10.4/30")).toBe(true);
    expect(ipInCidr("10.0.10.8", "10.0.10.4/30")).toBe(false);
  });

  it("handles /0 and /32", () => {
    expect(ipInCidr("1.2.3.4", "0.0.0.0/0")).toBe(true);
    expect(ipInCidr("1.2.3.4", "1.2.3.4/32")).toBe(true);
    expect(ipInCidr("1.2.3.5", "1.2.3.4/32")).toBe(false);
  });

  it("rejects garbage without throwing", () => {
    expect(ipInCidr("not-an-ip", "10.0.0.0/24")).toBe(false);
    expect(ipInCidr("10.0.0.1", "garbage")).toBe(false);
  });
});

describe("pickNetworkForIp", () => {
  it("prefers the longest matching prefix", () => {
    const nets = [
      { id: "wide", cidr: "10.0.0.0/8" },
      { id: "narrow", cidr: "10.0.10.0/24" },
      { id: "no-cidr", cidr: null },
    ];
    expect(pickNetworkForIp("10.0.10.5", nets)).toBe("narrow");
    expect(pickNetworkForIp("10.9.9.9", nets)).toBe("wide");
    expect(pickNetworkForIp("172.16.0.1", nets)).toBeNull();
    expect(pickNetworkForIp(null, nets)).toBeNull();
  });
});
