import { Prisma, type FirewallAction } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isMock, type DriverConfig } from "../types";
import { networkCidrOf, pickNetworkForIp } from "../net";
import {
  loadNetworkRefs,
  newCounts,
  syncInterfaces,
  type DesiredInterface,
  type SyncStats,
} from "../sync-helpers";

// ---------- normalized snapshot ----------

export interface OpnInterface {
  /** OPNsense interface key: lan, wan, opt1 … */
  key: string;
  /** Friendly name: LAN, IOT, DMZ … */
  description: string;
  /** Underlying device: igb0, vlan01 … */
  device: string | null;
  /** Interface IPv4 (the firewall's own address on that segment). */
  ipv4: string | null;
  prefix: number | null;
  /** Upstream gateway (WAN-style interfaces only). */
  gateway: string | null;
  vlanTag: number | null;
  enabled: boolean;
}

export interface OpnRule {
  uuid: string;
  sequence: number | null;
  action: FirewallAction;
  /** Friendly interface name the rule is bound to (grouping key). */
  interfaceName: string | null;
  direction: string | null;
  protocol: string | null;
  sourceSpec: string | null;
  destSpec: string | null;
  destPort: string | null;
  description: string | null;
  enabled: boolean;
  raw: Record<string, unknown>;
}

export interface OpnAlias {
  uuid: string;
  name: string;
  aliasType: string | null;
  content: string[];
  description: string | null;
  enabled: boolean;
}

export interface OpnLease {
  ip: string;
  mac: string | null;
  hostname: string | null;
  isStatic: boolean;
}

/** ARP/neighbor-table entry — a device the firewall has actually seen. */
export interface OpnNeighbor {
  ip: string;
  mac: string | null;
  hostname: string | null;
  manufacturer: string | null;
  /** Firewall-side interface device, e.g. "vlan0.1". */
  interfaceKey: string | null;
  /** Permanent entries are the firewall's own addresses. */
  permanent: boolean;
}

export interface OpnPortForward {
  uuid: string;
  sequence: number | null;
  /** Friendly interface name the rule is bound to. */
  interfaceName: string | null;
  protocol: string | null;
  /** Inbound source restriction spec, if any. */
  sourceSpec: string | null;
  /** WAN-side destination spec (usually "wanip"). */
  destSpec: string | null;
  /** WAN-side port. */
  destPort: string | null;
  targetIp: string;
  targetPort: string | null;
  description: string | null;
  enabled: boolean;
  raw: Record<string, unknown>;
}

export interface OpnDyndns {
  accountUuid: string;
  /** One entry per hostname (accounts may carry comma-separated lists). */
  hostname: string;
  service: string | null;
  enabled: boolean;
  interfaceName: string | null;
  currentIp: string | null;
}

export interface OpnGateway {
  uuid: string;
  name: string;
  interfaceName: string | null;
  ipAddress: string | null;
  isDefault: boolean;
  online: boolean | null;
  raw: Record<string, unknown>;
}

/** Optional feature keys that can be skipped for missing API privileges. */
export type OpnFeature = "dyndns" | "portForwards" | "gateways" | "neighbors";

export interface SkippedFeature {
  feature: OpnFeature;
  /** Human-readable OPNsense privilege name to grant, e.g. "Services: Dynamic DNS". */
  missingPrivilege: string;
}

export interface OpnsenseSnapshot {
  hostname: string;
  version: string | null;
  interfaces: OpnInterface[];
  rules: OpnRule[];
  aliases: OpnAlias[];
  leases: OpnLease[];
  neighbors: OpnNeighbor[];
  portForwards: OpnPortForward[];
  dyndnsHosts: OpnDyndns[];
  gateways: OpnGateway[];
  /** Partial-fetch failures — a non-empty list yields a PARTIAL run. */
  errors: string[];
  /**
   * Optional features the API key lacks privileges for (403). Unlike `errors`,
   * skips keep the run SUCCESS — but their families are excluded from the
   * stale sweep so existing rows are never aged out by a permissions gap.
   */
  skippedFeatures: SkippedFeature[];
}

/** Fetch a normalized snapshot: demo fixtures for mock:// configs, live API otherwise. */
export async function fetchOpnsenseSnapshot(cfg: DriverConfig): Promise<OpnsenseSnapshot> {
  if (isMock(cfg)) {
    const { generateDemoScenarioFromUrl } = await import("@/lib/demo/scenario");
    return generateDemoScenarioFromUrl(cfg.baseUrl).opnsense;
  }
  const { fetchOpnsenseSnapshotFromApi } = await import("./client");
  return fetchOpnsenseSnapshotFromApi(cfg);
}

// ---------- database mapping ----------

/**
 * Upsert an OPNsense snapshot: the firewall Device, one Network per
 * addressed interface, the firewall's own NetworkInterfaces, firewall rules,
 * aliases and DHCP leases. User-owned fields (description, annotation,
 * purpose, location, tags) are never overwritten on existing rows —
 * `descriptionText` on rules/aliases carries the upstream description and is
 * integration-owned, while `annotation` belongs to PolySIEM operators.
 */
export async function applyOpnsenseSnapshot(
  integrationId: string,
  snap: OpnsenseSnapshot,
  runStart: Date,
  complete: boolean,
): Promise<SyncStats> {
  const stats: SyncStats = {
    devices: newCounts(),
    networks: newCounts(),
    interfaces: newCounts(),
    firewallRules: newCounts(),
    firewallAliases: newCounts(),
    dhcpLeases: newCounts(),
    neighbors: newCounts(),
    portForwards: newCounts(),
    dyndnsHosts: newCounts(),
    gateways: newCounts(),
  };
  const seen = { status: "ACTIVE" as const, missCount: 0, lastSeenAt: runStart };

  // -- The firewall itself as a Device --
  let firewallDeviceId: string;
  {
    const externalId = "firewall";
    const data = {
      name: snap.hostname,
      kind: "firewall",
      source: "OPNSENSE" as const,
      ...seen,
      osName: "OPNsense",
      osVersion: snap.version,
      metadata: { interfaces: snap.interfaces.map((i) => i.key) } as Prisma.InputJsonValue,
    };
    const existing = await prisma.device.findUnique({
      where: { integrationId_externalId: { integrationId, externalId } },
      select: { id: true },
    });
    if (existing) {
      await prisma.device.update({ where: { id: existing.id }, data });
      firewallDeviceId = existing.id;
      stats.devices.updated++;
    } else {
      const created = await prisma.device.create({ data: { ...data, integrationId, externalId } });
      firewallDeviceId = created.id;
      stats.devices.created++;
    }
  }

  // -- Networks (one per addressed interface) --
  {
    const existing = await prisma.network.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.map((e) => [e.externalId, e.id]));
    await prisma.$transaction(
      async (tx) => {
        for (const iface of snap.interfaces) {
          if (!iface.ipv4 || iface.prefix === null) continue;
          const cidr = networkCidrOf(iface.ipv4, iface.prefix);
          if (!cidr) continue;
          const isWan = iface.key === "wan";
          const data = {
            name: iface.description || iface.key.toUpperCase(),
            vlanId: iface.vlanTag,
            cidr,
            // On LAN-side segments the firewall interface IP is the gateway.
            gateway: isWan ? iface.gateway : iface.ipv4,
            source: "OPNSENSE" as const,
            ...seen,
            metadata: {
              interfaceKey: iface.key,
              device: iface.device,
              firewallIp: iface.ipv4,
              enabled: iface.enabled,
            } as Prisma.InputJsonValue,
          };
          const id = byExt.get(iface.key);
          if (id) {
            await tx.network.update({ where: { id }, data });
            stats.networks.updated++;
          } else {
            await tx.network.create({ data: { ...data, integrationId, externalId: iface.key } });
            stats.networks.created++;
          }
        }
      },
      { timeout: 30_000 },
    );
  }

  // -- Firewall's own interfaces (link to networks incl. the ones just created) --
  const networks = await loadNetworkRefs();
  const desiredIfaces: DesiredInterface[] = snap.interfaces.map((iface) => ({
    externalId: `fw/${iface.key}`,
    name: iface.device ?? iface.key,
    deviceId: firewallDeviceId,
    ip: iface.ipv4,
    metadata: {
      interfaceKey: iface.key,
      description: iface.description,
      vlanTag: iface.vlanTag,
      enabled: iface.enabled,
    },
  }));
  stats.interfaces = await syncInterfaces(integrationId, "OPNSENSE", desiredIfaces, runStart, networks, complete);

  // -- Firewall rules --
  {
    const existing = await prisma.firewallRule.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.map((e) => [e.externalId, e.id]));
    await prisma.$transaction(
      async (tx) => {
        for (const rule of snap.rules) {
          const data = {
            sequence: rule.sequence,
            action: rule.action,
            interfaceName: rule.interfaceName,
            direction: rule.direction,
            protocol: rule.protocol,
            sourceSpec: rule.sourceSpec,
            destSpec: rule.destSpec,
            destPort: rule.destPort,
            descriptionText: rule.description,
            enabled: rule.enabled,
            source: "OPNSENSE" as const,
            ...seen,
            metadata: rule.raw as Prisma.InputJsonValue,
          };
          const id = byExt.get(rule.uuid);
          if (id) {
            await tx.firewallRule.update({ where: { id }, data });
            stats.firewallRules.updated++;
          } else {
            await tx.firewallRule.create({ data: { ...data, integrationId, externalId: rule.uuid } });
            stats.firewallRules.created++;
          }
        }
      },
      { timeout: 30_000 },
    );
  }

  // -- Aliases --
  {
    const existing = await prisma.firewallAlias.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.map((e) => [e.externalId, e.id]));
    await prisma.$transaction(
      async (tx) => {
        for (const alias of snap.aliases) {
          const data = {
            name: alias.name,
            aliasType: alias.aliasType,
            content: alias.content,
            descriptionText: alias.description,
            ...seen,
          };
          const id = byExt.get(alias.uuid);
          if (id) {
            await tx.firewallAlias.update({ where: { id }, data });
            stats.firewallAliases.updated++;
          } else {
            await tx.firewallAlias.create({ data: { ...data, integrationId, externalId: alias.uuid } });
            stats.firewallAliases.created++;
          }
        }
      },
      { timeout: 30_000 },
    );
  }

  // -- DHCP leases --
  {
    const existing = await prisma.dhcpLease.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.map((e) => [e.externalId, e.id]));
    await prisma.$transaction(
      async (tx) => {
        for (const lease of snap.leases) {
          const externalId = lease.mac ? `lease/${lease.mac.toLowerCase()}` : `lease/${lease.ip}`;
          const data = {
            ipAddress: lease.ip,
            macAddress: lease.mac,
            hostname: lease.hostname,
            isStatic: lease.isStatic,
            networkId: pickNetworkForIp(lease.ip, networks),
            ...seen,
          };
          const id = byExt.get(externalId);
          if (id) {
            await tx.dhcpLease.update({ where: { id }, data });
            stats.dhcpLeases.updated++;
          } else {
            await tx.dhcpLease.create({ data: { ...data, integrationId, externalId } });
            stats.dhcpLeases.created++;
          }
        }
      },
      { timeout: 30_000 },
    );
  }

  // -- ARP neighbors (detected devices) --
  {
    const existing = await prisma.networkNeighbor.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.map((e) => [e.externalId, e.id]));
    await prisma.$transaction(
      async (tx) => {
        for (const neighbor of snap.neighbors) {
          // Keyed per IP: a device that moves address shows up as a new row
          // while the old one ages out through the stale sweep.
          const externalId = `arp/${neighbor.ip}`;
          const data = {
            ipAddress: neighbor.ip,
            macAddress: neighbor.mac,
            hostname: neighbor.hostname,
            manufacturer: neighbor.manufacturer,
            interfaceKey: neighbor.interfaceKey,
            permanent: neighbor.permanent,
            networkId: pickNetworkForIp(neighbor.ip, networks),
            ...seen,
          };
          const id = byExt.get(externalId);
          if (id) {
            await tx.networkNeighbor.update({ where: { id }, data });
            stats.neighbors.updated++;
          } else {
            await tx.networkNeighbor.create({ data: { ...data, integrationId, externalId } });
            stats.neighbors.created++;
          }
        }
      },
      { timeout: 30_000 },
    );
  }

  // -- Port forwards (destination NAT) --
  {
    const existing = await prisma.portForward.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.map((e) => [e.externalId, e.id]));
    await prisma.$transaction(
      async (tx) => {
        for (const pf of snap.portForwards) {
          const data = {
            sequence: pf.sequence,
            interfaceName: pf.interfaceName,
            protocol: pf.protocol,
            sourceSpec: pf.sourceSpec,
            destSpec: pf.destSpec,
            destPort: pf.destPort,
            targetIp: pf.targetIp,
            targetPort: pf.targetPort,
            descriptionText: pf.description,
            enabled: pf.enabled,
            source: "OPNSENSE" as const,
            ...seen,
            metadata: pf.raw as Prisma.InputJsonValue,
          };
          const id = byExt.get(pf.uuid);
          if (id) {
            await tx.portForward.update({ where: { id }, data });
            stats.portForwards.updated++;
          } else {
            await tx.portForward.create({ data: { ...data, integrationId, externalId: pf.uuid } });
            stats.portForwards.created++;
          }
        }
      },
      { timeout: 30_000 },
    );
  }

  // -- Dynamic DNS hostnames --
  {
    const existing = await prisma.dyndnsHost.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.map((e) => [e.externalId, e.id]));
    await prisma.$transaction(
      async (tx) => {
        for (const host of snap.dyndnsHosts) {
          const externalId = `${host.accountUuid}/${host.hostname}`;
          const data = {
            hostname: host.hostname,
            service: host.service,
            enabled: host.enabled,
            interfaceName: host.interfaceName,
            currentIp: host.currentIp,
            ...seen,
          };
          const id = byExt.get(externalId);
          if (id) {
            await tx.dyndnsHost.update({ where: { id }, data });
            stats.dyndnsHosts.updated++;
          } else {
            await tx.dyndnsHost.create({ data: { ...data, integrationId, externalId } });
            stats.dyndnsHosts.created++;
          }
        }
      },
      { timeout: 30_000 },
    );
  }

  // -- Gateways --
  {
    const existing = await prisma.networkGateway.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.map((e) => [e.externalId, e.id]));
    await prisma.$transaction(
      async (tx) => {
        for (const gw of snap.gateways) {
          const data = {
            name: gw.name,
            interfaceName: gw.interfaceName,
            ipAddress: gw.ipAddress,
            isDefault: gw.isDefault,
            online: gw.online,
            ...seen,
            metadata: gw.raw as Prisma.InputJsonValue,
          };
          const id = byExt.get(gw.uuid);
          if (id) {
            await tx.networkGateway.update({ where: { id }, data });
            stats.gateways.updated++;
          } else {
            await tx.networkGateway.create({ data: { ...data, integrationId, externalId: gw.uuid } });
            stats.gateways.created++;
          }
        }
      },
      { timeout: 30_000 },
    );
  }

  return stats;
}

/** Map skipped snapshot features to the stale-sweep families they shield. */
export function sweepExclusionsFor(skipped: SkippedFeature[]): string[] {
  const byFeature: Record<OpnFeature, string> = {
    portForwards: "portForwards",
    dyndns: "dyndnsHosts",
    gateways: "gateways",
    neighbors: "neighbors",
  };
  return skipped.map((s) => byFeature[s.feature]).filter(Boolean);
}
