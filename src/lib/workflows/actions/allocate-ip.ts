import { z } from "zod";
import { createIp } from "@/lib/services/inventory";
import { findFreeHostIp } from "../free-ip";
import type { ActionDefinition } from "../registry";

const configSchema = z.object({
  networkId: z.string().min(1),
  description: z.string().max(500).optional(),
});

/**
 * inventory.allocate-ip — reserve the first free host IP on a network.
 * Excludes the network/broadcast/gateway addresses and every address already
 * known to PolySIEM (documented IPs, DHCP leases, ARP-detected neighbors).
 * Creates a MANUAL IpAddress row so the allocation is immediately documented.
 */
export const inventoryAllocateIp: ActionDefinition = {
  meta: {
    kind: "inventory.allocate-ip",
    title: "Allocate free IP",
    description:
      "Finds the first free host IP on the chosen network (skipping gateway, documented IPs, DHCP leases, and detected devices) and documents it as a manual IP address row.",
    category: "inventory",
    inputs: [
      {
        key: "networkId",
        label: "Network",
        type: "network",
        required: true,
        templateable: true,
        help: "Network to allocate from — pick one or reference a trigger param like {{input.network}}.",
      },
      {
        key: "description",
        label: "Description",
        type: "string",
        required: false,
        placeholder: "{{input.name}}",
        help: "Stored on the IP address row (templateable).",
      },
    ],
    outputs: [
      { key: "ip", label: "Allocated IP address" },
      { key: "ipAddressId", label: "IP address row id" },
      { key: "networkName", label: "Network name" },
    ],
  },
  configSchema,
  async run({ config, ctx }) {
    const { networkId, description } = configSchema.parse(config);
    const network = await ctx.prisma.network.findUnique({
      where: { id: networkId },
      select: { id: true, name: true, cidr: true, gateway: true },
    });
    if (!network) throw new Error(`Network "${networkId}" not found`);
    if (!network.cidr) throw new Error(`Network "${network.name}" has no CIDR — cannot allocate an IP`);

    const [ips, leases, neighbors] = await Promise.all([
      ctx.prisma.ipAddress.findMany({ where: { networkId: network.id }, select: { address: true } }),
      ctx.prisma.dhcpLease.findMany({
        where: { networkId: network.id, status: { not: "REMOVED" } },
        select: { ipAddress: true },
      }),
      ctx.prisma.networkNeighbor.findMany({
        where: { networkId: network.id, status: { not: "REMOVED" } },
        select: { ipAddress: true },
      }),
    ]);
    const taken = [
      ...ips.map((r) => r.address),
      ...leases.map((r) => r.ipAddress),
      ...neighbors.map((r) => r.ipAddress),
    ];

    const { ip, reason } = findFreeHostIp(network.cidr, taken, network.gateway);
    if (!ip) throw new Error(reason ?? `No free IP found on ${network.name}`);

    const row = await createIp(ctx.actor, {
      address: ip,
      networkId: network.id,
      description: description?.trim() ? description.trim() : null,
    });

    return { ip: row.address, ipAddressId: row.id, networkName: network.name };
  },
};
