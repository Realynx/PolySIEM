import { describe, expect, it } from "vitest";
import {
  suggestPrivacyRouterTopology,
  type PrivacyInterfaceInfo,
} from "./topology";

/**
 * The discovery half of the privacy router add flow.
 *
 * Every case below is really one of two assertions: either the box's report
 * settles the question and the answer is exact, or it does not and the answer is
 * null. There is deliberately no third behaviour — a plausible-looking guess
 * here becomes an nftables ruleset that routes forwarded traffic into an
 * interface that is not there, and nothing about that failure is loud.
 */

function iface(overrides: Partial<PrivacyInterfaceInfo> & { name: string }): PrivacyInterfaceInfo {
  return { addrCidr: null, defaultRoute: false, up: true, ...overrides };
}

/** The reference hardware: one NIC doing both jobs. */
const ONE_ARMED: PrivacyInterfaceInfo[] = [
  iface({ name: "eth0", addrCidr: "10.0.3.10/24", defaultRoute: true }),
];

describe("suggestPrivacyRouterTopology", () => {
  it("treats the one-armed box as the NORMAL case, not an error", () => {
    const suggestion = suggestPrivacyRouterTopology(ONE_ARMED, "10.0.3.10");
    expect(suggestion).toEqual({
      wanInterface: "eth0",
      lanInterface: "eth0",
      lanCidr: "10.0.3.0/24",
      oneArmed: true,
    });
    // The shape carries no issue, warning or error channel at all, so a surface
    // physically cannot render this as a problem.
    expect(Object.keys(suggestion).sort()).toEqual(["lanCidr", "lanInterface", "oneArmed", "wanInterface"]);
  });

  it("splits LAN and WAN on a two-NIC box and does not call it one-armed", () => {
    const suggestion = suggestPrivacyRouterTopology(
      [
        iface({ name: "eth0", addrCidr: "10.0.3.10/24" }),
        iface({ name: "eth1", addrCidr: "192.0.2.5/30", defaultRoute: true }),
      ],
      "10.0.3.10",
    );
    expect(suggestion).toEqual({
      wanInterface: "eth1",
      lanInterface: "eth0",
      lanCidr: "10.0.3.0/24",
      oneArmed: false,
    });
  });

  it("reports the LAN NETWORK, with host bits cleared", () => {
    // The interface carries `10.0.3.10/24`; what a rule matches on is the /24.
    expect(suggestPrivacyRouterTopology(ONE_ARMED, "10.0.3.77").lanCidr).toBe("10.0.3.0/24");
    expect(
      suggestPrivacyRouterTopology(
        [iface({ name: "eth0", addrCidr: "172.20.130.9/22", defaultRoute: true })],
        "172.20.131.4",
      ).lanCidr,
    ).toBe("172.20.128.0/22");
  });

  it("does not go negative on an address above 127.255.255.255", () => {
    // Signed 32-bit bit twiddling turns 224.x into a negative number and every
    // containment test after it silently answers wrong.
    const suggestion = suggestPrivacyRouterTopology(
      [iface({ name: "eth0", addrCidr: "203.0.113.9/24", defaultRoute: true })],
      "203.0.113.200",
    );
    expect(suggestion.lanInterface).toBe("eth0");
    expect(suggestion.lanCidr).toBe("203.0.113.0/24");
  });

  it("picks the interface whose subnet actually contains the address we connected on", () => {
    const suggestion = suggestPrivacyRouterTopology(
      [
        iface({ name: "eth0", addrCidr: "10.0.3.10/24", defaultRoute: true }),
        iface({ name: "eth1", addrCidr: "10.0.9.10/24" }),
      ],
      "10.0.9.42",
    );
    expect(suggestion.lanInterface).toBe("eth1");
    expect(suggestion.lanCidr).toBe("10.0.9.0/24");
    expect(suggestion.wanInterface).toBe("eth0");
    expect(suggestion.oneArmed).toBe(false);
  });

  it("prefers the most specific subnet when two of them contain the address", () => {
    // Same rule the kernel uses to choose a route, so it names the interface the
    // packets actually arrived on rather than merely a plausible one.
    const suggestion = suggestPrivacyRouterTopology(
      [
        iface({ name: "br0", addrCidr: "10.0.0.4/8" }),
        iface({ name: "eth0", addrCidr: "10.0.3.10/24", defaultRoute: true }),
      ],
      "10.0.3.10",
    );
    expect(suggestion.lanInterface).toBe("eth0");
    expect(suggestion.lanCidr).toBe("10.0.3.0/24");
  });

  it("prefers an UP link over a down one that would otherwise tie", () => {
    // A down interface cannot be the one carrying this SSH session.
    const suggestion = suggestPrivacyRouterTopology(
      [
        iface({ name: "eth1", addrCidr: "10.0.3.11/24", up: false }),
        iface({ name: "eth0", addrCidr: "10.0.3.10/24", defaultRoute: true }),
      ],
      "10.0.3.50",
    );
    expect(suggestion.lanInterface).toBe("eth0");
  });

  it("still answers when the box reports every link as down", () => {
    const suggestion = suggestPrivacyRouterTopology(
      [iface({ name: "eth0", addrCidr: "10.0.3.10/24", defaultRoute: true, up: false })],
      "10.0.3.10",
    );
    expect(suggestion.lanInterface).toBe("eth0");
    expect(suggestion.wanInterface).toBe("eth0");
  });

  it("collapses several default routes over the SAME interface", () => {
    const suggestion = suggestPrivacyRouterTopology(
      [
        iface({ name: "eth0", addrCidr: "10.0.3.10/24", defaultRoute: true }),
        // The agent deduplicates by name; a report that did not still must not
        // be read as a multi-homed box.
        iface({ name: "eth0", addrCidr: "10.0.3.10/24", defaultRoute: true }),
      ],
      "10.0.3.10",
    );
    expect(suggestion.wanInterface).toBe("eth0");
    expect(suggestion.oneArmed).toBe(true);
  });

  describe("returns null rather than guessing", () => {
    it("when nothing holds a default route", () => {
      const suggestion = suggestPrivacyRouterTopology(
        [iface({ name: "eth0", addrCidr: "10.0.3.10/24" })],
        "10.0.3.10",
      );
      expect(suggestion.wanInterface).toBeNull();
      // The LAN half is still knowable, and is still answered.
      expect(suggestion.lanInterface).toBe("eth0");
      expect(suggestion.oneArmed).toBe(false);
    });

    it("when two different interfaces both hold a default route", () => {
      const suggestion = suggestPrivacyRouterTopology(
        [
          iface({ name: "eth0", addrCidr: "10.0.3.10/24", defaultRoute: true }),
          iface({ name: "eth1", addrCidr: "192.0.2.5/30", defaultRoute: true }),
        ],
        "10.0.3.10",
      );
      expect(suggestion.wanInterface).toBeNull();
      expect(suggestion.oneArmed).toBe(false);
    });

    it("when two equally specific interfaces both contain the address", () => {
      const suggestion = suggestPrivacyRouterTopology(
        [
          iface({ name: "eth0", addrCidr: "10.0.3.10/24", defaultRoute: true }),
          iface({ name: "eth1", addrCidr: "10.0.3.11/24" }),
        ],
        "10.0.3.50",
      );
      expect(suggestion.lanInterface).toBeNull();
      expect(suggestion.lanCidr).toBeNull();
      expect(suggestion.wanInterface).toBe("eth0");
      expect(suggestion.oneArmed).toBe(false);
    });

    it("when no interface's subnet contains the address we connected on", () => {
      const suggestion = suggestPrivacyRouterTopology(ONE_ARMED, "192.168.88.4");
      expect(suggestion.lanInterface).toBeNull();
      expect(suggestion.lanCidr).toBeNull();
      expect(suggestion.wanInterface).toBe("eth0");
    });

    it("when the router was reached by DNS name, because resolving is not this module's job", () => {
      const suggestion = suggestPrivacyRouterTopology(ONE_ARMED, "router.lan");
      expect(suggestion.lanInterface).toBeNull();
      expect(suggestion.lanCidr).toBeNull();
      // The operator still gets a WAN answer and a list to pick the LAN from.
      expect(suggestion.wanInterface).toBe("eth0");
    });

    it("when the router was reached over IPv6", () => {
      expect(suggestPrivacyRouterTopology(ONE_ARMED, "fd00::5").lanInterface).toBeNull();
      expect(suggestPrivacyRouterTopology(ONE_ARMED, "[fd00::5]").lanInterface).toBeNull();
    });

    it("when the box reported no interfaces at all", () => {
      expect(suggestPrivacyRouterTopology([], "10.0.3.10")).toEqual({
        wanInterface: null,
        lanInterface: null,
        lanCidr: null,
        oneArmed: false,
      });
    });

    it("when an interface has no address, or an address that is not a v4 CIDR", () => {
      const suggestion = suggestPrivacyRouterTopology(
        [
          iface({ name: "eth0", addrCidr: null, defaultRoute: true }),
          iface({ name: "eth1", addrCidr: "10.0.3.10/33" }),
          iface({ name: "eth2", addrCidr: "010.0.3.10/24" }),
          iface({ name: "eth3", addrCidr: "10.0.3.999/24" }),
        ],
        "10.0.3.10",
      );
      expect(suggestion.lanInterface).toBeNull();
      expect(suggestion.wanInterface).toBe("eth0");
    });
  });

  it("survives junk where a list was expected, because STATUS is remote data", () => {
    const missing = undefined as unknown as PrivacyInterfaceInfo[];
    expect(suggestPrivacyRouterTopology(missing, "10.0.3.10").lanInterface).toBeNull();
    expect(suggestPrivacyRouterTopology(null, "10.0.3.10").oneArmed).toBe(false);
    expect(suggestPrivacyRouterTopology(ONE_ARMED, undefined as unknown as string).lanInterface).toBeNull();
  });

  it("tolerates whitespace around the SSH host", () => {
    expect(suggestPrivacyRouterTopology(ONE_ARMED, "  10.0.3.10 ").lanInterface).toBe("eth0");
  });
});
