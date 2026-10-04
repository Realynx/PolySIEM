import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizePrivacyProxyCidr,
  normalizePrivacyProxyHostname,
  normalizePrivacyProxyPortSpec,
  renderPrivacyProxyConfig,
  PRIVACY_PROXY_DEFAULT_LIMITS,
  PRIVACY_PROXY_MAX_EXITS,
  PRIVACY_PROXY_MAX_RULES,
  type PrivacyProxyConfigInput,
} from "./proxy-config";

/**
 * The bytes the Rust parser is pinned to.
 *
 * `native/privacy-proxy/tests/config_golden.rs` asserts the parser reads this exact
 * file into the expected model; the test below asserts this renderer produces
 * it. That is what keeps a wire format agreed across two languages: neither side
 * can drift without the other going red.
 *
 * CRLF is normalised away because a Windows checkout may rewrite line endings;
 * the assertion is about content, not about how git stored it.
 */
const REFERENCE_CONFIG = readFileSync(
  resolve(process.cwd(), "native", "privacy-proxy", "tests", "fixtures", "reference.conf"),
  "utf8",
).replace(/\r\n/g, "\n");

/** The input the reference config is the rendering of. */
function referenceInput(): PrivacyProxyConfigInput {
  return {
    proxyHttpPort: 8080,
    proxyHttpsPort: 8443,
    defaultAction: "direct",
    // Deliberately NOT in key order, so the sort is exercised.
    exits: [
      { key: "us-nyc", ifName: "psvpn0" },
      { key: "se-sto", ifName: "psvpn1" },
    ],
    rules: [
      { action: "exit", exitKey: "us-nyc", hostname: "*.netflix.com" },
      { action: "block", srcCidr: "10.0.3.50/32", proto: "tcp", dportSpec: "443" },
      {
        action: "exit",
        exitKey: "se-sto",
        proto: "tcp",
        dportSpec: "80,443",
        hostname: "bbc.co.uk",
        rateKbps: 2048,
      },
    ],
  };
}

describe("VPN proxy configuration renderer", () => {
  it("renders the reference fixture the Rust parser is pinned to, byte for byte", () => {
    expect(renderPrivacyProxyConfig(referenceInput())).toBe(REFERENCE_CONFIG);
  });

  it("never emits a tab, because the agent refuses a config containing one", () => {
    // `normalizePrivacyProxyConfig` in ./agent.ts throws on a tab: the file crosses
    // the wire as one `PROXYCONF<TAB><line>` record per line, so a tab inside a
    // line would break that framing. This is the whole reason the format is
    // space-delimited while everything else in the feature is tab-delimited.
    expect(renderPrivacyProxyConfig(referenceInput())).not.toContain("\t");
    expect(REFERENCE_CONFIG).not.toContain("\t");
  });

  it("ends with exactly one trailing newline and no carriage returns", () => {
    const rendered = renderPrivacyProxyConfig(referenceInput());
    expect(rendered.endsWith("\n")).toBe(true);
    expect(rendered.endsWith("\n\n")).toBe(false);
    expect(rendered).not.toContain("\r");
  });

  it("is deterministic, so an unchanged configuration hashes the same twice", () => {
    expect(renderPrivacyProxyConfig(referenceInput())).toBe(renderPrivacyProxyConfig(referenceInput()));
  });

  it("sorts exits by key regardless of the order they arrive in", () => {
    const forwards = renderPrivacyProxyConfig(referenceInput());
    const input = referenceInput();
    const backwards = renderPrivacyProxyConfig({ ...input, exits: [...input.exits].reverse() });
    expect(backwards).toBe(forwards);
    expect(forwards.indexOf("EXIT se-sto")).toBeLessThan(forwards.indexOf("EXIT us-nyc"));
  });

  it("drops disabled rules and renumbers the rest densely from 1", () => {
    const rendered = renderPrivacyProxyConfig({
      ...referenceInput(),
      rules: [
        { action: "direct", enabled: false },
        { action: "block", hostname: "ads.example" },
        { action: "direct", enabled: false },
        { action: "direct", hostname: "news.example" },
      ],
    });
    const ruleLines = rendered.split("\n").filter((line) => line.startsWith("RULE "));
    expect(ruleLines).toEqual([
      "RULE 1 block - - - - ads.example -",
      "RULE 2 direct - - - - news.example -",
    ]);
  });

  it("renders every unset optional field as `-`, never as an empty field", () => {
    const rendered = renderPrivacyProxyConfig({
      ...referenceInput(),
      rules: [{ action: "direct" }],
    });
    expect(rendered).toContain("RULE 1 direct - - - - - -\n");
    for (const line of rendered.trimEnd().split("\n")) {
      expect(line.split(" ").some((field) => field === "")).toBe(false);
    }
  });

  it("emits the default limits when none are given, and honours overrides", () => {
    const { maxFlows, idleSeconds, pipeBytes, workers } = PRIVACY_PROXY_DEFAULT_LIMITS;
    expect(renderPrivacyProxyConfig(referenceInput())).toContain(
      `LIMITS ${maxFlows} ${idleSeconds} ${pipeBytes} ${workers}\n`,
    );
    expect(
      renderPrivacyProxyConfig({
        ...referenceInput(),
        limits: { maxFlows: 256, idleSeconds: 90, pipeBytes: 262_144, workers: 2 },
      }),
    ).toContain("LIMITS 256 90 262144 2\n");
  });

  it("renders the default action as the same token the rules use", () => {
    const rendered = renderPrivacyProxyConfig({
      ...referenceInput(),
      defaultAction: "exit",
      defaultExitKey: "se-sto",
    });
    expect(rendered).toContain("DEFAULT exit:se-sto\n");
    expect(renderPrivacyProxyConfig({ ...referenceInput(), defaultAction: "block" })).toContain(
      "DEFAULT block\n",
    );
  });
});

describe("VPN proxy configuration validation", () => {
  const cases: Array<[string, Partial<PrivacyProxyConfigInput>, string]> = [
    ["a privileged listen port", { proxyHttpPort: 80 }, "proxyHttpPort"],
    ["two identical listen ports", { proxyHttpsPort: 8080 }, "must differ"],
    ["an exit key with a space", { exits: [{ key: "us nyc", ifName: "psvpn0" }] }, "exit key"],
    [
      "an interface name that is too long",
      { exits: [{ key: "us-nyc", ifName: "an-interface-name-far-too-long" }] },
      "interface",
    ],
    [
      "a duplicate exit key",
      {
        exits: [
          { key: "dup", ifName: "psvpn0" },
          { key: "dup", ifName: "psvpn1" },
        ],
      },
      "duplicate exit key",
    ],
    ["a default action naming an undeclared exit", { defaultExitKey: "ghost", defaultAction: "exit" }, "undeclared exit"],
    [
      "a rule naming an undeclared exit",
      { rules: [{ action: "exit", exitKey: "ghost" }] },
      "undeclared exit",
    ],
    ["a malformed CIDR", { rules: [{ action: "direct", srcCidr: "10.0.3.999/24" }] }, "octet"],
    ["a prefix length above 32", { rules: [{ action: "direct", dstCidr: "10.0.0.0/33" }] }, "prefix"],
    ["a descending port range", { rules: [{ action: "direct", dportSpec: "500-100" }] }, "port spec"],
    ["a hostname with an underscore", { rules: [{ action: "direct", hostname: "a_b.example" }] }, "hostname"],
    ["a hostname with a space", { rules: [{ action: "direct", hostname: "a b.example" }] }, "hostname"],
    ["a negative rate", { rules: [{ action: "direct", rateKbps: -5 }] }, "rateKbps"],
  ];

  for (const [name, patch, expected] of cases) {
    it(`rejects ${name}`, () => {
      expect(() => renderPrivacyProxyConfig({ ...referenceInput(), ...patch })).toThrow(
        new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    });
  }

  it("rejects a hostname or interface carrying a tab, before it can reach the agent", () => {
    expect(() =>
      renderPrivacyProxyConfig({
        ...referenceInput(),
        rules: [{ action: "direct", hostname: "a\tb.example" }],
      }),
    ).toThrow();
  });

  it("rejects more rules than the agent will carry", () => {
    const rules = Array.from({ length: PRIVACY_PROXY_MAX_RULES + 1 }, () => ({
      action: "direct" as const,
    }));
    expect(() => renderPrivacyProxyConfig({ ...referenceInput(), rules })).toThrow(
      /more than 200 enabled rules/,
    );
  });

  it("rejects more exits than the agent will carry", () => {
    const exits = Array.from({ length: PRIVACY_PROXY_MAX_EXITS + 1 }, (_unused, index) => ({
      key: `e${index}`,
      ifName: `psvpn${index}`,
    }));
    expect(() => renderPrivacyProxyConfig({ ...referenceInput(), exits })).toThrow(/more than 16 exits/);
  });
});

describe("VPN proxy hostname normalisation", () => {
  it("lowercases with an ASCII-only map, matching the Rust parser", () => {
    expect(normalizePrivacyProxyHostname("EXAMPLE.CoM")).toBe("example.com");
    // A Turkish dotless I must not be produced by a locale-aware fold.
    expect(normalizePrivacyProxyHostname("WIFI.EXAMPLE")).toBe("wifi.example");
  });

  it("strips exactly one trailing dot, so a dotted name cannot evade a rule", () => {
    expect(normalizePrivacyProxyHostname("example.com.")).toBe("example.com");
    expect(() => normalizePrivacyProxyHostname("example.com..")).toThrow();
  });

  it("keeps a leading wildcard and normalises the rest", () => {
    expect(normalizePrivacyProxyHostname("*.Example.COM")).toBe("*.example.com");
  });

  it("rejects the shapes the Rust parser also rejects", () => {
    for (const bad of [
      "",
      ".",
      ".example.com",
      "example..com",
      "-example.com",
      "example-.com",
      "exa_mple.com",
      "[2001:db8::1]",
      `${"a".repeat(64)}.example.com`,
      `${"a".repeat(250)}.example.com`,
    ]) {
      expect(() => normalizePrivacyProxyHostname(bad), bad).toThrow();
    }
  });
});

describe("VPN proxy field validators", () => {
  it("accepts the CIDR forms the rule list uses", () => {
    expect(normalizePrivacyProxyCidr("10.0.3.0/24", "src")).toBe("10.0.3.0/24");
    expect(normalizePrivacyProxyCidr("10.0.3.70", "src")).toBe("10.0.3.70");
    expect(normalizePrivacyProxyCidr("0.0.0.0/0", "src")).toBe("0.0.0.0/0");
  });

  it("accepts the port-spec forms the rule list uses", () => {
    expect(normalizePrivacyProxyPortSpec("443")).toBe("443");
    expect(normalizePrivacyProxyPortSpec("80,443")).toBe("80,443");
    expect(normalizePrivacyProxyPortSpec("8000-8100")).toBe("8000-8100");
    expect(normalizePrivacyProxyPortSpec("80,443,8000-8100")).toBe("80,443,8000-8100");
    expect(() => normalizePrivacyProxyPortSpec("70000")).toThrow();
    expect(() => normalizePrivacyProxyPortSpec("")).toThrow();
  });
});
