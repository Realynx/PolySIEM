import { mockOpnsenseSnapshot } from "@/lib/integrations/opnsense/mock";
import type { OpnsenseSnapshot } from "@/lib/integrations/opnsense/sync";
import { mockProxmoxSnapshot } from "@/lib/integrations/proxmox/mock";
import type { ProxmoxSnapshot } from "@/lib/integrations/proxmox/sync";
import { mockUnifiSnapshot } from "@/lib/integrations/unifi/mock";
import type { UnifiSnapshot } from "@/lib/integrations/unifi/sync";
import type { DriverConfig } from "@/lib/integrations/types";
import type { Device } from "@prisma/client";
import {
  DEFAULT_LAB_SIZE,
  LAB_SIZE_PRESETS,
  SCENARIO_PROFILES,
  scenarioOptionsFromMockUrl,
  type LabSize,
  type ScenarioProfile,
} from "@/lib/demo/catalog";
import type {
  IntegrationHealth,
  IntegrationTypeValue,
  LogEntry,
  SecurityTicketDto,
  TicketEvidenceSample,
} from "@/lib/types";
import {
  CURRENT_LAB_BLUEPRINT,
  deriveScenarioBlueprint,
  type BlueprintNetworkCategory,
  type ScenarioBlueprint,
} from "@/lib/demo/blueprint";

export { SCENARIO_PROFILES, scenarioOptionsFromMockUrl } from "@/lib/demo/catalog";
export type { ScenarioProfile } from "@/lib/demo/catalog";

/** Stable incident identities shared by scenario-aware mock integrations. */
export const SCENARIO_MALICIOUS_SOURCE_IP = "185.220.101.34";
export const SCENARIO_PUBLISHED_DOMAIN = "docs.demo.lan";

export interface ScenarioOptions {
  /** Any stable seed. Equal profile + seed + now produces equal output. */
  seed?: string | number;
  profile?: ScenarioProfile;
  /** Clock anchor. Defaults to the current minute for live-looking demos. */
  now?: Date | string | number;
  /** Independent inventory density preset. 3 is the scenario's standard size. */
  size?: LabSize;
}

export interface DemoScenarioIntegrations {
  /** Secret-free configs that can be passed directly to mock-aware drivers. */
  drivers: DriverConfig[];
  /** Dashboard/service DTOs corresponding to the generated driver configs. */
  health: IntegrationHealth[];
}

export interface DemoScenario {
  meta: {
    seed: string;
    profile: ScenarioProfile;
    size: LabSize;
    generatedAt: string;
    description: string;
  };
  blueprint: ScenarioBlueprint;
  inventory: {
    /** Real Device-domain fields, with generated ids and generic names only. */
    devices: Array<Pick<Device, "id" | "name" | "kind" | "source" | "status">>;
  };
  integrations: DemoScenarioIntegrations;
  proxmox: ProxmoxSnapshot;
  opnsense: OpnsenseSnapshot;
  unifi: UnifiSnapshot;
  logs: LogEntry[];
  securityTickets: SecurityTicketDto[];
}

function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash += hash << 13;
  hash ^= hash >>> 7;
  hash += hash << 3;
  hash ^= hash >>> 17;
  hash += hash << 5;
  return hash >>> 0;
}

function normalizeNow(value: ScenarioOptions["now"]): number {
  if (value === undefined) return Math.floor(Date.now() / 60_000) * 60_000;
  const milliseconds =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error("Scenario now must be a valid Date, timestamp, or ISO date");
  }
  return milliseconds;
}

function safeToken(value: string): string {
  const token = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return token.slice(0, 24) || "record";
}

/**
 * Stateless deterministic primitives. Values are keyed rather than pulled
 * from one mutable random stream, so adding a new record family does not shift
 * every existing id or timestamp.
 */
export class ScenarioGenerator {
  readonly seed: string;
  readonly nowMs: number;

  constructor(seed: string | number, now: Date | string | number) {
    this.seed = String(seed);
    this.nowMs = normalizeNow(now);
  }

  private fraction(key: string): number {
    return hash32(`${this.seed}\u0000${key}`) / 0x1_0000_0000;
  }

  id(namespace: string, key: string | number): string {
    const suffix = hash32(`${this.seed}\u0000id\u0000${namespace}\u0000${key}`)
      .toString(36)
      .padStart(7, "0");
    return `demo_${safeToken(namespace)}_${suffix}`;
  }

  integer(key: string, minimum: number, maximum: number): number {
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum < minimum) {
      throw new Error("Scenario integer bounds must be integers with maximum >= minimum");
    }
    return minimum + Math.floor(this.fraction(key) * (maximum - minimum + 1));
  }

  chance(key: string, probability: number): boolean {
    if (probability < 0 || probability > 1) {
      throw new Error("Scenario probability must be between 0 and 1");
    }
    return this.fraction(key) < probability;
  }

  pick<T>(key: string, values: readonly T[]): T {
    if (values.length === 0) throw new Error("Cannot pick from an empty scenario list");
    return values[this.integer(key, 0, values.length - 1)];
  }

  /** A reproducible ISO timestamp in the inclusive age range. */
  timestamp(key: string, minimumAgeMs = 0, maximumAgeMs = minimumAgeMs): string {
    const age = this.integer(
      `timestamp:${key}`,
      Math.max(0, Math.round(minimumAgeMs)),
      Math.max(0, Math.round(maximumAgeMs)),
    );
    return new Date(this.nowMs - age).toISOString();
  }
}

export function createScenarioGenerator(options: ScenarioOptions = {}): ScenarioGenerator {
  const profile = options.profile ?? "current-lab";
  const size = options.size ?? DEFAULT_LAB_SIZE;
  return new ScenarioGenerator(`${profile}:${String(options.seed ?? "polysiem")}:size-${size}`, normalizeNow(options.now));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

type ScenarioSnapshots = {
  proxmox: ProxmoxSnapshot;
  opnsense: OpnsenseSnapshot;
  unifi: UnifiSnapshot;
};

function scaledCount(count: number, size: LabSize): number {
  if (count === 0) return 0;
  return Math.max(1, Math.round(count * LAB_SIZE_PRESETS[size].scale));
}

function scaledMac(family: number, index: number, nicIndex = 0): string {
  const value = index * 8 + nicIndex;
  return `BC:24:11:${family.toString(16).padStart(2, "0").toUpperCase()}:${Math.floor(value / 256).toString(16).padStart(2, "0").toUpperCase()}:${(value % 256).toString(16).padStart(2, "0").toUpperCase()}`;
}

/** Scale inventory density without changing the scenario's health/security story. */
function scaleSnapshots(snapshots: ScenarioSnapshots, size: LabSize): ScenarioSnapshots {
  if (size === DEFAULT_LAB_SIZE) return snapshots;

  const originalNodes = clone(snapshots.proxmox.nodes);
  const originalStorage = clone(snapshots.proxmox.storage);
  const nodeCount = scaledCount(originalNodes.length, size);
  snapshots.proxmox.nodes = Array.from({ length: nodeCount }, (_, index) => {
    const template = clone(originalNodes[index % originalNodes.length]);
    if (index < originalNodes.length) return template;
    const name = `pve${index + 1}`;
    return {
      ...template,
      name,
      interfaces: template.interfaces.map((iface, ifaceIndex) => ({
        ...iface,
        address: iface.address?.replace(/\.\d+$/, `.${20 + index}`) ?? null,
        cidr: iface.cidr?.replace(/\.\d+\//, `.${20 + index}/`) ?? null,
        mac: iface.mac ? scaledMac(0x91, index, ifaceIndex) : null,
      })),
    };
  });
  snapshots.proxmox.storage = snapshots.proxmox.nodes.flatMap((node, index) => {
    const templateNode = originalNodes[index % originalNodes.length].name;
    return originalStorage
      .filter((storage) => storage.node === templateNode)
      .map((storage) => ({ ...clone(storage), node: node.name }));
  });

  const resizeGuests = (kind: "qemu" | "lxc") => {
    const templates = snapshots.proxmox.guests.filter((guest) => guest.kind === kind);
    const count = scaledCount(templates.length, size);
    return Array.from({ length: count }, (_, index) => {
      const guest = clone(templates[index % templates.length]);
      guest.node = snapshots.proxmox.nodes[index % snapshots.proxmox.nodes.length].name;
      if (index >= templates.length) {
        guest.vmid = (kind === "qemu" ? 1_000 : 2_000) + index;
        guest.name = `${kind === "qemu" ? "vm" : "workload"}-${String(index + 1).padStart(2, "0")}`;
        guest.nics = guest.nics.map((nic, nicIndex) => ({
          ...nic,
          mac: nic.mac ? scaledMac(kind === "qemu" ? 0x92 : 0x93, index, nicIndex) : null,
          ip: nic.ip?.replace(/\.\d+$/, `.${50 + (index % 180)}`) ?? null,
        }));
      }
      return guest;
    });
  };
  snapshots.proxmox.guests = [...resizeGuests("qemu"), ...resizeGuests("lxc")];

  const originalRules = clone(snapshots.opnsense.rules);
  snapshots.opnsense.rules = Array.from({ length: scaledCount(originalRules.length, size) }, (_, index) => {
    const rule = clone(originalRules[index % originalRules.length]);
    if (index >= originalRules.length) {
      rule.uuid = `demo-scaled-rule-${size}-${index + 1}`;
      rule.sequence = index + 1;
      rule.description = `Scaled ${rule.description ?? "firewall policy"} ${index + 1}`;
    }
    return rule;
  });

  const originalLeases = clone(snapshots.opnsense.leases);
  snapshots.opnsense.leases = Array.from({ length: scaledCount(originalLeases.length, size) }, (_, index) => {
    const lease = clone(originalLeases[index % originalLeases.length]);
    if (index >= originalLeases.length) {
      lease.ip = `10.0.30.${50 + (index % 180)}`;
      lease.mac = scaledMac(0x94, index);
      lease.hostname = `demo-client-${index + 1}`;
    }
    return lease;
  });

  return snapshots;
}

function applyMinimalProfile({ proxmox, opnsense, unifi }: ScenarioSnapshots): void {
  const nodeName = proxmox.nodes[0]?.name;
  proxmox.nodes = proxmox.nodes.slice(0, 1);
  proxmox.guests = proxmox.guests.filter((guest) => guest.node === nodeName).slice(0, 4);
  proxmox.storage = proxmox.storage.filter((storage) => storage.node === nodeName).slice(0, 3);
  opnsense.interfaces = opnsense.interfaces.filter((iface) => iface.key === "lan" || iface.key === "wan");
  opnsense.rules = opnsense.rules.filter((rule) => rule.interfaceName === "LAN" || rule.interfaceName === "WAN").slice(0, 8);
  opnsense.leases = opnsense.leases.slice(0, 5);
  const leaseIps = new Set(opnsense.leases.map((lease) => lease.ip));
  opnsense.neighbors = opnsense.neighbors.filter((neighbor) => leaseIps.has(neighbor.ip)).slice(0, 5);
  opnsense.portForwards = opnsense.portForwards.slice(0, 1);
  unifi.networks = unifi.networks.slice(0, 1);
  unifi.wlans = unifi.wlans.slice(0, 1);
  unifi.aps = unifi.aps.slice(0, 1);
}

function applyDegradedProfile({ proxmox, opnsense, unifi }: ScenarioSnapshots): void {
  if (proxmox.nodes[1]) proxmox.nodes[1].status = "offline";
  const offlineNode = proxmox.nodes[1]?.name;
  for (const guest of proxmox.guests) if (guest.node === offlineNode) guest.status = "stopped";
  proxmox.errors.push(`Node ${offlineNode ?? "pve2"} did not respond`);
  if (unifi.aps[0]) unifi.aps[0].state = "offline";
  unifi.errors.push("One access point did not answer the controller");
  if (opnsense.gateways[1]) opnsense.gateways[1].online = false;
  opnsense.errors.push("Backup gateway status is unavailable");
}

function profileSnapshots(profile: ScenarioProfile, size: LabSize): ScenarioSnapshots {
  const proxmox = clone(mockProxmoxSnapshot());
  const opnsense = clone(mockOpnsenseSnapshot());
  const unifi = clone(mockUnifiSnapshot());

  if (profile === "current-lab") {
    // Preserve the real demo DTO shapes while matching the current lab's
    // anonymized scale: 7 devices (5 PVE + firewall + manual switch), 4 VMs,
    // 44 containers, 9 networks, 31 rules, and 9 leases. UniFi remains in the
    // integration set but has no AP inventory in this particular profile.
    while (proxmox.nodes.length < 5) {
      const index = proxmox.nodes.length + 1;
      const template = clone(proxmox.nodes.at(-1)!);
      proxmox.nodes.push({
        ...template,
        name: `pve${index}`,
        uptimeSec: (template.uptimeSec ?? 900_000) + index * 10_000,
        interfaces: template.interfaces.map((iface, ifaceIndex) => ({
          ...iface,
          address: iface.address?.replace(/\.\d+$/, `.${10 + index}`) ?? null,
          cidr: iface.cidr?.replace(/\.\d+\//, `.${10 + index}/`) ?? null,
          mac: iface.mac
            ? `BC:24:11:2E:${index.toString(16).padStart(2, "0").toUpperCase()}:${(ifaceIndex + 1).toString(16).padStart(2, "0").toUpperCase()}`
            : null,
        })),
      });
      for (const storage of proxmox.storage.filter((item) => item.node === template.name)) {
        proxmox.storage.push({ ...clone(storage), node: `pve${index}` });
      }
    }
    const qemu = proxmox.guests.filter((guest) => guest.kind === "qemu").slice(0, 4);
    const lxcTemplates = proxmox.guests.filter((guest) => guest.kind === "lxc");
    const workloadVlans = [10, 20, 30, 40, 50, 60, 80] as const;
    const containers = Array.from({ length: 44 }, (_, index) => {
      const template = clone(lxcTemplates[index % lxcTemplates.length]);
      const node = proxmox.nodes[index % proxmox.nodes.length]?.name ?? "pve1";
      const octet = index + 20;
      const vlan = workloadVlans[index % workloadVlans.length];
      return {
        ...template,
        node,
        vmid: 300 + index,
        name: `workload-${String(index + 1).padStart(2, "0")}`,
        description: `Anonymized service workload ${index + 1}`,
        nics: template.nics.map((nic, nicIndex) => ({
          ...nic,
          mac: `BC:24:11:4C:${Math.floor(octet / 256).toString(16).padStart(2, "0").toUpperCase()}:${(octet % 256).toString(16).padStart(2, "0").toUpperCase()}`,
          ip: nicIndex === 0 ? `10.0.${vlan}.${120 + Math.floor(index / 7)}` : null,
          vlanTag: vlan,
        })),
      };
    });
    proxmox.guests = [...qemu, ...containers];

    const extraInterfaces = [
      ["opt4", "SERVICES", "vlan05", "10.0.50.1", 50],
      ["opt5", "STORAGE", "vlan06", "10.0.60.1", 60],
      ["opt6", "VPN", "wg0", "10.0.70.1", null],
      ["opt7", "MANAGEMENT", "vlan08", "10.0.80.1", 80],
    ] as const;
    for (const [key, description, device, ipv4, vlanTag] of extraInterfaces) {
      opnsense.interfaces.push({
        key,
        description,
        device,
        ipv4,
        prefix: 24,
        gateway: null,
        vlanTag,
        enabled: true,
      });
    }
    const ruleTemplate = opnsense.rules.at(-1)!;
    while (opnsense.rules.length < 31) {
      const index = opnsense.rules.length + 1;
      opnsense.rules.push({
        ...clone(ruleTemplate),
        uuid: `f0e1d2c3-${String(index).padStart(4, "0")}-4b02-8d02-${String(index).padStart(12, "0")}`,
        sequence: index,
        interfaceName: extraInterfaces[index % extraInterfaces.length][1],
        action: index % 4 === 0 ? "BLOCK" : "PASS",
        description: `Anonymized policy rule ${index}`,
        raw: { source: "scenario", ordinal: index },
      });
    }
    opnsense.leases = opnsense.leases.slice(0, 9);
    const leaseIps = new Set(opnsense.leases.map((lease) => lease.ip));
    opnsense.neighbors = opnsense.neighbors.filter(
      (neighbor) => neighbor.permanent || leaseIps.has(neighbor.ip),
    );
    unifi.aps = [];
    unifi.devices = [];
    for (const node of proxmox.nodes) node.status = "online";
    for (const ap of unifi.aps) ap.state = "online";
  } else if (profile === "minimal") {
    applyMinimalProfile({ proxmox, opnsense, unifi });
  } else if (profile === "degraded") {
    applyDegradedProfile({ proxmox, opnsense, unifi });
  } else {
    for (const node of proxmox.nodes) node.status = "online";
    for (const ap of unifi.aps) ap.state = "online";
  }

  return scaleSnapshots({ proxmox, opnsense, unifi }, size);
}

const NORMAL_MESSAGES = [
  "Started container health check successfully",
  "Accepted publickey for automation account",
  "Completed scheduled ZFS snapshot",
  "DHCP lease renewed",
  "Reverse proxy upstream responded",
  "Configuration sync completed",
] as const;

const WARNING_MESSAGES = [
  "Container memory usage crossed the warning threshold",
  "Reverse proxy upstream was briefly unavailable",
  "Disk latency exceeded the rolling baseline",
  "Authentication failed for an unknown account",
] as const;

function sourceIp(generator: ScenarioGenerator, key: string): string {
  return `198.51.100.${generator.integer(`${key}:octet`, 10, 240)}`;
}

function normalLog(
  generator: ScenarioGenerator,
  index: number,
  hosts: readonly string[],
  degraded: boolean,
): LogEntry {
  const key = `log:${index}`;
  const warning = degraded
    ? generator.chance(`${key}:warn`, 0.42)
    : generator.chance(`${key}:warn`, 0.16);
  const level = warning ? (generator.chance(`${key}:error`, 0.3) ? "error" : "warn") : "info";
  const message = generator.pick(
    `${key}:message`,
    warning ? WARNING_MESSAGES : NORMAL_MESSAGES,
  );
  const host = generator.pick(`${key}:host`, hosts);
  const timestamp = generator.timestamp(key, 30_000, 24 * 60 * 60_000);
  const day = timestamp.slice(0, 10).replaceAll("-", ".");
  return {
    id: generator.id("log", index),
    timestamp,
    level,
    message,
    host,
    index: `logs-${day}`,
    raw: {
      "@timestamp": timestamp,
      log: { level },
      message,
      host: { name: host },
      event: { dataset: warning ? "system.warning" : "system.activity" },
      agent: { type: "filebeat", version: "8.14.0" },
    },
  };
}

function incidentLog(generator: ScenarioGenerator, index: number): LogEntry {
  const key = `incident:${index}`;
  const source = index % 3 === 0 ? SCENARIO_MALICIOUS_SOURCE_IP : sourceIp(generator, key);
  const timestamp = generator.timestamp(key, 10_000, 55 * 60_000);
  const cloudflare = index % 2 === 0;
  const path = generator.pick(`${key}:path`, [
    "/wp-admin/install.php",
    "/.env",
    "/api/login",
    "/server-status",
  ] as const);
  if (cloudflare) {
    const message = `GET ${path} returned 403`;
    return {
      id: generator.id("incident-log", index),
      timestamp,
      level: "warn",
      message,
      host: "cloudflared",
      index: "cloudflared-demo",
      raw: {
        "@timestamp": timestamp,
        message,
        event: { dataset: "cloudflared.http", action: "http_request" },
        source: { ip: source, geo: { country_name: "United States" } },
        destination: { ip: "10.0.30.80", port: 8080 },
        url: { domain: SCENARIO_PUBLISHED_DOMAIN, path, full: `https://${SCENARIO_PUBLISHED_DOMAIN}${path}` },
        http: { request: { method: "GET" }, response: { status_code: 403 } },
        user_agent: { original: "Mozilla/5.0 zgrab/0.x" },
        host: { name: "cloudflared" },
      },
    };
  }
  const signature = "ET WEB_SERVER Possible Web Application Scan";
  const message = `${signature} ${source} -> 10.0.30.80:8080`;
  return {
    id: generator.id("incident-log", index),
    timestamp,
    level: "error",
    message,
    host: "opnsense",
    index: "logs-suricata-demo",
    raw: {
      "@timestamp": timestamp,
      message,
      event: { dataset: "suricata.eve", category: "intrusion_detection" },
      source: { ip: source, port: generator.integer(`${key}:port`, 30_000, 65_000) },
      destination: { ip: "10.0.30.80", port: 8080 },
      network: { transport: "tcp" },
      suricata: {
        eve: {
          event_type: "alert",
          alert: { signature, category: "Web Application Attack", severity: 2 },
        },
      },
      url: { domain: SCENARIO_PUBLISHED_DOMAIN, path },
      user_agent: { original: "Mozilla/5.0 zgrab/0.x" },
    },
  };
}

function generateLogs(
  generator: ScenarioGenerator,
  profile: ScenarioProfile,
  snapshots: ReturnType<typeof profileSnapshots>,
  size: LabSize,
): LogEntry[] {
  const count = scaledCount(SCENARIO_PROFILES[profile].logCount, size);
  const hosts = [
    ...snapshots.proxmox.nodes.map((node) => node.name),
    ...snapshots.proxmox.guests.map((guest) => guest.name),
    snapshots.opnsense.hostname,
  ];
  const incidentCount = profile === "security-incident" ? 24 : 0;
  const normalCount = count - incidentCount;
  const logs = [
    ...Array.from({ length: normalCount }, (_, index) =>
      normalLog(generator, index, hosts, profile === "degraded"),
    ),
    ...Array.from({ length: incidentCount }, (_, index) =>
      incidentLog(generator, index),
    ),
  ];
  return logs.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

function ticketEvidence(logs: LogEntry[], limit = 10): TicketEvidenceSample[] {
  return logs.slice(0, limit).map((log) => ({
    timestamp: log.timestamp,
    message: log.message,
    index: log.index,
    raw: log.raw,
  }));
}

function scenarioTicket(
  generator: ScenarioGenerator,
  profile: "degraded" | "security-incident",
  logs: LogEntry[],
): SecurityTicketDto {
  const incident = profile === "security-incident";
  const relevant = logs.filter((log) =>
    incident ? log.index.includes("suricata") || log.index.includes("cloudflared") : log.level === "error",
  );
  const createdAt = relevant.at(-1)?.timestamp ?? generator.timestamp("ticket-created", 60_000, 3_600_000);
  const lastSeenAt = relevant[0]?.timestamp ?? createdAt;
  return {
    id: generator.id("security-ticket", profile),
    title: incident ? "Published service is being actively probed" : "Infrastructure health is degraded",
    summary: incident
      ? "Correlated Suricata and Cloudflare events show repeated web-path probing against docs.demo.lan."
      : "A hypervisor, access point, and backup gateway reported availability problems during the same window.",
    severity: incident ? "HIGH" : "MEDIUM",
    status: "OPEN",
    category: incident ? "ids-alert" : "anomaly",
    createdBy: "ai",
    suggestions: incident
      ? "Review the source addresses, verify the published route, and confirm the origin returned no successful responses."
      : "Check pve2 reachability and the controller/gateway health before retrying integration syncs.",
    refs: incident
      ? {
          srcIps: [SCENARIO_MALICIOUS_SOURCE_IP],
          destIps: ["10.0.30.80"],
          signatures: ["ET WEB_SERVER Possible Web Application Scan"],
          hosts: [SCENARIO_PUBLISHED_DOMAIN, "cloudflared"],
        }
      : { hosts: ["pve2", "AP Living Room", "WAN_Backup"] },
    evidence: {
      samples: ticketEvidence(relevant),
      scope: incident ? "suricata,cloudflared" : "general",
      timeRange: { from: createdAt, to: lastSeenAt },
    },
    investigation: null,
    investigatedAt: null,
    investigationStatus: null,
    investigationProgress: null,
    timesSeen: relevant.length,
    lastSeenAt,
    scanRunId: generator.id("scan-run", profile),
    closedAt: null,
    closedByName: null,
    resolution: null,
    createdAt,
    updatedAt: lastSeenAt,
  };
}

const INTEGRATION_TYPES = ["PROXMOX", "OPNSENSE", "UNIFI", "ELASTICSEARCH", "OTX"] as const;

function integrations(
  generator: ScenarioGenerator,
  profile: ScenarioProfile,
  seed: string,
  size: LabSize,
): DemoScenarioIntegrations {
  const mockUrl = `mock://${profile}?seed=${encodeURIComponent(seed)}&size=${size}`;
  const drivers: DriverConfig[] = INTEGRATION_TYPES.map((type) => ({
    id: generator.id("integration", type),
    type,
    name: `${type === "ELASTICSEARCH" ? "Elasticsearch" : type === "OPNSENSE" ? "OPNsense" : type === "PROXMOX" ? "Proxmox" : type === "UNIFI" ? "UniFi" : "AlienVault OTX"} demo`,
    baseUrl: mockUrl,
    credentials: {},
    verifyTls: true,
    settings:
      type === "ELASTICSEARCH"
        ? { indexPattern: "logs-*,cloudflared-*", timestampField: "@timestamp", messageField: "message" }
        : {},
  }));
  const degraded = profile === "degraded";
  const partialTypes = new Set<IntegrationTypeValue>(degraded ? ["PROXMOX", "OPNSENSE", "UNIFI"] : []);
  const health: IntegrationHealth[] = drivers.map((driver) => {
    const live = driver.type === "ELASTICSEARCH" || driver.type === "OTX";
    const partial = partialTypes.has(driver.type);
    return {
      id: driver.id,
      type: driver.type,
      name: driver.name,
      enabled: true,
      lastSyncAt: live ? null : generator.timestamp(`integration:${driver.type}`, 2 * 60_000, 12 * 60_000),
      lastSyncStatus: live ? null : partial ? "PARTIAL" : "SUCCESS",
      lastSyncError: partial ? "One or more demo endpoints did not respond" : null,
    };
  });
  return { drivers, health };
}

function categoryForInterface(description: string): BlueprintNetworkCategory {
  const value = description.toLowerCase();
  if (value.includes("wan")) return "wan";
  if (value.includes("management") || value === "lan") return "management";
  if (value.includes("server")) return "servers";
  if (value.includes("service") || value.includes("dmz")) return "services";
  if (value.includes("iot")) return "iot";
  if (value.includes("guest")) return "guest";
  if (value.includes("vpn")) return "vpn";
  if (value.includes("storage")) return "storage";
  return "other";
}

function blueprintForGeneratedScenario(
  snapshots: ReturnType<typeof profileSnapshots>,
): ScenarioBlueprint {
  const networks = snapshots.opnsense.interfaces.map((iface) => ({
    id: iface.key,
    vlanId: iface.vlanTag,
    category: categoryForInterface(iface.description),
  }));
  const defaultNetwork = snapshots.opnsense.interfaces.find((iface) => iface.key === "lan")?.key;
  const networkForVlan = (vlan: number | null) =>
    snapshots.opnsense.interfaces.find((iface) => iface.vlanTag === vlan)?.key ?? defaultNetwork;
  const networkForIp = (ip: string) => {
    const prefix = ip.split(".").slice(0, 3).join(".");
    return snapshots.opnsense.interfaces.find((iface) => iface.ipv4?.startsWith(`${prefix}.`))?.key ?? null;
  };
  return deriveScenarioBlueprint({
    devices: [
      ...snapshots.proxmox.nodes.map((node) => ({ id: `pve:${node.name}`, kind: "hypervisor", networkIds: defaultNetwork ? [defaultNetwork] : [] })),
      { id: "firewall", kind: "firewall", networkIds: networks.map((network) => network.id) },
      ...snapshots.unifi.aps.map((ap) => ({ id: `ap:${ap.externalId}`, kind: "access_point", networkIds: defaultNetwork ? [defaultNetwork] : [] })),
    ],
    vms: snapshots.proxmox.guests
      .filter((guest) => guest.kind === "qemu")
      .map((guest) => ({
        id: `vm:${guest.vmid}`,
        networkIds: [...new Set(guest.nics.map((nic) => networkForVlan(nic.vlanTag)).filter((id): id is string => Boolean(id)))],
      })),
    containers: snapshots.proxmox.guests
      .filter((guest) => guest.kind === "lxc")
      .map((guest) => ({
        id: `ct:${guest.vmid}`,
        networkIds: [...new Set(guest.nics.map((nic) => networkForVlan(nic.vlanTag)).filter((id): id is string => Boolean(id)))],
      })),
    networks,
    firewallRules: snapshots.opnsense.rules.map((rule) => ({ action: rule.action })),
    dhcpLeases: snapshots.opnsense.leases.map((lease) => ({ networkId: networkForIp(lease.ip) })),
    portForwards: snapshots.opnsense.portForwards.map((forward) => ({ enabled: forward.enabled })),
  });
}

function inventoryForGeneratedScenario(
  generator: ScenarioGenerator,
  profile: ScenarioProfile,
  snapshots: ReturnType<typeof profileSnapshots>,
): DemoScenario["inventory"] {
  const devices: DemoScenario["inventory"]["devices"] = [
    ...snapshots.proxmox.nodes.map((node) => ({
      id: generator.id("device", `pve:${node.name}`),
      name: node.name,
      kind: "hypervisor",
      source: "PROXMOX" as const,
      status: node.status === "offline" ? ("STALE" as const) : ("ACTIVE" as const),
    })),
    {
      id: generator.id("device", "firewall"),
      name: "edge-firewall",
      kind: "firewall",
      source: "OPNSENSE" as const,
      status: "ACTIVE" as const,
    },
    ...snapshots.unifi.aps.map((ap, index) => ({
      id: generator.id("device", `ap:${index}`),
      name: `wireless-ap-${index + 1}`,
      kind: "access-point",
      source: "UNIFI" as const,
      status: ap.state === "offline" ? ("STALE" as const) : ("ACTIVE" as const),
    })),
  ];
  if (profile === "current-lab") {
    devices.push({
      id: generator.id("device", "manual-switch"),
      name: "core-switch",
      kind: "switch",
      source: "MANUAL",
      status: "ACTIVE",
    });
  }
  return { devices };
}

/** Generate one complete, cross-linked mock environment. */
export function generateDemoScenario(options: ScenarioOptions = {}): DemoScenario {
  const profile = options.profile ?? "current-lab";
  const seed = String(options.seed ?? "polysiem");
  const size = options.size ?? DEFAULT_LAB_SIZE;
  const generator = createScenarioGenerator({ ...options, profile, seed, size });
  const snapshots = profileSnapshots(profile, size);
  const logs = generateLogs(generator, profile, snapshots, size);
  const securityTickets =
    profile === "degraded" || profile === "security-incident"
      ? [scenarioTicket(generator, profile, logs)]
      : [];
  return {
    meta: {
      seed,
      profile,
      size,
      generatedAt: new Date(generator.nowMs).toISOString(),
      description: SCENARIO_PROFILES[profile].description,
    },
    blueprint:
      profile === "current-lab" && size === DEFAULT_LAB_SIZE
        ? clone(CURRENT_LAB_BLUEPRINT)
        : blueprintForGeneratedScenario(snapshots),
    inventory: inventoryForGeneratedScenario(generator, profile, snapshots),
    integrations: integrations(generator, profile, seed, size),
    ...snapshots,
    logs,
    securityTickets,
  };
}

export function generateDemoScenarioFromUrl(
  baseUrl: string,
  overrides: Pick<ScenarioOptions, "seed" | "now" | "size"> = {},
): DemoScenario {
  return generateDemoScenario({ ...scenarioOptionsFromMockUrl(baseUrl), ...overrides });
}
