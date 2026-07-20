import { describe, expect, it } from "vitest";
import { mergeGuestAgentAddresses } from "./client";

describe("Proxmox guest-agent address discovery", () => {
  it("matches a usable IPv4 address to the configured NIC by MAC", () => {
    const result = mergeGuestAgentAddresses(
      [{ name: "net0", mac: "BC:24:11:12:34:56", bridge: "vmbr0", vlanTag: 20, ip: null }],
      [{
        name: "eth0",
        "hardware-address": "bc:24:11:12:34:56",
        "ip-addresses": [
          { "ip-address": "fe80::1", "ip-address-type": "ipv6", prefix: 64 },
          { "ip-address": "10.0.20.15", "ip-address-type": "ipv4", prefix: 24 },
        ],
      }],
    );
    expect(result[0].ip).toBe("10.0.20.15");
  });

  it("ignores loopback and link-local addresses", () => {
    const result = mergeGuestAgentAddresses(
      [{ name: "net0", mac: "BC:24:11:12:34:56", bridge: "vmbr0", vlanTag: null, ip: null }],
      [{
        "hardware-address": "BC:24:11:12:34:56",
        "ip-addresses": [
          { "ip-address": "127.0.0.1", "ip-address-type": "ipv4" },
          { "ip-address": "169.254.1.2", "ip-address-type": "ipv4" },
        ],
      }],
    );
    expect(result[0].ip).toBeNull();
  });
});
