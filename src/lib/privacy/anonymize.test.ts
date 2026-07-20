import { describe, expect, it } from "vitest";
import {
  anonymizeCidr,
  anonymizeDeep,
  anonymizeHostname,
  anonymizeIpv4,
  anonymizeIpv6,
  anonymizeMac,
  anonymizeName,
  anonymizeUrl,
  anonymizeUsername,
  collectNames,
  scrubText,
} from "./anonymize";

describe("anonymizeName", () => {
  it("is deterministic and word-pair shaped", () => {
    const a = anonymizeName("server-alpha");
    expect(a).toBe(anonymizeName("server-alpha"));
    expect(a).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("maps distinct inputs to distinct names", () => {
    expect(anonymizeName("server-alpha")).not.toBe(anonymizeName("server-beta"));
  });

  it("returns empty/whitespace-only input unchanged", () => {
    expect(anonymizeName("")).toBe("");
    expect(anonymizeName("   ")).toBe("   ");
  });
});

describe("anonymizeUsername", () => {
  it("is deterministic and formatted as user-xxxx", () => {
    const u = anonymizeUsername("fox");
    expect(u).toBe(anonymizeUsername("fox"));
    expect(u).toMatch(/^user-[0-9a-z]{4}$/);
  });
});

describe("anonymizeIpv4", () => {
  it("is deterministic", () => {
    expect(anonymizeIpv4("10.0.20.15")).toBe(anonymizeIpv4("10.0.20.15"));
  });

  it("keeps RFC1918 addresses in their private family", () => {
    expect(anonymizeIpv4("10.0.20.15")).toMatch(/^10\.\d+\.\d+\.\d+$/);
    expect(anonymizeIpv4("192.168.1.50")).toMatch(/^192\.168\.\d+\.\d+$/);
    const fake172 = anonymizeIpv4("172.20.3.4");
    const second = Number(fake172.split(".")[1]);
    expect(fake172).toMatch(/^172\.\d+\.\d+\.\d+$/);
    expect(second).toBeGreaterThanOrEqual(16);
    expect(second).toBeLessThanOrEqual(31);
  });

  it("maps public addresses into a documentation range", () => {
    const fake = anonymizeIpv4("8.8.8.8");
    expect(
      fake.startsWith("192.0.2.") ||
        fake.startsWith("198.51.100.") ||
        fake.startsWith("203.0.113."),
    ).toBe(true);
  });

  it("preserves /24 grouping while keeping host octets distinct", () => {
    const a = anonymizeIpv4("10.20.30.5");
    const b = anonymizeIpv4("10.20.30.6");
    expect(a.split(".").slice(0, 3)).toEqual(b.split(".").slice(0, 3));
    expect(a).not.toBe(b);
  });

  it("gives different subnets different fake subnets", () => {
    const a = anonymizeIpv4("10.20.30.5");
    const b = anonymizeIpv4("10.20.31.5");
    expect(a.split(".").slice(0, 3)).not.toEqual(b.split(".").slice(0, 3));
  });

  it("leaves loopback, link-local, and invalid input unchanged", () => {
    expect(anonymizeIpv4("127.0.0.1")).toBe("127.0.0.1");
    expect(anonymizeIpv4("169.254.10.20")).toBe("169.254.10.20");
    expect(anonymizeIpv4("not-an-ip")).toBe("not-an-ip");
    expect(anonymizeIpv4("999.1.1.1")).toBe("999.1.1.1");
  });
});

describe("anonymizeCidr", () => {
  it("keeps a /24 coherent with its member IPs", () => {
    const memberFake = anonymizeIpv4("10.20.30.5");
    const cidrFake = anonymizeCidr("10.20.30.0/24");
    const fakeNet = memberFake.split(".").slice(0, 3).join(".");
    expect(cidrFake).toBe(`${fakeNet}.0/24`);
  });

  it("keeps the prefix length and handles IPv6", () => {
    expect(anonymizeCidr("192.168.1.0/16")).toMatch(/\/16$/);
    expect(anonymizeCidr("fd00::/64")).toMatch(/^2001:db8:.*\/64$/);
  });

  it("returns invalid input unchanged", () => {
    expect(anonymizeCidr("nonsense/24")).toBe("nonsense/24");
    expect(anonymizeCidr("10.0.0.0")).toBe("10.0.0.0");
    expect(anonymizeCidr("10.0.0.0/99")).toBe("10.0.0.0/99");
  });
});

describe("anonymizeIpv6", () => {
  it("is deterministic and lands in 2001:db8::/32", () => {
    const fake = anonymizeIpv6("fe80::1");
    expect(fake).toBe(anonymizeIpv6("fe80::1"));
    expect(fake.startsWith("2001:db8:")).toBe(true);
    expect(fake.split(":")).toHaveLength(8);
  });

  it("keeps addresses in the same /64 in the same fake network half", () => {
    const a = anonymizeIpv6("fd00:1:2:3:aaaa:bbbb:cccc:1").split(":");
    const b = anonymizeIpv6("fd00:1:2:3:dddd:eeee:ffff:2").split(":");
    expect(a.slice(0, 4)).toEqual(b.slice(0, 4));
    expect(a.slice(4)).not.toEqual(b.slice(4));
  });

  it("returns non-IPv6 input unchanged", () => {
    expect(anonymizeIpv6("not-v6")).toBe("not-v6");
    expect(anonymizeIpv6("12:30")).toBe("12:30");
  });
});

describe("anonymizeMac", () => {
  it("produces a locally-administered 02 prefix and is deterministic", () => {
    const fake = anonymizeMac("aa:bb:cc:dd:ee:ff");
    expect(fake).toBe(anonymizeMac("aa:bb:cc:dd:ee:ff"));
    expect(fake).toMatch(/^02(:[0-9a-f]{2}){5}$/);
  });

  it("preserves separator style and case", () => {
    expect(anonymizeMac("AA-BB-CC-DD-EE-FF")).toMatch(/^02(-[0-9A-F]{2}){5}$/);
  });

  it("returns invalid input unchanged", () => {
    expect(anonymizeMac("aa:bb:cc")).toBe("aa:bb:cc");
    expect(anonymizeMac("zz:bb:cc:dd:ee:ff")).toBe("zz:bb:cc:dd:ee:ff");
  });
});

describe("anonymizeHostname", () => {
  it("fakes the first label and uses example.com for multi-label hosts", () => {
    expect(anonymizeHostname("nas.local")).toBe(`${anonymizeName("nas")}.example.com`);
    expect(anonymizeHostname("pve-01")).toBe(anonymizeName("pve-01"));
  });

  it("preserves a trailing dot", () => {
    expect(anonymizeHostname("nas.local.")).toBe(`${anonymizeName("nas")}.example.com.`);
  });

  it("delegates IP literals", () => {
    expect(anonymizeHostname("10.0.0.5")).toBe(anonymizeIpv4("10.0.0.5"));
    expect(anonymizeHostname("fe80::1")).toBe(anonymizeIpv6("fe80::1"));
  });
});

describe("anonymizeUrl", () => {
  it("replaces the host, keeps scheme/port/path, drops query, hash, userinfo", () => {
    const fake = anonymizeUrl("https://admin:hunter2@nas.local:5001/admin/panel?token=abc#frag");
    expect(fake).toBe(`https://${anonymizeName("nas")}.example.com:5001/admin/panel`);
  });

  it("handles IP hosts and falls back to scrubText for non-URLs", () => {
    expect(anonymizeUrl("http://10.0.0.5/status")).toBe(
      `http://${anonymizeIpv4("10.0.0.5")}/status`,
    );
    const fallback = anonymizeUrl("not a url with 10.0.0.5 inside");
    expect(fallback).toContain(anonymizeIpv4("10.0.0.5"));
    expect(fallback).not.toContain("10.0.0.5");
  });
});

describe("scrubText", () => {
  it("replaces embedded IPs, MACs, and known names but nothing else", () => {
    const nameMap = new Map([["pve-01", anonymizeName("pve-01")]]);
    const out = scrubText(
      "reboot pve-01 at 12:30 from 10.1.2.3 (aa:bb:cc:dd:ee:ff)",
      nameMap,
    );
    expect(out).toContain(anonymizeName("pve-01"));
    expect(out).toContain(anonymizeIpv4("10.1.2.3"));
    expect(out).toContain(anonymizeMac("aa:bb:cc:dd:ee:ff"));
    expect(out).toContain("reboot");
    expect(out).toContain("at 12:30 from");
    expect(out).not.toContain("pve-01");
    expect(out).not.toContain("10.1.2.3");
    expect(out).not.toContain("aa:bb:cc:dd:ee:ff");
  });

  it("does not mangle times or plain hex words", () => {
    expect(scrubText("meeting at 12:30, code deadbeef")).toBe(
      "meeting at 12:30, code deadbeef",
    );
  });

  it("replaces CIDRs and IPv6 addresses in text", () => {
    const out = scrubText("route 10.20.30.0/24 via fe80::1");
    expect(out).toBe(`route ${anonymizeCidr("10.20.30.0/24")} via ${anonymizeIpv6("fe80::1")}`);
  });

  it("respects word boundaries and replaces longer keys first", () => {
    const nameMap = new Map([
      ["core", "SHORT"],
      ["core switch", "LONG"],
    ]);
    expect(scrubText("the core switch is up", nameMap)).toBe("the LONG is up");
    // "pve" inside "pve-01" is hyphen-bounded and must not match.
    expect(scrubText("pve-01 and pve", new Map([["pve", "X"]]))).toBe("pve-01 and X");
  });
});

describe("collectNames", () => {
  it("collects name, username, and host keys with the right anonymizers", () => {
    const map = collectNames({
      name: "pve-01",
      meta: { username: "fox", hostname: "nas.local" },
      tags: [{ label: "rack-a" }],
    });
    expect(map.get("pve-01")).toBe(anonymizeName("pve-01"));
    expect(map.get("fox")).toBe(anonymizeUsername("fox"));
    expect(map.get("nas.local")).toBe(anonymizeHostname("nas.local"));
    expect(map.get("rack-a")).toBe(anonymizeName("rack-a"));
  });

  it("skips strings shorter than 3 chars and survives circular refs", () => {
    const node: { name: string; self?: unknown } = { name: "ab" };
    node.self = node;
    const map = collectNames(node);
    expect(map.has("ab")).toBe(false);
  });
});

describe("anonymizeDeep", () => {
  const payload = {
    id: "host-123",
    name: "pve-01",
    vlanId: 20,
    ports: [22, 8006],
    online: true,
    lastSeen: new Date("2026-01-01T00:00:00Z"),
    notes: null as string | null,
    label: "pve-01 (10.0.20.15)",
    interfaces: [
      { name: "eth0", macAddress: "aa:bb:cc:dd:ee:ff", ip: { address: "10.0.20.15" } },
    ],
    network: { name: "lab-lan", cidr: "10.0.20.0/24", gateway: "10.0.20.1" },
  };

  it("anonymizes a realistic nested payload consistently", () => {
    const out = anonymizeDeep(payload);
    const fakeName = anonymizeName("pve-01");
    const fakeIp = anonymizeIpv4("10.0.20.15");

    expect(out.name).toBe(fakeName);
    // Composed label reuses the name-field mapping and the fake IP.
    expect(out.label).toBe(`${fakeName} (${fakeIp})`);
    expect(out.interfaces[0].name).toBe(anonymizeName("eth0"));
    expect(out.interfaces[0].macAddress).toBe(anonymizeMac("aa:bb:cc:dd:ee:ff"));
    expect(out.interfaces[0].ip.address).toBe(fakeIp);
    expect(out.network.name).toBe(anonymizeName("lab-lan"));
    expect(out.network.cidr).toBe(anonymizeCidr("10.0.20.0/24"));
    expect(out.network.gateway).toBe(anonymizeIpv4("10.0.20.1"));
    // Subnet coherence across the whole payload.
    const fakeNet = fakeIp.split(".").slice(0, 3).join(".");
    expect(out.network.cidr).toBe(`${fakeNet}.0/24`);
    expect(out.network.gateway.startsWith(`${fakeNet}.`)).toBe(true);
  });

  it("leaves ids, numbers, booleans, Dates, and null untouched", () => {
    const out = anonymizeDeep(payload);
    expect(out.id).toBe("host-123");
    expect(out.vlanId).toBe(20);
    expect(out.ports).toEqual([22, 8006]);
    expect(out.online).toBe(true);
    expect(out.lastSeen).toBe(payload.lastSeen);
    expect(out.notes).toBeNull();
    expect(anonymizeDeep(null)).toBeNull();
    expect(anonymizeDeep(undefined)).toBeUndefined();
  });

  it("does not mutate the input", () => {
    const snapshot = JSON.parse(JSON.stringify(payload)) as unknown;
    const out = anonymizeDeep(payload);
    expect(out).not.toBe(payload);
    expect(JSON.parse(JSON.stringify(payload))).toEqual(snapshot);
  });

  it("applies key-set anonymizers to arrays under plural keys", () => {
    const out = anonymizeDeep({ ips: ["10.0.20.15"], dnsNames: ["nas.local"] });
    expect(out.ips[0]).toBe(anonymizeIpv4("10.0.20.15"));
    expect(out.dnsNames[0]).toBe(anonymizeHostname("nas.local"));
  });

  it("splits user@host values under host keys", () => {
    const out = anonymizeDeep({ sshHost: "root@nas.local" });
    expect(out.sshHost).toBe(`${anonymizeUsername("root")}@${anonymizeHostname("nas.local")}`);
  });

  it("handles circular references without throwing", () => {
    const node: { name: string; self?: unknown } = { name: "loop-node" };
    node.self = node;
    const out = anonymizeDeep(node);
    expect(out.name).toBe(anonymizeName("loop-node"));
    expect(out.self).toBe(node);
  });

  it("never rewrites machine discriminants, even when a name matches one", () => {
    // Regression: an integration named "OpnSense" pseudonymized its own
    // `type: "OPNSENSE"` via the case-insensitive name scrub, so
    // INTEGRATION_ICONS[type] rendered an undefined component and crashed
    // the dashboard RSC render for any shielded user.
    const out = anonymizeDeep({
      name: "OpnSense",
      type: "OPNSENSE",
      aliasType: "pve-ipset",
      lastSyncStatus: "SUCCESS",
      powerState: "running",
      severity: "HIGH",
      kind: "switch",
      protocol: "tcp",
      action: "pass",
      role: "ADMIN",
    });
    expect(out.name).not.toBe("OpnSense");
    expect(out.type).toBe("OPNSENSE");
    expect(out.aliasType).toBe("pve-ipset");
    expect(out.lastSyncStatus).toBe("SUCCESS");
    expect(out.powerState).toBe("running");
    expect(out.severity).toBe("HIGH");
    expect(out.kind).toBe("switch");
    expect(out.protocol).toBe("tcp");
    expect(out.action).toBe("pass");
    expect(out.role).toBe("ADMIN");
  });
});
