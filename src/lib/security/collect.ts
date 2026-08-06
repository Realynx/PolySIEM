import "server-only";

import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { assertDatasetBudget } from "@/lib/dataset-budget";
import type {
  SecuritySnapshot,
  SnapshotDyndnsHost,
  SnapshotGuest,
  SnapshotHost,
  SnapshotService,
  SnapshotTunnelHostname,
} from "./types";

/**
 * Snapshot builder: gathers everything the pure checks look at from the
 * synced database rows in one pass. Read-only apart from nothing — this never
 * writes, never calls an integration API, and treats absent integrations as
 * empty data rather than errors.
 */

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

const SECURITY_BUDGET = {
  firewallRules: 25_000,
  portForwards: 10_000,
  dyndnsHosts: 10_000,
  tunnelHostnames: 10_000,
  wirelessNetworks: 10_000,
  vms: 10_000,
  containers: 10_000,
  devices: 5_000,
  sshKeyDeployments: 50_000,
  services: 20_000,
} as const;

/** True when the seeded "admin" account still verifies against "admin". */
async function detectDefaultAdminPassword(): Promise<boolean> {
  try {
    const admin = await prisma.user.findUnique({
      where: { username: "admin" },
      select: { passwordHash: true, disabled: true },
    });
    if (!admin || admin.disabled) return false;
    return await verifyPassword("admin", admin.passwordHash);
  } catch (err) {
    console.error("[security] default-password probe failed, skipping:", err);
    return false;
  }
}

function guestFirewallMeta(metadata: unknown): { present: boolean; enabled: boolean } {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const fw = (metadata as Record<string, unknown>).firewall;
    if (fw && typeof fw === "object" && !Array.isArray(fw)) {
      return { present: true, enabled: (fw as Record<string, unknown>).enabled === true };
    }
  }
  return { present: false, enabled: false };
}

function metaFlag(metadata: unknown, key: string): unknown {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return (metadata as Record<string, unknown>)[key];
  }
  return undefined;
}

export async function collectSecuritySnapshot(): Promise<SecuritySnapshot> {
  const now = new Date();
  const notRemoved = { status: { not: "REMOVED" as const } };

  const [
    defaultAdminPasswordActive,
    users,
    sessionCounts,
    apiTokens,
    integrations,
    sshKeys,
    firewallRules,
    portForwards,
    dyndnsHosts,
    tunnelHostnames,
    wirelessNetworks,
    vms,
    containers,
    devices,
    sshKeyDeployments,
    services,
  ] = await Promise.all([
    detectDefaultAdminPassword(),
    prisma.user.findMany({
      select: { id: true, username: true, role: true, disabled: true, createdAt: true },
    }),
    prisma.session.groupBy({ by: ["userId"], _count: { _all: true } }),
    prisma.apiToken.findMany({
      select: {
        id: true,
        name: true,
        scopes: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
        expiresAt: true,
      },
    }),
    prisma.integrationConfig.findMany({
      select: { id: true, type: true, name: true, enabled: true, verifyTls: true, baseUrl: true },
    }),
    prisma.sshKey.findMany({
      select: { id: true, name: true, keyType: true, bits: true, _count: { select: { deployments: true } } },
    }),
    prisma.firewallRule.findMany({
      where: notRemoved,
      select: {
        id: true,
        source: true,
        action: true,
        enabled: true,
        status: true,
        interfaceName: true,
        direction: true,
        protocol: true,
        sourceSpec: true,
        destSpec: true,
        destPort: true,
        descriptionText: true,
        sequence: true,
      },
      take: SECURITY_BUDGET.firewallRules + 1,
    }),
    prisma.portForward.findMany({
      where: notRemoved,
      select: {
        id: true,
        enabled: true,
        status: true,
        interfaceName: true,
        protocol: true,
        sourceSpec: true,
        destSpec: true,
        destPort: true,
        targetIp: true,
        targetPort: true,
        descriptionText: true,
      },
      take: SECURITY_BUDGET.portForwards + 1,
    }),
    prisma.dyndnsHost.findMany({
      where: notRemoved,
      select: { id: true, hostname: true, enabled: true, status: true, metadata: true },
      take: SECURITY_BUDGET.dyndnsHosts + 1,
    }),
    prisma.tunnelHostname.findMany({
      select: { id: true, hostname: true, metadata: true, tunnel: { select: { name: true } } },
      take: SECURITY_BUDGET.tunnelHostnames + 1,
    }),
    prisma.wirelessNetwork.findMany({
      where: notRemoved,
      select: { id: true, name: true, enabled: true, status: true, security: true, wpaMode: true },
      take: SECURITY_BUDGET.wirelessNetworks + 1,
    }),
    prisma.virtualMachine.findMany({
      where: notRemoved,
      select: {
        id: true,
        name: true,
        source: true,
        status: true,
        powerState: true,
        lastSeenAt: true,
        description: true,
        metadata: true,
      },
      take: SECURITY_BUDGET.vms + 1,
    }),
    prisma.container.findMany({
      where: notRemoved,
      select: {
        id: true,
        name: true,
        source: true,
        status: true,
        powerState: true,
        lastSeenAt: true,
        description: true,
        metadata: true,
      },
      take: SECURITY_BUDGET.containers + 1,
    }),
    prisma.device.findMany({
      where: notRemoved,
      select: {
        id: true,
        name: true,
        kind: true,
        source: true,
        status: true,
        lastSeenAt: true,
        description: true,
      },
      take: SECURITY_BUDGET.devices + 1,
    }),
    prisma.sshKeyDeployment.findMany({
      select: { deviceId: true, vmId: true, containerId: true },
      take: SECURITY_BUDGET.sshKeyDeployments + 1,
    }),
    prisma.service.findMany({
      where: notRemoved,
      select: { id: true, name: true, status: true, port: true, protocol: true, url: true },
      take: SECURITY_BUDGET.services + 1,
    }),
  ]);

  assertDatasetBudget("Security firewall rules", firewallRules, SECURITY_BUDGET.firewallRules);
  assertDatasetBudget("Security port forwards", portForwards, SECURITY_BUDGET.portForwards);
  assertDatasetBudget("Security dynamic DNS hosts", dyndnsHosts, SECURITY_BUDGET.dyndnsHosts);
  assertDatasetBudget("Security tunnel hostnames", tunnelHostnames, SECURITY_BUDGET.tunnelHostnames);
  assertDatasetBudget("Security wireless networks", wirelessNetworks, SECURITY_BUDGET.wirelessNetworks);
  assertDatasetBudget("Security virtual machines", vms, SECURITY_BUDGET.vms);
  assertDatasetBudget("Security containers", containers, SECURITY_BUDGET.containers);
  assertDatasetBudget("Security devices", devices, SECURITY_BUDGET.devices);
  assertDatasetBudget("Security SSH deployments", sshKeyDeployments, SECURITY_BUDGET.sshKeyDeployments);
  assertDatasetBudget("Security services", services, SECURITY_BUDGET.services);

  const sessionsByUser = new Map(sessionCounts.map((s) => [s.userId, s._count._all]));

  // SSH-key coverage per target: a machine with zero documented keys is
  // presumed to rely on password auth (the keys-vs-passwords signal).
  const keysByEntity = new Map<string, number>();
  for (const d of sshKeyDeployments) {
    const id = d.deviceId ?? d.vmId ?? d.containerId;
    if (id) keysByEntity.set(id, (keysByEntity.get(id) ?? 0) + 1);
  }

  const snapshotServices: SnapshotService[] = services.map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status,
    port: s.port,
    protocol: s.protocol,
    plaintextHttp: (s.url ?? "").trim().toLowerCase().startsWith("http://"),
  }));

  const guests: SnapshotGuest[] = [
    ...vms.map((vm): SnapshotGuest => {
      const fw = guestFirewallMeta(vm.metadata);
      return {
        id: vm.id,
        kind: "vm",
        name: vm.name,
        source: vm.source,
        status: vm.status,
        powerState: vm.powerState,
        lastSeenAt: iso(vm.lastSeenAt),
        hasDescription: (vm.description ?? "").trim().length > 0,
        firewallPresent: fw.present,
        firewallEnabled: fw.enabled,
        sshKeyCount: keysByEntity.get(vm.id) ?? 0,
      };
    }),
    ...containers.map((ct): SnapshotGuest => {
      const fw = guestFirewallMeta(ct.metadata);
      return {
        id: ct.id,
        kind: "container",
        name: ct.name,
        source: ct.source,
        status: ct.status,
        powerState: ct.powerState,
        lastSeenAt: iso(ct.lastSeenAt),
        hasDescription: (ct.description ?? "").trim().length > 0,
        firewallPresent: fw.present,
        firewallEnabled: fw.enabled,
        sshKeyCount: keysByEntity.get(ct.id) ?? 0,
      };
    }),
  ];

  const hosts: SnapshotHost[] = devices.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    source: d.source,
    status: d.status,
    lastSeenAt: iso(d.lastSeenAt),
    hasDescription: (d.description ?? "").trim().length > 0,
    sshKeyCount: keysByEntity.get(d.id) ?? 0,
  }));

  return {
    now: now.toISOString(),
    defaultAdminPasswordActive,
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      disabled: u.disabled,
      createdAt: u.createdAt.toISOString(),
      sessionCount: sessionsByUser.get(u.id) ?? 0,
    })),
    apiTokens: apiTokens.map((t) => ({
      id: t.id,
      name: t.name,
      scopes: t.scopes,
      createdAt: t.createdAt.toISOString(),
      lastUsedAt: iso(t.lastUsedAt),
      revoked: t.revokedAt !== null,
      expired: t.expiresAt !== null && t.expiresAt.getTime() < now.getTime(),
      hasExpiry: t.expiresAt !== null,
    })),
    integrations: integrations.map((i) => ({
      id: i.id,
      type: i.type,
      name: i.name,
      enabled: i.enabled,
      verifyTls: i.verifyTls,
      usesTls: i.baseUrl.trim().toLowerCase().startsWith("https://"),
    })),
    sshKeys: sshKeys.map((k) => ({
      id: k.id,
      name: k.name,
      keyType: k.keyType,
      bits: k.bits,
      deploymentCount: k._count.deployments,
    })),
    firewallRules: firewallRules.map((r) => ({
      id: r.id,
      source: r.source,
      action: r.action,
      enabled: r.enabled,
      status: r.status,
      interfaceName: r.interfaceName,
      direction: r.direction,
      protocol: r.protocol,
      sourceSpec: r.sourceSpec,
      destSpec: r.destSpec,
      destPort: r.destPort,
      description: r.descriptionText,
      sequence: r.sequence,
    })),
    portForwards: portForwards.map((f) => ({
      id: f.id,
      enabled: f.enabled,
      status: f.status,
      interfaceName: f.interfaceName,
      protocol: f.protocol,
      sourceSpec: f.sourceSpec,
      destSpec: f.destSpec,
      destPort: f.destPort,
      targetIp: f.targetIp,
      targetPort: f.targetPort,
      description: f.descriptionText,
    })),
    dyndnsHosts: dyndnsHosts.map((d): SnapshotDyndnsHost => {
      const matchesWan = metaFlag(d.metadata, "matchesWan");
      return {
        id: d.id,
        hostname: d.hostname,
        enabled: d.enabled,
        status: d.status,
        matchesWan: typeof matchesWan === "boolean" ? matchesWan : null,
      };
    }),
    tunnelHostnames: tunnelHostnames.map((t): SnapshotTunnelHostname => {
      const classification = metaFlag(t.metadata, "classification");
      return {
        id: t.id,
        tunnelName: t.tunnel.name,
        hostname: t.hostname,
        classification: typeof classification === "string" ? classification : null,
      };
    }),
    wirelessNetworks,
    services: snapshotServices,
    guests,
    hosts,
  };
}
