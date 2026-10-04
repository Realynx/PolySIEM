// This is a TEST file, so it may import `node:net` — nothing here is ever
// bundled for a browser. That import is the whole point: `src/lib/net/ip.ts`
// exists to replace `net.isIP` in modules that reach client bundles, and the
// only thing that makes the replacement safe is that it answers identically.
import { isIP as nodeIsIP, isIPv4 as nodeIsIPv4, isIPv6 as nodeIsIPv6 } from "node:net";
import { describe, expect, it } from "vitest";
import { isIP, isIPv4, isIPv6 } from "./ip";

/**
 * The cases worth naming in the file rather than leaving to the fuzz below:
 * each one is a rule someone could plausibly get wrong when writing an IP
 * matcher by hand, and each one decides whether a real host validates.
 */
const CASES: ReadonlyArray<readonly [string, 0 | 4 | 6, string]> = [
  // --- IPv4 ---
  ["1.2.3.4", 4, "the plain dotted quad"],
  ["0.0.0.0", 4, "all zeros is still an address"],
  ["255.255.255.255", 4, "the top of the range"],
  ["10.0.0.5", 4, "RFC1918, the common case for a managed host"],
  ["127.0.0.1", 4, "loopback is a valid address (unreachability is a separate check)"],
  ["01.2.3.4", 0, "leading zeros are rejected — 010 must not read as 10 here and 8 elsewhere"],
  ["1.02.3.4", 0, "a leading zero in any octet, not just the first"],
  ["0.0.0.00", 0, "even a doubled zero"],
  ["1.2.3.256", 0, "an octet past 255"],
  ["999.1.1.1", 0, "wildly out of range"],
  ["1.2.3", 0, "three octets is not an address"],
  ["1.2.3.4.5", 0, "five octets is not an address"],
  ["1.2.3.", 0, "a trailing dot"],
  ["1.2.3.4/24", 0, "a CIDR is not an address — callers must split the prefix off first"],
  [" 1.2.3.4", 0, "no leading whitespace is tolerated"],
  ["1.2.3.4 ", 0, "no trailing whitespace either"],
  ["0x7f.0.0.1", 0, "hex octets are not accepted"],
  ["1.2.3.-4", 0, "a signed octet"],

  // --- IPv6 ---
  ["::", 6, "the unspecified address, all of it compressed away"],
  ["::1", 6, "loopback"],
  ["1:2:3:4:5:6:7:8", 6, "eight hextets, uncompressed"],
  ["1::8", 6, "compression in the middle"],
  ["1::", 6, "compression at the end"],
  ["::8", 6, "compression at the front"],
  ["::ffff:127.0.0.1", 6, "an IPv4-mapped address — an IPv4 tail inside an IPv6 literal"],
  ["1:2:3:4:5:6:1.2.3.4", 6, "an IPv4 tail with the hextets spelled out"],
  ["2001:0db8:0000:0000:0000:ff00:0042:8329", 6, "fully padded"],
  ["ABCD:EF01:2345:6789:ABCD:EF01:2345:6789", 6, "upper-case hex"],
  ["fe80::1%eth0", 6, "a zone index, which Node accepts and so must we"],
  ["1:2:3:4:5:6:7:8:9", 0, "nine hextets"],
  ["12345::", 0, "a five-digit hextet"],
  ["gggg::1", 0, "non-hex digits"],
  ["::ffff:1.2.3.256", 0, "the IPv4 tail is validated as an IPv4 address"],
  ["[::1]", 0, "brackets belong to URL syntax, not to the address"],
  [":::", 0, "three colons"],

  // --- neither ---
  ["", 0, "the empty string answers 0 rather than throwing"],
  [" ", 0, "whitespace alone"],
  ["   ", 0, "more whitespace alone"],
  ["\t", 0, "a tab"],
  ["\n", 0, "a newline"],
  ["1.2.3.4\n", 0, "a trailing newline — the anchors are ^…$ but the regex is not multiline"],
  ["localhost", 0, "a hostname"],
  ["polysiem.lan", 0, "a dotted hostname"],
  ["not an ip at all", 0, "free text"],
];

describe("isIP", () => {
  for (const [value, expected, why] of CASES) {
    it(`answers ${expected} for ${JSON.stringify(value)} — ${why}`, () => {
      expect(isIP(value)).toBe(expected);
    });
  }

  it("never throws, whatever it is handed", () => {
    for (const [value] of CASES) expect(() => isIP(value)).not.toThrow();
    // Not reachable through the typed signature, but validators run on parsed
    // wire data and a thrown TypeError here would become a 500 rather than a
    // validation message.
    for (const value of [null, undefined, 1234, {}, []]) {
      expect(isIP(value as unknown as string)).toBe(0);
    }
  });
});

describe("isIPv4 / isIPv6", () => {
  it("agree with isIP on every named case", () => {
    for (const [value, expected] of CASES) {
      expect(isIPv4(value)).toBe(expected === 4);
      expect(isIPv6(value)).toBe(expected === 6);
    }
  });
});

/**
 * Parity with the builtin, checked rather than asserted.
 *
 * `isIP` decides which hosts an operator may save, so "close enough" is a
 * behaviour change: stricter locks people out of addresses that used to work,
 * looser accepts addresses nothing downstream can resolve. These cases run the
 * real `node:net` side by side with ours, so a divergence — introduced here, or
 * by a future Node release changing the grammar — fails the build instead of
 * quietly moving the validation boundary.
 */
describe("parity with node:net", () => {
  it("matches the builtin on every named case", () => {
    for (const [value] of CASES) {
      expect({ value, v: isIP(value) }).toEqual({ value, v: nodeIsIP(value) });
      expect({ value, v: isIPv4(value) }).toEqual({ value, v: nodeIsIPv4(value) });
      expect({ value, v: isIPv6(value) }).toEqual({ value, v: nodeIsIPv6(value) });
    }
  });

  it("matches the builtin on every short string over an IP-ish alphabet", () => {
    // Exhaustive to length 4 over the characters that make and break IP
    // literals. This is what catches the "one colon too many" family that a
    // hand-written table never thinks to include.
    const alphabet = "0.:1af%";
    const mismatches: string[] = [];
    const walk = (prefix: string, depth: number) => {
      if (isIP(prefix) !== nodeIsIP(prefix)) mismatches.push(prefix);
      if (depth === 0) return;
      for (const char of alphabet) walk(prefix + char, depth - 1);
    };
    walk("", 4);
    expect(mismatches).toEqual([]);
  });

  it("matches the builtin on single-character mutations of valid addresses", () => {
    const alphabet = "0123456789abcdefABCDEF.:%/ xZ-";
    const valid = ["1.2.3.4", "::1", "::ffff:127.0.0.1", "1:2:3:4:5:6:7:8", "fe80::1%eth0", "2001:db8::8a2e:370:7334"];
    const mismatches: string[] = [];
    for (const base of valid) {
      for (let index = 0; index <= base.length; index += 1) {
        const variants = [
          base.slice(0, index) + base.slice(index + 1),
          ...[...alphabet].flatMap((char) => [
            base.slice(0, index) + char + base.slice(index),
            base.slice(0, index) + char + base.slice(index + 1),
          ]),
        ];
        for (const variant of variants) {
          if (isIP(variant) !== nodeIsIP(variant)) mismatches.push(variant);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});
