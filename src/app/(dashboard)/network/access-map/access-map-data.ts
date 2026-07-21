import "server-only";

import { prisma } from "@/lib/db";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { deriveAccessGraph } from "@/lib/topology/access";
import { resolveObservedAssetAddresses } from "@/lib/topology/address-evidence";
import { listStoredCloudflareSnapshots } from "@/lib/services/cloudflare";
import { listStoredTailscaleSnapshots } from "@/lib/services/tailscale";
import {
  containingPveNetwork,
  derivePveNetworkScopes,
} from "@/lib/topology/pve-access";
import type {
  NetworkMember,
} from "@/components/topology/network-access-map";
import { buildPhysicalNetworkData } from "./access-map-physical";
import { buildAccessMapPveData } from "./access-map-pve";
import {
  buildCloudflareAccounts,
  buildIntegrationEvidence,
  buildTailscaleNetworks,
  buildTailscaleTailnets,
} from "./access-map-providers";

/** Load, assemble, and anonymize the complete access-map render model. */
export async function loadAccessMapData() {
  const [networkRows, rules, aliases, pveIpsets, activeIntegrations, cloudflareSnapshots, tailscaleSnapshots, edgePortForwards] = await Promise.all([
    prisma.network.findMany({
      where: { status: { not: "REMOVED" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, vlanId: true, cidr: true, gateway: true, externalId: true, purpose: true, source: true },
    }),
    prisma.firewallRule.findMany({
      // Gateway-level rules only — Proxmox guest-isolation rules feed the
      // separate PVE derivation below, not the inter-VLAN graph.
      where: { status: { not: "REMOVED" }, enabled: true, source: { not: "PROXMOX" } },
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        externalId: true,
        action: true,
        enabled: true,
        sequence: true,
        protocol: true,
        sourceSpec: true,
        destSpec: true,
        destPort: true,
        descriptionText: true,
        metadata: true,
        source: true,
      },
    }),
    prisma.firewallAlias.findMany({
      where: { status: { not: "REMOVED" }, aliasType: { notIn: ["pve-ipset", "pve-alias"] } },
      select: { name: true, aliasType: true, content: true },
    }),
    prisma.firewallAlias.findMany({
      where: { status: { not: "REMOVED" }, aliasType: { in: ["pve-ipset", "pve-alias"] } },
      select: { name: true, content: true },
    }),
    prisma.integrationConfig.findMany({
      where: { enabled: true },
      select: { type: true },
      distinct: ["type"],
    }),
    listStoredCloudflareSnapshots(),
    listStoredTailscaleSnapshots(),
    prisma.portForward.findMany({
      where: { source: "EDGE_NAT_SERVER", status: { not: "REMOVED" }, enabled: true },
      orderBy: [{ integrationId: "asc" }, { destPort: "asc" }],
      select: {
        id: true,
        externalId: true,
        protocol: true,
        sourceSpec: true,
        destPort: true,
        targetIp: true,
        targetPort: true,
        descriptionText: true,
        source: true,
      },
    }),
  ]);

  const pveAddressSets = pveIpsets.map((set) => ({ name: set.name, entries: set.content }));
  const integrationEvidence = buildIntegrationEvidence(
    activeIntegrations.map(({ type }) => type),
  );
  const cloudflareAccounts = buildCloudflareAccounts(cloudflareSnapshots);
  const inferredPveNetworks = derivePveNetworkScopes(pveAddressSets, networkRows);
  const networks = [
    ...networkRows,
    ...inferredPveNetworks.map((network) => ({
      ...network,
      vlanId: null,
      externalId: null,
      purpose: "Inferred from Proxmox firewall address scope",
      gateway: null,
      source: "PROXMOX" as const,
    })),
    ...buildTailscaleNetworks(tailscaleSnapshots),
  ];
  const networkIdForAddress = (address: string): string | null =>
    containingPveNetwork(address, networks)?.id ?? null;

  const [ips, guestInterfaces, leases, neighbors] = await Promise.all([
    prisma.ipAddress.findMany({
      select: {
        address: true,
        networkId: true,
        description: true,
        interface: {
          select: {
            source: true,
            integrationId: true,
            metadata: true,
            device: { select: { id: true, name: true } },
            vm: { select: { id: true, name: true, metadata: true } },
            container: { select: { id: true, name: true, metadata: true } },
          },
        },
      },
    }),
    prisma.networkInterface.findMany({
      where: {
        source: "PROXMOX",
        OR: [{ vmId: { not: null } }, { containerId: { not: null } }],
      },
      select: {
        macAddress: true,
        ip: { select: { address: true, networkId: true } },
        vm: { select: { id: true, externalId: true, name: true, metadata: true } },
        container: { select: { id: true, externalId: true, name: true, metadata: true } },
      },
    }),
    prisma.dhcpLease.findMany({
      where: { status: { not: "REMOVED" } },
      select: { id: true, ipAddress: true, macAddress: true, hostname: true, isStatic: true, networkId: true },
    }),
    prisma.networkNeighbor.findMany({
      where: { status: { not: "REMOVED" }, permanent: false },
      select: { id: true, ipAddress: true, macAddress: true, hostname: true, manufacturer: true, networkId: true },
    }),
  ]);

  const resolvedGuestObservations = resolveObservedAssetAddresses(
    guestInterfaces.flatMap((iface) => {
      const ownerId = iface.vm?.id ?? iface.container?.id;
      return ownerId ? [{ ownerId, macAddress: iface.macAddress }] : [];
    }),
    [
      ...leases.map((lease) => ({
        key: `lease:${lease.id}`,
        address: lease.ipAddress,
        networkId: lease.networkId ?? networkIdForAddress(lease.ipAddress),
        macAddress: lease.macAddress,
        source: lease.isStatic ? ("dhcp-static" as const) : ("dhcp-dynamic" as const),
      })),
      ...neighbors.map((neighbor) => ({
        key: `neighbor:${neighbor.id}`,
        address: neighbor.ipAddress,
        networkId: neighbor.networkId ?? networkIdForAddress(neighbor.ipAddress),
        macAddress: neighbor.macAddress,
        source: "neighbor" as const,
      })),
    ],
  );
  const guestIdentityById = new Map(
    guestInterfaces.flatMap((iface) => {
      const owner = iface.vm ?? iface.container;
      return owner
        ? [[owner.id, {
            name: owner.name,
            kind: iface.container ? ("container" as const) : ("vm" as const),
          }] as const]
        : [];
    }),
  );
  const observedOwnerByKey = new Map(
    resolvedGuestObservations.map((observation) => [observation.key, observation.ownerId]),
  );

  const [wifiSsids, wifiAps] = await Promise.all([
    prisma.wirelessNetwork.findMany({
      where: { status: { not: "REMOVED" } },
      orderBy: { name: "asc" },
      select: {
        name: true,
        band: true,
        security: true,
        hidden: true,
        isGuest: true,
        enabled: true,
        vlanId: true,
        networkId: true,
      },
    }),
    prisma.wirelessAp.findMany({
      where: { status: { not: "REMOVED" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, model: true },
    }),
  ]);

  const switchConfigs = await prisma.switchConfig.findMany({
    include: {
      device: { select: { id: true, name: true } },
      vlans: { select: { vlanId: true, svIpAddress: true, networkId: true } },
      ports: {
        orderBy: { sortOrder: "asc" },
        select: {
          shortName: true,
          description: true,
          mode: true,
          accessVlanId: true,
          voiceVlanId: true,
          nativeVlanId: true,
          allowedVlans: true,
          channelGroup: true,
          isPortChannel: true,
          isShutdown: true,
          connectedDevice: { select: { name: true } },
        },
      },
    },
  });

  const edgeIngressRules = edgePortForwards.map((forward) => ({
    id: `edge-nat:${forward.id}`,
    externalId: forward.externalId,
    action: "PASS",
    enabled: true,
    sequence: null,
    protocol: forward.protocol,
    sourceSpec: forward.sourceSpec && forward.sourceSpec !== "0.0.0.0/0"
      ? forward.sourceSpec
      : "internet",
    destSpec: forward.targetIp,
    destPort: forward.targetPort ?? forward.destPort,
    descriptionText: forward.descriptionText ?? `Managed Edge NAT ingress on ${forward.destPort ?? "any port"}`,
    metadata: null,
    evidenceSource: forward.source,
  }));
  const graph = deriveAccessGraph(
    networks.map(({ source, ...network }) => ({
      ...network,
      evidenceSource: source,
    })),
    [
      ...rules.map(({ source, ...rule }) => ({ ...rule, evidenceSource: source })),
      ...edgeIngressRules,
    ],
    aliases,
  );

  // Per-network members: known IP addresses (labeled with their owner) plus
  // DHCP leases; IP rows win when a lease duplicates a synced address.
  const ipSortKey = (ip: string) =>
    ip.split(".").reduce((acc, octet) => acc * 256 + (Number(octet) || 0), 0);
  const members: Record<string, NetworkMember[]> = {};
  const seen = new Set<string>();
  const tailscaleAssetByDeviceId = new Map<
    string,
    { assetId: string; assetKind: "device" | "vm" | "container" }
  >();
  for (const ip of ips) {
    const tailscaleNetworkId =
      ip.interface?.source === "TAILSCALE" && ip.interface.integrationId
        ? `tailscale:${ip.interface.integrationId}`
        : null;
    const networkId = tailscaleNetworkId ?? ip.networkId ?? networkIdForAddress(ip.address);
    if (!networkId) continue;
    const owner = ip.interface?.container ?? ip.interface?.vm ?? ip.interface?.device;
    const assetKind = ip.interface?.container
      ? ("container" as const)
      : ip.interface?.vm
        ? ("vm" as const)
        : owner
          ? ("device" as const)
          : undefined;
    const metadata = ip.interface?.metadata && typeof ip.interface.metadata === "object"
      ? ip.interface.metadata as { tailscaleDeviceId?: unknown; dnsName?: unknown }
      : null;
    if (
      tailscaleNetworkId &&
      owner?.id &&
      assetKind &&
      typeof metadata?.tailscaleDeviceId === "string"
    ) {
      tailscaleAssetByDeviceId.set(metadata.tailscaleDeviceId, {
        assetId: owner.id,
        assetKind,
      });
    }
    (members[networkId] ??= []).push({
      ip: ip.address,
      label: owner?.name ?? ip.description ?? null,
      kind: "ip",
      assetId: owner?.id,
      assetKind,
      dnsName: typeof metadata?.dnsName === "string" ? metadata.dnsName : undefined,
    });
    seen.add(`${networkId}|${ip.address}`);
  }
  for (const lease of leases) {
    const networkId = lease.networkId ?? networkIdForAddress(lease.ipAddress);
    if (!networkId) continue;
    if (seen.has(`${networkId}|${lease.ipAddress}`)) continue;
    seen.add(`${networkId}|${lease.ipAddress}`);
    const observedGuest = guestIdentityById.get(
      observedOwnerByKey.get(`lease:${lease.id}`) ?? "",
    );
    (members[networkId] ??= []).push({
      ip: lease.ipAddress,
      label:
        observedGuest?.name ??
        (lease.hostname && lease.hostname !== "*" ? lease.hostname : null),
      kind: lease.isStatic ? "lease-static" : "lease-dynamic",
      assetId: observedGuest
        ? observedOwnerByKey.get(`lease:${lease.id}`)
        : undefined,
      assetKind: observedGuest?.kind,
    });
  }
  // ARP-detected devices fill in everything the lease list misses (static-IP
  // devices, other routers, anything that talked through the firewall).
  for (const neighbor of neighbors) {
    const networkId = neighbor.networkId ?? networkIdForAddress(neighbor.ipAddress);
    if (!networkId) continue;
    if (seen.has(`${networkId}|${neighbor.ipAddress}`)) continue;
    seen.add(`${networkId}|${neighbor.ipAddress}`);
    const observedGuest = guestIdentityById.get(
      observedOwnerByKey.get(`neighbor:${neighbor.id}`) ?? "",
    );
    (members[networkId] ??= []).push({
      ip: neighbor.ipAddress,
      label:
        observedGuest?.name ??
        neighbor.hostname ??
        neighbor.manufacturer,
      kind: "detected",
      assetId: observedGuest
        ? observedOwnerByKey.get(`neighbor:${neighbor.id}`)
        : undefined,
      assetKind: observedGuest?.kind,
    });
  }
  const physical = buildPhysicalNetworkData(
    networks,
    switchConfigs,
    wifiSsids,
    wifiAps,
  );
  for (const { networkId, member } of physical.sviMembers) {
    const key = `${networkId}|${member.ip}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (members[networkId] ??= []).push(member);
  }
  for (const list of Object.values(members)) {
    list.sort((a, b) => ipSortKey(a.ip) - ipSortKey(b.ip));
  }

  const tailscale = buildTailscaleTailnets(
    tailscaleSnapshots,
    tailscaleAssetByDeviceId,
  );

  // Proxmox datacenter firewall: guest-level isolation groups inside a VLAN.
  const pveRules = await prisma.firewallRule.findMany({
      where: { status: { not: "REMOVED" }, source: "PROXMOX", enabled: true },
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        action: true,
        direction: true,
        protocol: true,
        sourceSpec: true,
        destPort: true,
        descriptionText: true,
        enabled: true,
        metadata: true,
      },
    });

  const { pve, homeNetworkId, groupRuleCount } = buildAccessMapPveData(
    guestInterfaces,
    resolvedGuestObservations,
    pveRules,
    pveAddressSets,
    networks.map(({ id, name, cidr }) => ({ id, name, cidr })),
  );

  // Anonymize the final assembled map payload once, at the render boundary.
  const display = await anonymizeForDisplay({
    graph,
    members,
    carriers: physical.carriers,
    wireless: physical.wireless,
    wifiAps: physical.wifiAps,
    switches: physical.switches,
    cloudflare: cloudflareAccounts,
    tailscale,
    pve,
  });

  return {
    display,
    integrationEvidence,
    homeNetworkId: homeNetworkId ?? null,
    hasSwitchConfigs: switchConfigs.length > 0,
    empty:
      rules.length === 0 &&
      groupRuleCount === 0 &&
      cloudflareAccounts.length === 0 &&
      tailscale.length === 0,
  };
}
