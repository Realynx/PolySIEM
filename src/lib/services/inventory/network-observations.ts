import "server-only";

import { prisma } from "@/lib/db";

export async function listDhcpLeases(networkId?: string) {
  return prisma.dhcpLease.findMany({
    where: {
      status: { not: "REMOVED" },
      ...(networkId ? { networkId } : {}),
    },
    orderBy: { ipAddress: "asc" },
    include: { network: { select: { id: true, name: true } } },
  });
}

/**
 * Devices detected in the firewall's ARP table. Permanent entries (the
 * firewall's own interface addresses) are excluded because they are already
 * documented as firewall interfaces.
 */
export async function listNetworkNeighbors(networkId?: string) {
  return prisma.networkNeighbor.findMany({
    where: {
      status: { not: "REMOVED" },
      permanent: false,
      ...(networkId ? { networkId } : {}),
    },
    orderBy: { ipAddress: "asc" },
    include: { network: { select: { id: true, name: true } } },
  });
}
