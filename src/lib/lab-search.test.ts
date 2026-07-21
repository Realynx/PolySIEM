import { describe, expect, it } from "vitest";
import { isLocalIpAddress } from "./lab-search";

describe("isLocalIpAddress", () => {
  it.each(["10.0.0.5", "172.16.20.1", "192.168.1.8", "100.64.0.10", "127.0.0.1", "169.254.1.2"])(
    "classifies local IPv4 %s",
    (address) => expect(isLocalIpAddress(address)).toBe(true),
  );

  it.each(["::1", "fc00::1", "fd12:3456::8", "fe80::1%eth0"])("classifies local IPv6 %s", (address) =>
    expect(isLocalIpAddress(address)).toBe(true),
  );

  it.each(["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"])("classifies external IP %s", (address) =>
    expect(isLocalIpAddress(address)).toBe(false),
  );
});
