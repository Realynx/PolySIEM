import type { DriverConfig, TestResult } from "../types";
import type { OtxFeedValue, PulseView } from "@/lib/types";
import { extractDomainIocs, extractIpIocs, type IocCandidate } from "./normalize";
import type { PulsePage } from "./client";
import { scenarioOptionsFromMockUrl } from "@/lib/demo/catalog";
import {
  SCENARIO_MALICIOUS_SOURCE_IP,
  SCENARIO_PUBLISHED_DOMAIN,
  createScenarioGenerator,
  generateDemoScenario,
} from "@/lib/demo/scenario";

/** Demo pulse fixtures for mock://demo — timestamps are relative so the feed always looks live. */

type MockScenarioInput = Pick<DriverConfig, "baseUrl"> | string | undefined;

function baseUrlOf(input: MockScenarioInput): string | null {
  return typeof input === "string" ? input : (input?.baseUrl ?? null);
}

function scenarioContext(input: MockScenarioInput) {
  const baseUrl = baseUrlOf(input);
  const options = baseUrl
    ? scenarioOptionsFromMockUrl(baseUrl)
    : { profile: "healthy" as const, seed: "polysiem" };
  const scenario = generateDemoScenario(options);
  return {
    scenario,
    generator: createScenarioGenerator(options),
    /** Preserve the original no-argument/mock://demo fixture identifiers and hit counts. */
    legacy: baseUrl === null || baseUrl.replace(/\/+$/, "") === "mock://demo",
  };
}

function pulse(
  view: Omit<PulseView, "url" | "indicatorCount" | "indicatorTypeCounts">,
): PulseView {
  const typeCounts = new Map<string, number>();
  for (const ind of view.indicators) typeCounts.set(ind.type, (typeCounts.get(ind.type) ?? 0) + 1);
  return {
    ...view,
    indicatorCount: view.indicators.length,
    indicatorTypeCounts: [...typeCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    url: `https://otx.alienvault.com/pulse/${view.id}`,
  };
}

export function mockPulses(input?: MockScenarioInput): PulseView[] {
  const context = scenarioContext(input);
  const anchor = Date.parse(context.scenario.meta.generatedAt);
  const iso = (hoursAgo: number) => new Date(anchor - hoursAgo * 3_600_000).toISOString();
  const pulses = [
    pulse({
      id: "6878f1a2b3c4d5e6f7a80001",
      name: "Tor exit nodes scanning exposed database ports",
      description:
        "Ongoing opportunistic scanning of MySQL, PostgreSQL and Redis ports from Tor exit relays. " +
        "Sources rotate hourly; blocking individual IPs is less effective than restricting inbound " +
        "access to database ports at the perimeter.",
      author: "AlienVault",
      created: iso(6),
      modified: iso(2),
      tlp: "white",
      adversary: null,
      tags: ["tor", "scanner", "mysql", "redis", "bruteforce"],
      targetedCountries: [],
      malwareFamilies: [],
      attackIds: ["T1046", "T1110"],
      references: ["https://metrics.torproject.org/exonerator.html"],
      indicators: [
        { indicator: "185.220.101.34", type: "IPv4", description: "Tor exit relay seen scanning tcp/3306" },
        { indicator: "185.220.101.78", type: "IPv4", description: "Tor exit relay seen scanning tcp/6379" },
        { indicator: "107.189.31.187", type: "IPv4", description: null },
      ],
    }),
    pulse({
      id: "6878f1a2b3c4d5e6f7a80002",
      name: "Mirai variant targeting IoT devices via CVE-2024-3273",
      description:
        "A Mirai-based botnet is exploiting end-of-life D-Link NAS devices. Compromised devices join " +
        "DDoS swarms and scan for further victims on tcp/80 and tcp/8080.",
      author: "AlienVault",
      created: iso(18),
      modified: iso(12),
      tlp: "green",
      adversary: null,
      tags: ["mirai", "botnet", "iot", "cve-2024-3273", "ddos"],
      targetedCountries: [],
      malwareFamilies: ["Mirai"],
      attackIds: ["T1190", "T1498"],
      references: ["https://nvd.nist.gov/vuln/detail/CVE-2024-3273"],
      indicators: [
        { indicator: "45.148.10.192", type: "IPv4", description: "C2 / loader" },
        { indicator: "weaknetworks.duckdns.org", type: "hostname", description: "C2 rendezvous" },
        {
          indicator: "5f4dcc3b5aa765d61d8327deb882cf992a3b1c1e4f5a6d7e8f9a0b1c2d3e4f5a",
          type: "FileHash-SHA256",
          description: "armv7 dropper",
        },
      ],
    }),
    pulse({
      id: "6878f1a2b3c4d5e6f7a80003",
      name: "Phishing campaign impersonating Nextcloud login pages",
      description:
        "Credential-harvesting kit cloning self-hosted Nextcloud login portals, distributed via " +
        "typosquatted domains. Targets homelab and small-business instances exposed to the internet.",
      author: "SecOpsResearch",
      created: iso(30),
      modified: iso(26),
      tlp: "amber",
      adversary: null,
      tags: ["phishing", "nextcloud", "credential-theft", "typosquatting"],
      targetedCountries: ["United States", "Germany"],
      malwareFamilies: [],
      attackIds: ["T1566.002", "T1056"],
      references: [],
      indicators: [
        { indicator: "nextc1oud-login.com", type: "domain", description: "typosquat serving the kit" },
        { indicator: "next-cloud-verify.net", type: "domain", description: null },
        { indicator: "91.92.240.116", type: "IPv4", description: "kit hosting" },
        { indicator: "https://nextc1oud-login.com/index.php/login", type: "URL", description: null },
      ],
    }),
    pulse({
      id: "6878f1a2b3c4d5e6f7a80004",
      name: "APT-C-36 renewed spearphishing against energy sector",
      description:
        "Blind Eagle (APT-C-36) resumed spearphishing with fiscal-themed lures delivering AsyncRAT " +
        "through obfuscated VBS loaders staged on public file-sharing services.",
      author: "ThreatWatchCo",
      created: iso(52),
      modified: iso(44),
      tlp: "green",
      adversary: "Blind Eagle",
      tags: ["apt-c-36", "asyncrat", "spearphishing", "energy"],
      targetedCountries: ["Colombia", "Ecuador"],
      malwareFamilies: ["AsyncRAT"],
      attackIds: ["T1566.001", "T1059.005"],
      references: ["https://attack.mitre.org/groups/G0099/"],
      indicators: [
        { indicator: "23.95.226.147", type: "IPv4", description: "AsyncRAT C2" },
        { indicator: "fiscalia-notificaciones.info", type: "domain", description: "lure domain" },
        {
          indicator: "9b74c9897bac770ffc029102a200c5de1a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d",
          type: "FileHash-SHA256",
          description: "VBS loader",
        },
      ],
    }),
    pulse({
      id: "6878f1a2b3c4d5e6f7a80005",
      name: "SSH brute-force wave from bulletproof hosting ranges",
      description:
        "Large distributed SSH password-guessing wave against port 22 and common alternate ports. " +
        "Attempts use breached credential lists; fail2ban-style lockouts and key-only auth mitigate.",
      author: "AlienVault",
      created: iso(70),
      modified: iso(65),
      tlp: "white",
      adversary: null,
      tags: ["ssh", "bruteforce", "credential-stuffing"],
      targetedCountries: [],
      malwareFamilies: [],
      attackIds: ["T1110.004", "T1021.004"],
      references: [],
      indicators: [
        { indicator: "80.94.95.181", type: "IPv4", description: null },
        { indicator: "193.32.162.74", type: "IPv4", description: null },
        { indicator: "141.98.10.60", type: "IPv4", description: null },
      ],
    }),
  ];

  if (context.scenario.meta.profile === "security-incident") {
    pulses[0] = pulse({
      id: context.generator.id("otx-pulse", "published-service-scan"),
      name: "Web scanners probing published self-hosted services",
      description:
        `Active scanning infrastructure is probing common administrative and secret-file paths. ` +
        `The source has been observed against ${SCENARIO_PUBLISHED_DOMAIN} in the matching demo logs.`,
      author: "AlienVault",
      created: context.generator.timestamp("otx-incident-created", 8 * 3_600_000, 12 * 3_600_000),
      modified: context.generator.timestamp("otx-incident-modified", 30 * 60_000, 2 * 3_600_000),
      tlp: "white",
      adversary: null,
      tags: ["scanner", "web", "suricata", "cloudflare"],
      targetedCountries: [],
      malwareFamilies: [],
      attackIds: ["T1046", "T1190"],
      references: [],
      indicators: [
        {
          indicator: SCENARIO_MALICIOUS_SOURCE_IP,
          type: "IPv4",
          description: `Observed probing ${SCENARIO_PUBLISHED_DOMAIN}`,
        },
      ],
    });
  }

  const bounded = context.scenario.meta.profile === "minimal" ? pulses.slice(0, 2) : pulses;
  if (context.legacy) return bounded;
  return bounded.map((item, index) => {
    // Incident pulse already uses the shared generator id; seed the remaining
    // fixture ids so parallel scenarios never collide in the cache.
    if (context.scenario.meta.profile === "security-incident" && index === 0) return item;
    const id = context.generator.id("otx-pulse", index);
    return { ...item, id, url: `https://otx.alienvault.com/pulse/${id}` };
  });
}

export function mockTestConnection(input?: MockScenarioInput): TestResult {
  const { scenario } = scenarioContext(input);
  return {
    ok: true,
    detail: `Authenticated as demo (${scenario.meta.profile} scenario, mock data)`,
  };
}

export function mockFetchPulses(
  opts: { feed: OtxFeedValue; page: number; limit: number },
  input?: MockScenarioInput,
): PulsePage {
  const all = mockPulses(input);
  const start = (opts.page - 1) * opts.limit;
  const pulses = all.slice(start, start + opts.limit);
  return {
    pulses,
    iocs: extractIpIocs(pulses),
    domainIocs: extractDomainIocs(pulses),
    indicatorsByPulse: Object.fromEntries(pulses.map((p) => [p.id, p.indicators])),
    totalCount: all.length,
    hasMore: start + opts.limit < all.length,
  };
}

/** Demo IOC hits: the Tor exit relay from the mock Suricata data appears in the logs. */
export function mockIocHits(input?: MockScenarioInput): { ip: string; count: number; samples: { timestamp: string; message: string; index: string }[] } [] {
  const context = scenarioContext(input);
  if (!context.legacy) {
    const hits = context.scenario.logs.filter((log) => {
      const source = log.raw?.source;
      return (
        source &&
        typeof source === "object" &&
        (source as { ip?: unknown }).ip === SCENARIO_MALICIOUS_SOURCE_IP
      );
    });
    return hits.length
      ? [
          {
            ip: SCENARIO_MALICIOUS_SOURCE_IP,
            count: hits.length,
            samples: hits.slice(0, 5).map((log) => ({
              timestamp: log.timestamp,
              message: log.message,
              index: log.index,
            })),
          },
        ]
      : [];
  }
  const iso = (hoursAgo: number) =>
    new Date(Date.parse(context.scenario.meta.generatedAt) - hoursAgo * 3_600_000).toISOString();
  return [
    {
      ip: "185.220.101.34",
      count: 47,
      samples: [
        {
          timestamp: iso(1),
          message: "ET SCAN Suspicious inbound to mySQL port 3306 185.220.101.34:41022 -> 10.0.20.15:3306 TCP",
          index: "logs-suricata-demo",
        },
        {
          timestamp: iso(3),
          message: "ET SCAN Suspicious inbound to mySQL port 3306 185.220.101.34:48711 -> 10.0.20.15:3306 TCP",
          index: "logs-suricata-demo",
        },
      ],
    },
  ];
}

export type { IocCandidate };
