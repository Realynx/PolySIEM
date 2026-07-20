import { describe, expect, it } from "vitest";
import {
  classifyResolution,
  ipToBytes,
  isCloudflareIp,
} from "./cloudflare";

describe("ipToBytes", () => {
  it("parses IPv4 to 4 bytes", () => {
    expect(ipToBytes("104.16.0.1")).toEqual([104, 16, 0, 1]);
  });

  it("parses full and compressed IPv6 to 16 bytes", () => {
    expect(ipToBytes("2606:4700::1")).toHaveLength(16);
    expect(ipToBytes("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(ipToBytes("2606:4700:0000:0000:0000:0000:0000:0001")).toEqual(ipToBytes("2606:4700::1"));
  });

  it("strips an IPv6 zone id", () => {
    expect(ipToBytes("fe80::1%eth0")).toEqual(ipToBytes("fe80::1"));
  });

  it("rejects malformed input", () => {
    expect(ipToBytes("999.1.1.1")).toBeNull();
    expect(ipToBytes("10.0.0")).toBeNull();
    expect(ipToBytes("nonsense")).toBeNull();
    expect(ipToBytes("2606::4700::1")).toBeNull();
    expect(ipToBytes("")).toBeNull();
  });
});

describe("isCloudflareIp", () => {
  it("recognizes Cloudflare v4 edges", () => {
    expect(isCloudflareIp("104.16.132.229")).toBe(true); // 104.16.0.0/13
    expect(isCloudflareIp("172.67.1.1")).toBe(true); // 172.64.0.0/13
    expect(isCloudflareIp("162.159.0.1")).toBe(true); // 162.158.0.0/15
    expect(isCloudflareIp("131.0.72.5")).toBe(true); // 131.0.72.0/22
  });

  it("recognizes Cloudflare v6 edges", () => {
    expect(isCloudflareIp("2606:4700::6810:84e5")).toBe(true); // 2606:4700::/32
    expect(isCloudflareIp("2a06:98c0:3600::103")).toBe(true); // 2a06:98c0::/29
  });

  it("rejects non-Cloudflare addresses", () => {
    expect(isCloudflareIp("73.161.96.1")).toBe(false); // a residential WAN
    expect(isCloudflareIp("10.0.3.59")).toBe(false); // private
    expect(isCloudflareIp("8.8.8.8")).toBe(false);
    expect(isCloudflareIp("2001:4860:4860::8888")).toBe(false); // Google v6
    expect(isCloudflareIp("131.0.76.1")).toBe(false); // just outside 131.0.72.0/22
  });
});

describe("classifyResolution", () => {
  const WAN = "73.161.96.1";

  it("proxied when all addresses are Cloudflare edges", () => {
    expect(classifyResolution(["104.16.132.229", "172.67.1.1"], WAN)).toBe("proxied");
    expect(classifyResolution(["2606:4700::6810:84e5"], WAN)).toBe("proxied");
  });

  it("flags WAN exposure regardless of other records", () => {
    expect(classifyResolution([WAN], WAN)).toBe("unproxied-wan-exposed");
    expect(classifyResolution(["104.16.1.1", WAN], WAN)).toBe("unproxied-wan-exposed");
  });

  it("unproxied-other for a non-Cloudflare, non-WAN origin", () => {
    expect(classifyResolution(["185.199.108.153"], WAN)).toBe("unproxied-other"); // GitHub Pages
  });

  it("unresolved for no addresses", () => {
    expect(classifyResolution([], WAN)).toBe("unresolved");
    expect(classifyResolution(["  "], WAN)).toBe("unresolved");
  });

  it("works without a known WAN IP", () => {
    expect(classifyResolution(["104.16.1.1"], null)).toBe("proxied");
    expect(classifyResolution(["8.8.8.8"], null)).toBe("unproxied-other");
  });
});
