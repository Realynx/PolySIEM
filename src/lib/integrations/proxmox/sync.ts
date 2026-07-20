import { Prisma, type FirewallAction } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isMock, type DriverConfig } from "../types";
import {
  loadNetworkRefs,
  newCounts,
  syncInterfaces,
  type DesiredInterface,
  type SyncStats,
} from "../sync-helpers";

// ---------- normalized snapshot ----------

export interface PveNodeIface {
  /** vmbr0, bond0, eno1, vmbr0.20 … */
  name: string;
  /** bridge | bond | eth | vlan | unknown */
  type: string;
  /** Plain IPv4 address, when configured. */
  address: string | null;
  /** Address CIDR as reported by Proxmox, e.g. "10.0.10.11/24". */
  cidr: string | null;
  gateway: string | null;
  mac: string | null;
}

export interface PveNode {
  name: string;
  status: string; // online | offline | unknown
  cpuCores: number | null;
  cpuModel: string | null;
  memoryBytes: bigint | null;
  pveVersion: string | null;
  uptimeSec: number | null;
  interfaces: PveNodeIface[];
}

export interface PveGuestNic {
  /** net0, net1 … */
  name: string;
  mac: string | null;
  bridge: string | null;
  vlanTag: number | null;
  /** Configured LXC IPv4 or a QEMU guest-agent IPv4, when available. */
  ip: string | null;
}

/** Per-guest firewall config (null when the guest has no firewall config). */
export interface PveGuestFirewall {
  enabled: boolean;
  policyIn: string | null;
  /** Security group references in the order the guest's rules list them. */
  groups: string[];
  /** Plain rules defined directly on this VM or container. */
  rules: PveFirewallRule[];
}

export interface PveGuest {
  kind: "qemu" | "lxc";
  node: string;
  vmid: number;
  name: string;
  /** running | stopped | paused */
  status: string;
  cpuCores: number | null;
  memoryBytes: bigint | null;
  diskBytes: bigint | null;
  osName: string | null;
  description: string | null;
  nics: PveGuestNic[];
  firewall: PveGuestFirewall | null;
}

export interface PveStorage {
  node: string;
  name: string;
  type: string | null;
  totalBytes: bigint | null;
  usedBytes: bigint | null;
  content: string | null;
  shared: boolean;
}

/** One rule from a security group, the cluster rule list, or a guest. */
export interface PveFirewallRule {
  pos: number;
  /** "in" | "out" as reported by Proxmox. */
  direction: string;
  /** ACCEPT | DROP | REJECT */
  action: string;
  source: string | null;
  dest: string | null;
  proto: string | null;
  dport: string | null;
  sport: string | null;
  comment: string | null;
  /** enable !== 0 (rules default to enabled). */
  enabled: boolean;
  macro: string | null;
  iface: string | null;
  log: string | null;
}

export interface PveSecurityGroup {
  name: string;
  comment: string | null;
  rules: PveFirewallRule[];
}

export interface PveIpset {
  name: string;
  comment: string | null;
  /** Entry CIDRs (nomatch entries excluded). */
  cidrs: string[];
}

export interface PveFwAlias {
  name: string;
  cidr: string;
  comment: string | null;
}

/** Datacenter-level firewall objects. */
export interface PveClusterFirewall {
  groups: PveSecurityGroup[];
  ipsets: PveIpset[];
  aliases: PveFwAlias[];
  /** Cluster-level rules (same shape as group rules). */
  rules: PveFirewallRule[];
}

export function emptyPveClusterFirewall(): PveClusterFirewall {
  return { groups: [], ipsets: [], aliases: [], rules: [] };
}

export interface ProxmoxSnapshot {
  nodes: PveNode[];
  guests: PveGuest[];
  storage: PveStorage[];
  firewall: PveClusterFirewall;
  /** Per-node fetch failures — a non-empty list yields a PARTIAL run. */
  errors: string[];
}

/** Fetch a normalized snapshot: demo fixtures for mock:// configs, live API otherwise. */
export async function fetchProxmoxSnapshot(cfg: DriverConfig): Promise<ProxmoxSnapshot> {
  if (isMock(cfg)) {
    const { generateDemoScenarioFromUrl } = await import("@/lib/demo/scenario");
    const generated = generateDemoScenarioFromUrl(cfg.baseUrl).proxmox;
    const { mockProvisionedContainers } = await import("./mock");
    return { ...generated, guests: [...generated.guests, ...mockProvisionedContainers(cfg.id)] };
  }
  const { fetchProxmoxSnapshotFromApi } = await import("./client");
  return fetchProxmoxSnapshotFromApi(cfg);
}

// ---------- database mapping ----------

function firewallAction(action: string): FirewallAction {
  switch (action) {
    case "ACCEPT":
      return "PASS";
    case "REJECT":
      return "REJECT";
    default:
      // DROP and anything unexpected map to BLOCK.
      return "BLOCK";
  }
}

/** Guest metadata: { node } plus firewall info when the guest has a config. */
function guestMetadata(guest: PveGuest): Prisma.InputJsonValue {
  if (!guest.firewall) return { node: guest.node };
  return {
    node: guest.node,
    firewall: {
      enabled: guest.firewall.enabled,
      policyIn: guest.firewall.policyIn,
      groups: guest.firewall.groups,
      localRuleCount: guest.firewall.rules.length,
    },
  };
}

/**
 * FirewallRule metadata per the storage contract:
 * { scope, group?, groupComment?, macro?, iface?, log?, sport? } — undefined keys omitted.
 */
function ruleMetadata(
  rule: PveFirewallRule,
  scope: "group" | "cluster" | "guest",
  group?: PveSecurityGroup,
  guest?: PveGuest,
): Prisma.InputJsonValue {
  const meta: Record<string, string> = { scope };
  if (group) {
    meta.group = group.name;
    if (group.comment !== null) meta.groupComment = group.comment;
  }
  if (guest) {
    meta.guestExternalId = `${guest.kind}/${guest.vmid}@${guest.node}`;
    meta.guestName = guest.name;
    meta.guestKind = guest.kind;
  }
  if (rule.macro !== null) meta.macro = rule.macro;
  if (rule.iface !== null) meta.iface = rule.iface;
  if (rule.log !== null) meta.log = rule.log;
  if (rule.sport !== null) meta.sport = rule.sport;
  return meta;
}

function powerState(status: string): "RUNNING" | "STOPPED" | "PAUSED" | "UNKNOWN" {
  switch (status) {
    case "running":
      return "RUNNING";
    case "stopped":
      return "STOPPED";
    case "paused":
      return "PAUSED";
    default:
      return "UNKNOWN";
  }
}

/**
 * Upsert a Proxmox snapshot into the inventory. Only integration-owned fields
 * are written on updates — user-owned fields (description, annotation,
 * location, purpose, tags) are set at create time at most and never
 * overwritten afterwards.
 */
export async function applyProxmoxSnapshot(
  integrationId: string,
  snap: ProxmoxSnapshot,
  runStart: Date,
  complete: boolean,
): Promise<SyncStats> {
  const stats: SyncStats = {
    devices: newCounts(),
    vms: newCounts(),
    containers: newCounts(),
    storage: newCounts(),
    interfaces: newCounts(),
    firewallRules: newCounts(),
    firewallAliases: newCounts(),
  };
  const seen = { status: "ACTIVE" as const, missCount: 0, lastSeenAt: runStart };

  // -- Devices (hypervisor nodes) --
  const nodeDeviceId = new Map<string, string>();
  {
    const existing = await prisma.device.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.map((e) => [e.externalId, e.id]));
    await prisma.$transaction(
      async (tx) => {
        for (const node of snap.nodes) {
          const externalId = `node/${node.name}`;
          const data = {
            name: node.name,
            kind: "hypervisor",
            source: "PROXMOX" as const,
            ...seen,
            cpuModel: node.cpuModel,
            cpuCores: node.cpuCores,
            memoryBytes: node.memoryBytes,
            osName: "Proxmox VE",
            osVersion: node.pveVersion,
            metadata: { nodeStatus: node.status, uptimeSec: node.uptimeSec } as Prisma.InputJsonValue,
          };
          const id = byExt.get(externalId);
          if (id) {
            await tx.device.update({ where: { id }, data });
            nodeDeviceId.set(node.name, id);
            stats.devices.updated++;
          } else {
            const created = await tx.device.create({ data: { ...data, integrationId, externalId } });
            nodeDeviceId.set(node.name, created.id);
            stats.devices.created++;
          }
        }
      },
      { timeout: 30_000 },
    );
  }

  const interfaces: DesiredInterface[] = [];
  for (const node of snap.nodes) {
    const deviceId = nodeDeviceId.get(node.name);
    if (!deviceId) continue;
    for (const iface of node.interfaces) {
      interfaces.push({
        externalId: `node/${node.name}/${iface.name}`,
        name: iface.name,
        macAddress: iface.mac,
        deviceId,
        ip: iface.address,
        metadata: { type: iface.type, cidr: iface.cidr, gateway: iface.gateway },
      });
    }
  }

  // -- VMs (QEMU) --
  {
    const existing = await prisma.virtualMachine.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.map((e) => [e.externalId, e.id]));
    await prisma.$transaction(
      async (tx) => {
        for (const guest of snap.guests.filter((g) => g.kind === "qemu")) {
          const externalId = `qemu/${guest.vmid}@${guest.node}`;
          const data = {
            name: guest.name,
            source: "PROXMOX" as const,
            vmid: guest.vmid,
            ...seen,
            powerState: powerState(guest.status),
            hostId: nodeDeviceId.get(guest.node) ?? null,
            cpuCores: guest.cpuCores,
            memoryBytes: guest.memoryBytes,
            diskBytes: guest.diskBytes,
            osName: guest.osName,
            metadata: guestMetadata(guest),
          };
          const id = byExt.get(externalId);
          let vmId: string;
          if (id) {
            await tx.virtualMachine.update({ where: { id }, data });
            vmId = id;
            stats.vms.updated++;
          } else {
            const created = await tx.virtualMachine.create({
              data: { ...data, integrationId, externalId, description: guest.description },
            });
            vmId = created.id;
            stats.vms.created++;
          }
          for (const nic of guest.nics) {
            interfaces.push({
              externalId: `${externalId}/${nic.name}`,
              name: nic.name,
              macAddress: nic.mac,
              vmId,
              ip: nic.ip,
              metadata: { bridge: nic.bridge, vlanTag: nic.vlanTag },
            });
          }
        }
      },
      { timeout: 30_000 },
    );
  }

  // -- Containers (LXC) --
  {
    const existing = await prisma.container.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.map((e) => [e.externalId, e.id]));
    await prisma.$transaction(
      async (tx) => {
        for (const guest of snap.guests.filter((g) => g.kind === "lxc")) {
          const externalId = `lxc/${guest.vmid}@${guest.node}`;
          const data = {
            name: guest.name,
            runtime: "lxc",
            source: "PROXMOX" as const,
            vmid: guest.vmid,
            ...seen,
            powerState: powerState(guest.status),
            hostId: nodeDeviceId.get(guest.node) ?? null,
            cpuCores: guest.cpuCores,
            memoryBytes: guest.memoryBytes,
            diskBytes: guest.diskBytes,
            osName: guest.osName,
            metadata: guestMetadata(guest),
          };
          const id = byExt.get(externalId);
          let containerId: string;
          if (id) {
            await tx.container.update({ where: { id }, data });
            containerId = id;
            stats.containers.updated++;
          } else {
            const created = await tx.container.create({
              data: { ...data, integrationId, externalId, description: guest.description },
            });
            containerId = created.id;
            stats.containers.created++;
          }
          for (const nic of guest.nics) {
            interfaces.push({
              externalId: `${externalId}/${nic.name}`,
              name: nic.name,
              macAddress: nic.mac,
              containerId,
              ip: nic.ip,
              metadata: { bridge: nic.bridge, vlanTag: nic.vlanTag },
            });
          }
        }
      },
      { timeout: 30_000 },
    );
  }

  // -- Storage pools --
  {
    const existing = await prisma.storagePool.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.map((e) => [e.externalId, e.id]));
    await prisma.$transaction(
      async (tx) => {
        for (const pool of snap.storage) {
          const externalId = `${pool.name}@${pool.node}`;
          const data = {
            name: pool.name,
            type: pool.type,
            source: "PROXMOX" as const,
            ...seen,
            deviceId: nodeDeviceId.get(pool.node) ?? null,
            totalBytes: pool.totalBytes,
            usedBytes: pool.usedBytes,
            metadata: { content: pool.content, shared: pool.shared, node: pool.node } as Prisma.InputJsonValue,
          };
          const id = byExt.get(externalId);
          if (id) {
            await tx.storagePool.update({ where: { id }, data });
            stats.storage.updated++;
          } else {
            await tx.storagePool.create({ data: { ...data, integrationId, externalId } });
            stats.storage.created++;
          }
        }
      },
      { timeout: 30_000 },
    );
  }

  // -- Firewall rules (security groups + cluster level) --
  {
    const desired: {
      externalId: string;
      rule: PveFirewallRule;
      scope: "group" | "cluster" | "guest";
      group?: PveSecurityGroup;
      guest?: PveGuest;
    }[] = [];
    for (const group of snap.firewall.groups) {
      for (const rule of group.rules) {
        desired.push({ externalId: `pve-group:${group.name}:${rule.pos}`, rule, scope: "group", group });
      }
    }
    for (const rule of snap.firewall.rules) {
      desired.push({ externalId: `pve-cluster:${rule.pos}`, rule, scope: "cluster" });
    }
    for (const guest of snap.guests) {
      for (const rule of guest.firewall?.rules ?? []) {
        desired.push({
          externalId: `pve-guest:${guest.kind}/${guest.vmid}@${guest.node}:${rule.pos}`,
          rule,
          scope: "guest",
          guest,
        });
      }
    }
    const existing = await prisma.firewallRule.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.map((e) => [e.externalId, e.id]));
    await prisma.$transaction(
      async (tx) => {
        for (const { externalId, rule, scope, group, guest } of desired) {
          const data = {
            sequence: rule.pos,
            action: firewallAction(rule.action),
            interfaceName: rule.iface,
            direction: rule.direction,
            protocol: rule.proto,
            sourceSpec: rule.source,
            destSpec: rule.dest,
            destPort: rule.dport,
            descriptionText: rule.comment,
            enabled: rule.enabled,
            source: "PROXMOX" as const,
            ...seen,
            metadata: ruleMetadata(rule, scope, group, guest),
          };
          const id = byExt.get(externalId);
          if (id) {
            await tx.firewallRule.update({ where: { id }, data });
            stats.firewallRules.updated++;
          } else {
            await tx.firewallRule.create({ data: { ...data, integrationId, externalId } });
            stats.firewallRules.created++;
          }
        }
      },
      { timeout: 30_000 },
    );
  }

  // -- Firewall aliases (ipsets + aliases) --
  {
    const desired = [
      ...snap.firewall.ipsets.map((s) => ({
        externalId: `pve-ipset:${s.name}`,
        name: s.name,
        aliasType: "pve-ipset",
        content: s.cidrs,
        descriptionText: s.comment,
      })),
      ...snap.firewall.aliases.map((a) => ({
        externalId: `pve-alias:${a.name}`,
        name: a.name,
        aliasType: "pve-alias",
        content: [a.cidr],
        descriptionText: a.comment,
      })),
    ];
    const existing = await prisma.firewallAlias.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.map((e) => [e.externalId, e.id]));
    await prisma.$transaction(
      async (tx) => {
        for (const alias of desired) {
          const data = {
            name: alias.name,
            aliasType: alias.aliasType,
            content: alias.content,
            descriptionText: alias.descriptionText,
            ...seen,
          };
          const id = byExt.get(alias.externalId);
          if (id) {
            await tx.firewallAlias.update({ where: { id }, data });
            stats.firewallAliases.updated++;
          } else {
            await tx.firewallAlias.create({ data: { ...data, integrationId, externalId: alias.externalId } });
            stats.firewallAliases.created++;
          }
        }
      },
      { timeout: 30_000 },
    );
  }

  // -- Network interfaces (nodes + guests) --
  const networks = await loadNetworkRefs();
  stats.interfaces = await syncInterfaces(integrationId, "PROXMOX", interfaces, runStart, networks, complete);

  return stats;
}
