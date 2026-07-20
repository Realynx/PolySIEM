/**
 * Server-side data gathering for the research tools. Each function returns a
 * plain JSON-safe object; the pure shaping logic lives in ./identity.ts and
 * ./external-parse.ts so it stays unit-testable. All queries are read-only and
 * reuse the existing service/integration layer.
 */
import "server-only";
import { prisma } from "@/lib/db";
import { getField } from "@/lib/integrations/elasticsearch/client";
import { esFetch } from "@/lib/integrations/elasticsearch/client";
import { detectSources } from "@/lib/integrations/elasticsearch/detect";
import { isMock } from "@/lib/integrations/types";
import { mockFetchPulses } from "@/lib/integrations/otx";
import { elasticsearchSettingsSchema } from "@/lib/validators/integrations";
import { resolveLogSource } from "@/lib/services/logs";
import { resolveOtxSource } from "@/lib/services/threat-intel";
import * as inventory from "@/lib/services/inventory";
import { cidrContains, parseCidr } from "@/lib/topology/access";
import {
  resolveIpIdentity,
  type IdentityInput,
  type IdentityResult,
} from "@/lib/ai/agent/identity";

/* ----------------------------- IP identity -------------------------------- */

export interface IpIdentityReport extends IdentityResult {
  supporting: {
    ipRecords: number;
    dhcpLeases: number;
    neighbors: number;
    macAddresses: string[];
  };
}

/** Query inventory for everything we know about an address, then resolve identity. */
export async function gatherIpIdentity(ip: string): Promise<IpIdentityReport> {
  const [networks, ipRows, leases, neighbors] = await Promise.all([
    prisma.network.findMany({
      where: { status: { not: "REMOVED" } },
      select: { name: true, cidr: true, vlanId: true },
    }),
    prisma.ipAddress.findMany({
      where: { address: ip },
      select: {
        network: { select: { name: true, vlanId: true } },
        interface: {
          select: {
            macAddress: true,
            device: { select: { name: true } },
            vm: { select: { name: true } },
            container: { select: { name: true } },
          },
        },
      },
    }),
    prisma.dhcpLease.findMany({
      where: { ipAddress: ip, status: { not: "REMOVED" } },
      select: { hostname: true, macAddress: true, isStatic: true, network: { select: { name: true } } },
    }),
    prisma.networkNeighbor.findMany({
      where: { ipAddress: ip, status: { not: "REMOVED" } },
      select: {
        hostname: true,
        macAddress: true,
        manufacturer: true,
        permanent: true,
        network: { select: { name: true } },
      },
    }),
  ]);

  const input: IdentityInput = {
    ip,
    networks: networks.map((n) => ({ name: n.name, cidr: n.cidr, vlanId: n.vlanId })),
    ipRecords: ipRows.map((r) => {
      const iface = r.interface;
      const owner = iface?.device ?? iface?.vm ?? iface?.container ?? null;
      const ownerKind = iface?.device ? "device" : iface?.vm ? "vm" : iface?.container ? "container" : null;
      return {
        networkName: r.network?.name ?? null,
        networkCidr: null,
        vlanId: r.network?.vlanId ?? null,
        ownerKind,
        ownerName: owner?.name ?? null,
        macAddress: iface?.macAddress ?? null,
      };
    }),
    leases: leases.map((l) => ({
      hostname: l.hostname,
      macAddress: l.macAddress,
      isStatic: l.isStatic,
      networkName: l.network?.name ?? null,
    })),
    neighbors: neighbors.map((n) => ({
      hostname: n.hostname,
      macAddress: n.macAddress,
      manufacturer: n.manufacturer,
      permanent: n.permanent,
      networkName: n.network?.name ?? null,
    })),
  };

  const result = resolveIpIdentity(input);
  const macs = [
    ...new Set(
      [
        ...ipRows.map((r) => r.interface?.macAddress),
        ...leases.map((l) => l.macAddress),
        ...neighbors.map((n) => n.macAddress),
      ].filter((m): m is string => Boolean(m)),
    ),
  ];

  return {
    ...result,
    supporting: {
      ipRecords: ipRows.length,
      dhcpLeases: leases.length,
      neighbors: neighbors.length,
      macAddresses: macs,
    },
  };
}

/* ------------------------------- query logs ------------------------------- */

const SIGNATURE_FIELDS = ["suricata.eve.alert.signature", "alert.signature", "rule.name"];
const IP_FIELDS = ["source.ip", "destination.ip", "suricata.eve.src_ip", "suricata.eve.dest_ip", "src_ip", "dest_ip"];
const DEST_PORT_FIELDS = ["destination.port", "suricata.eve.dest_port", "dest_port"];
const EVENT_TYPE_FIELDS = ["event.dataset", "event.type", "suricata.eve.event_type", "event.category"];
const HOSTNAME_FIELDS = ["url.domain", "http.hostname", "dns.question.name"];

function looksLikeIp(term: string): boolean {
  return parseCidr(term) !== null;
}

function bump(map: Map<string, number>, key: string | null, by = 1): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + by);
}

function topN(map: Map<string, number>, n: number): Array<{ value: string; count: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

export interface LogQueryReport {
  term: string;
  scope: string;
  hours: number;
  source: string | null;
  totalMatches: number;
  sampled: number;
  topEventTypes: Array<{ value: string; count: number }>;
  topPorts: Array<{ value: string; count: number }>;
  signatures: Array<{ value: string; count: number }>;
  hostnames: Array<{ value: string; count: number }>;
  peerIps: Array<{ value: string; count: number }>;
  samples: string[];
  note?: string;
}

interface EsHit {
  _index: string;
  _source?: Record<string, unknown>;
}
interface EsSearchResponse {
  hits?: { total?: { value?: number } | number; hits?: EsHit[] };
}

function totalOf(res: EsSearchResponse): number {
  const total = res.hits?.total;
  return typeof total === "number" ? total : (total?.value ?? 0);
}

function firstField(source: Record<string, unknown>, paths: string[]): string | null {
  for (const path of paths) {
    const value = getField(source, path);
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return null;
}

const MOCK_LOG_REPORT: Omit<LogQueryReport, "term" | "scope" | "hours"> = {
  source: "mock://elasticsearch",
  totalMatches: 47,
  sampled: 47,
  topEventTypes: [{ value: "alert", count: 47 }],
  topPorts: [{ value: "3306", count: 47 }],
  signatures: [{ value: "ET SCAN Suspicious inbound to mySQL port 3306", count: 47 }],
  hostnames: [],
  peerIps: [
    { value: "185.220.101.34", count: 47 },
    { value: "10.0.20.15", count: 47 },
  ],
  samples: [
    "ET SCAN Suspicious inbound to mySQL port 3306 185.220.101.34:41022 -> 10.0.20.15:3306 TCP",
    "ET SCAN Suspicious inbound to mySQL port 3306 185.220.101.34:41044 -> 10.0.20.15:3306 TCP",
  ],
};

/**
 * Aggregate the log source for an IP/term across the scan window: top event
 * types, ports, IDS signatures, cloudflared hostnames, peer IPs, and sample
 * messages. Time-bounded and size-capped.
 */
export async function queryLogsForTerm(
  term: string,
  hours = 24,
  scope = "all",
): Promise<LogQueryReport> {
  const cfg = await resolveLogSource();
  if (isMock(cfg)) {
    return { term, scope, hours, ...MOCK_LOG_REPORT };
  }

  const s = elasticsearchSettingsSchema.parse(cfg.settings ?? {});
  const now = Date.now();
  const fromIso = new Date(now - hours * 3_600_000).toISOString();
  const toIso = new Date(now).toISOString();
  const size = 60;

  const should: unknown[] = [];
  if (looksLikeIp(term)) {
    for (const field of IP_FIELDS) should.push({ term: { [field]: term } });
  }
  should.push({
    simple_query_string: {
      query: term,
      fields: ["*"],
      default_operator: "and",
      lenient: true,
      analyze_wildcard: false,
      flags: "NONE",
    },
  });

  const detected = scope === "all" ? null : await detectSources(cfg);
  const indexPattern =
    scope === "cloudflared"
      ? detected?.cloudflared ?? s.cloudflaredIndexPattern
      : scope === "suricata"
        ? detected?.suricata ?? s.indexPattern
        : s.indexPattern;

  let res: EsSearchResponse;
  try {
    res = await esFetch<EsSearchResponse>(
      cfg,
      `/${encodeURIComponent(indexPattern)}/_search?ignore_unavailable=true&allow_no_indices=true`,
      {
        size,
        _source: [
          ...new Set([
            s.timestampField,
            s.messageField,
            ...SIGNATURE_FIELDS,
            ...IP_FIELDS,
            ...DEST_PORT_FIELDS,
            ...EVENT_TYPE_FIELDS,
            ...HOSTNAME_FIELDS,
          ]),
        ],
        track_total_hits: 10_000,
        timeout: "5s",
        terminate_after: 10_000,
        sort: [{ [s.timestampField]: { order: "desc", unmapped_type: "date" } }],
        query: {
          bool: {
            should,
            minimum_should_match: 1,
            filter: [{ range: { [s.timestampField]: { gte: fromIso, lte: toIso } } }],
          },
        },
      },
    );
  } catch (err) {
    return {
      term,
      scope,
      hours,
      source: cfg.name,
      totalMatches: 0,
      sampled: 0,
      topEventTypes: [],
      topPorts: [],
      signatures: [],
      hostnames: [],
      peerIps: [],
      samples: [],
      note: err instanceof Error ? err.message : "log query failed",
    };
  }

  const hits = res.hits?.hits ?? [];
  const eventTypes = new Map<string, number>();
  const ports = new Map<string, number>();
  const signatures = new Map<string, number>();
  const hostnames = new Map<string, number>();
  const peers = new Map<string, number>();
  const samples: string[] = [];

  for (const hit of hits) {
    const source = hit._source ?? {};
    bump(eventTypes, firstField(source, EVENT_TYPE_FIELDS) ?? hit._index);
    bump(ports, firstField(source, DEST_PORT_FIELDS));
    bump(signatures, firstField(source, SIGNATURE_FIELDS));
    bump(hostnames, firstField(source, HOSTNAME_FIELDS));
    // Peer IPs = the IP fields that are NOT the queried term.
    for (const field of IP_FIELDS) {
      const value = firstField(source, [field]);
      if (value && value !== term) bump(peers, value);
    }
    if (samples.length < 8) {
      const sig = firstField(source, SIGNATURE_FIELDS);
      const msg = firstField(source, [s.messageField, "message", "event.original"]);
      const line = sig ?? msg ?? JSON.stringify(source).slice(0, 200);
      samples.push(line.slice(0, 300));
    }
  }

  return {
    term,
    scope,
    hours,
    source: cfg.name,
    totalMatches: totalOf(res),
    sampled: hits.length,
    topEventTypes: topN(eventTypes, 6),
    topPorts: topN(ports, 8),
    signatures: topN(signatures, 8),
    hostnames: topN(hostnames, 8),
    peerIps: topN(peers, 8),
    samples,
    note: hits.length === 0 ? "no matching log events in the window" : undefined,
  };
}

/* ----------------------------- threat intel ------------------------------- */

interface CachedPulseData {
  view: { id: string; name: string };
  ips: string[];
  domains: string[];
}

export interface ThreatIntelReport {
  indicator: string;
  isKnownIoc: boolean;
  pulses: string[];
  pulsesConsidered: number;
  source: string | null;
  note?: string;
}

const MATCH_POOL = 100;

/** Does this IP/domain appear in the cached OTX pulses? Returns pulse names. */
export async function checkThreatIntel(indicator: string, userId?: string): Promise<ThreatIntelReport> {
  let cfg;
  try {
    cfg = await resolveOtxSource(undefined, userId);
  } catch {
    return { indicator, isKnownIoc: false, pulses: [], pulsesConsidered: 0, source: null, note: "no OTX source configured" };
  }

  if (isMock(cfg)) {
    const page = mockFetchPulses(
      { feed: "activity", page: 1, limit: 50 },
      cfg,
    );
    const needle = indicator.trim().toLowerCase();
    const matched = page.pulses.filter((pulse) =>
      pulse.indicators.some(
        (candidate) => candidate.indicator.toLowerCase() === needle,
      ),
    );
    return {
      indicator,
      isKnownIoc: matched.length > 0,
      pulses: matched.map((pulse) => pulse.name),
      pulsesConsidered: page.totalCount,
      source: cfg.name,
    };
  }

  const rows = await prisma.otxPulseCache.findMany({
    where: { sourceKey: cfg.id },
    orderBy: { modified: "desc" },
    take: MATCH_POOL,
    select: { data: true },
  });

  const needle = indicator.trim().toLowerCase();
  const pulses = new Set<string>();
  for (const row of rows) {
    const data = row.data as unknown as CachedPulseData;
    const inIps = data.ips?.some((ip) => ip.toLowerCase() === needle);
    const inDomains = data.domains?.some((d) => d.toLowerCase() === needle);
    if (inIps || inDomains) pulses.add(data.view.name);
  }

  return {
    indicator,
    isKnownIoc: pulses.size > 0,
    pulses: [...pulses],
    pulsesConsidered: rows.length,
    source: cfg.name,
    note: rows.length === 0 ? "OTX pulse cache is empty" : undefined,
  };
}

/* --------------------------- firewall context ----------------------------- */

/** Best-effort: does a firewall spec token reference this address? */
function specReferencesIp(spec: string | null, ip: string): boolean {
  if (!spec) return false;
  for (const token of spec.split(",").map((t) => t.trim()).filter(Boolean)) {
    if (token === ip) return true;
    if (token.includes("/") && parseCidr(token) && cidrContains(token, ip)) return true;
  }
  return false;
}

export interface FirewallContextReport {
  ip: string;
  rules: Array<{
    id: string;
    action: string;
    interfaceName: string | null;
    protocol: string | null;
    sourceSpec: string | null;
    destSpec: string | null;
    destPort: string | null;
    description: string | null;
    enabled: boolean;
  }>;
  portForwards: Array<{
    id: string;
    interfaceName: string | null;
    protocol: string | null;
    destPort: string | null;
    targetIp: string;
    targetPort: string | null;
    description: string | null;
    enabled: boolean;
  }>;
  dyndnsHosts: Array<{ hostname: string; currentIp: string | null; service: string | null }>;
  gateways: Array<{ name: string; ipAddress: string | null; isDefault: boolean; online: boolean | null }>;
}

/** Firewall rules, port-forwards, dyndns hosts, and gateways touching an IP. */
export async function getFirewallContextForIp(ip: string): Promise<FirewallContextReport> {
  const [rules, portForwards, dyndns, gateways] = await Promise.all([
    inventory.listFirewallRules(),
    prisma.portForward.findMany({
      where: { status: { not: "REMOVED" } },
      select: {
        id: true,
        interfaceName: true,
        protocol: true,
        destSpec: true,
        sourceSpec: true,
        destPort: true,
        targetIp: true,
        targetPort: true,
        descriptionText: true,
        enabled: true,
      },
    }),
    prisma.dyndnsHost.findMany({
      where: { currentIp: ip, status: { not: "REMOVED" } },
      select: { hostname: true, currentIp: true, service: true },
    }),
    prisma.networkGateway.findMany({
      where: { ipAddress: ip, status: { not: "REMOVED" } },
      select: { name: true, ipAddress: true, isDefault: true, online: true },
    }),
  ]);

  const matchedRules = (rules as Array<Record<string, unknown>>)
    .filter((r) => specReferencesIp(r.sourceSpec as string | null, ip) || specReferencesIp(r.destSpec as string | null, ip))
    .slice(0, 25)
    .map((r) => ({
      id: r.id as string,
      action: r.action as string,
      interfaceName: (r.interfaceName as string | null) ?? null,
      protocol: (r.protocol as string | null) ?? null,
      sourceSpec: (r.sourceSpec as string | null) ?? null,
      destSpec: (r.destSpec as string | null) ?? null,
      destPort: (r.destPort as string | null) ?? null,
      description: (r.descriptionText as string | null) ?? null,
      enabled: Boolean(r.enabled),
    }));

  const matchedForwards = portForwards
    .filter((pf) => pf.targetIp === ip || specReferencesIp(pf.destSpec, ip) || specReferencesIp(pf.sourceSpec, ip))
    .slice(0, 25)
    .map((pf) => ({
      id: pf.id,
      interfaceName: pf.interfaceName,
      protocol: pf.protocol,
      destPort: pf.destPort,
      targetIp: pf.targetIp,
      targetPort: pf.targetPort,
      description: pf.descriptionText,
      enabled: pf.enabled,
    }));

  return {
    ip,
    rules: matchedRules,
    portForwards: matchedForwards,
    dyndnsHosts: dyndns.map((d) => ({ hostname: d.hostname, currentIp: d.currentIp, service: d.service })),
    gateways: gateways.map((g) => ({ name: g.name, ipAddress: g.ipAddress, isDefault: g.isDefault, online: g.online })),
  };
}
