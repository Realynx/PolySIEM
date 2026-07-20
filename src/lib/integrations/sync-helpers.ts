import { Prisma, type Source } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pickNetworkForIp, type NetworkRef } from "./net";

export interface FamilyCounts {
  created: number;
  updated: number;
  stale: number;
}

export function newCounts(): FamilyCounts {
  return { created: 0, updated: 0, stale: 0 };
}

export type SyncStats = Record<string, FamilyCounts>;

/** Networks with a CIDR used for IP → network containment lookups. */
export async function loadNetworkRefs(): Promise<NetworkRef[]> {
  return prisma.network.findMany({
    where: { cidr: { not: null }, status: { not: "REMOVED" } },
    select: { id: true, cidr: true },
  });
}

export interface DesiredInterface {
  externalId: string;
  name: string;
  macAddress?: string | null;
  deviceId?: string | null;
  vmId?: string | null;
  containerId?: string | null;
  /** Plain IPv4 address of the interface, when known. */
  ip?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Upsert NetworkInterface rows (and their attached IpAddress) for an
 * integration, linking each interface to a Network via CIDR containment of
 * its IP. Interfaces not present in `desired` are deleted (interfaces carry
 * no stale lifecycle of their own) — but ONLY when `pruneMissing` is true.
 * On a partial/incomplete snapshot the caller passes `pruneMissing: false` so
 * that interfaces belonging to a device whose data failed to fetch are not
 * destroyed (which would also cascade-delete their IpAddress rows).
 */
export async function syncInterfaces(
  integrationId: string,
  source: Source,
  desired: DesiredInterface[],
  runStart: Date,
  networks: NetworkRef[],
  pruneMissing: boolean,
): Promise<FamilyCounts> {
  const counts = newCounts();
  const existing = await prisma.networkInterface.findMany({
    where: { integrationId },
    select: { id: true, externalId: true },
  });
  const byExt = new Map(existing.map((e) => [e.externalId, e.id]));

  for (const iface of desired) {
    const networkId = pickNetworkForIp(iface.ip, networks);
    const data = {
      name: iface.name,
      macAddress: iface.macAddress ?? null,
      deviceId: iface.deviceId ?? null,
      vmId: iface.vmId ?? null,
      containerId: iface.containerId ?? null,
      networkId,
      source,
      metadata: (iface.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    };
    const existingId = byExt.get(iface.externalId);
    let interfaceId: string;
    if (existingId) {
      await prisma.networkInterface.update({ where: { id: existingId }, data });
      interfaceId = existingId;
      counts.updated++;
    } else {
      const created = await prisma.networkInterface.create({
        data: { ...data, integrationId, externalId: iface.externalId },
      });
      interfaceId = created.id;
      counts.created++;
    }

    if (iface.ip) {
      try {
        await prisma.ipAddress.upsert({
          where: { interfaceId },
          create: { address: iface.ip, networkId, interfaceId, source },
          update: { address: iface.ip, networkId, source },
        });
      } catch (err) {
        // Unique (address, networkId) collision with a pre-existing manual
        // IP row — leave the manual row alone rather than fail the sync.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      }
    } else {
      await prisma.ipAddress.deleteMany({ where: { interfaceId } });
    }
  }

  // Interfaces not touched this run no longer exist upstream — but only prune
  // when the snapshot was complete, so a failed per-device fetch can't wipe
  // real interfaces (and their IPs) that simply weren't in this snapshot.
  if (pruneMissing) {
    const gone = await prisma.networkInterface.deleteMany({
      where: { integrationId, updatedAt: { lt: runStart } },
    });
    counts.stale += gone.count;
  }
  return counts;
}

/** Structural slice of a Prisma delegate that supports the stale sweep. */
interface SweepDelegate {
  updateMany(args: {
    where: {
      integrationId: string;
      status: { not: "REMOVED" };
      missCount?: { gte: number };
      OR: ({ lastSeenAt: null } | { lastSeenAt: { lt: Date } })[];
    };
    data: { missCount: { increment: number }; status: "REMOVED" | "STALE" };
  }): Promise<{ count: number }>;
}

/**
 * Mark entities of this integration that were not seen this run: increment
 * missCount and flag STALE; once missCount reaches the stale-remove threshold
 * they flip to REMOVED. Returns per-family counts of rows touched.
 *
 * `excludeFamilies` names families whose fetch was deliberately skipped this
 * run (e.g. an optional endpoint the API key lacks a privilege for) — their
 * rows were not seen through no fault of their own and must not age out.
 */
export async function staleSweep(
  integrationId: string,
  runStart: Date,
  threshold: number,
  excludeFamilies: string[] = [],
): Promise<Record<string, number>> {
  const families: [string, SweepDelegate][] = [
    ["devices", prisma.device],
    ["vms", prisma.virtualMachine],
    ["containers", prisma.container],
    ["networks", prisma.network],
    ["storage", prisma.storagePool],
    ["firewallRules", prisma.firewallRule],
    ["firewallAliases", prisma.firewallAlias],
    ["dhcpLeases", prisma.dhcpLease],
    ["neighbors", prisma.networkNeighbor],
    ["wirelessNetworks", prisma.wirelessNetwork],
    ["wirelessAps", prisma.wirelessAp],
    ["portForwards", prisma.portForward],
    ["dyndnsHosts", prisma.dyndnsHost],
    ["gateways", prisma.networkGateway],
  ];
  const excluded = new Set(excludeFamilies);
  const out: Record<string, number> = {};
  for (const [family, delegate] of families) {
    if (excluded.has(family)) continue;
    const notSeen = {
      integrationId,
      status: { not: "REMOVED" as const },
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: runStart } }],
    };
    const removed = await delegate.updateMany({
      where: { ...notSeen, missCount: { gte: Math.max(0, threshold - 1) } },
      data: { missCount: { increment: 1 }, status: "REMOVED" },
    });
    const staled = await delegate.updateMany({
      where: notSeen,
      data: { missCount: { increment: 1 }, status: "STALE" },
    });
    const total = removed.count + staled.count;
    if (total > 0) out[family] = total;
  }
  return out;
}
