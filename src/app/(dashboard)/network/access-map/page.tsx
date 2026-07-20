import Link from "next/link";
import { Waypoints } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { deriveAccessGraph } from "@/lib/topology/access";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { expandVlanSpec } from "@/lib/switch/cisco";
import { resolveObservedAssetAddresses } from "@/lib/topology/address-evidence";
import { listStoredCloudflareSnapshots } from "@/lib/services/cloudflare";
import { listStoredTailscaleSnapshots } from "@/lib/services/tailscale";
import {
  containingPveNetwork,
  derivePveNetworkScopes,
  derivePveAccess,
  type PveGroupRuleInput,
  type PveGuestInput,
} from "@/lib/topology/pve-access";
import {
  NetworkAccessMap,
  type CloudflareMapAccount,
  type MapSwitch,
  type TailscaleMapTailnet,
  type MapWifiAp,
  type NetworkCarrier,
  type NetworkMember,
  type NetworkWifi,
} from "@/components/topology/network-access-map";

export const dynamic = "force-dynamic";

export const metadata = { title: "Access map" };

export default async function AccessMapPage() {
  const { user } = await requirePageUser();

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
  const integrationEvidence = activeIntegrations.flatMap(({ type }) => {
    if (type === "PROXMOX") return ["Proxmox"];
    if (type === "OPNSENSE") return ["OPNsense"];
    if (type === "UNIFI") return ["UniFi"];
    if (type === "CLOUDFLARE") return ["Cloudflare"];
    if (type === "TAILSCALE") return ["Tailscale"];
    if (type === "EDGE_NAT_SERVER") return ["Edge NAT Server"];
    return [];
  });
  const cloudflareAccounts: CloudflareMapAccount[] = cloudflareSnapshots.map((snapshot) => ({
    integrationId: snapshot.integrationId,
    accountName: snapshot.account.name,
    capturedAt: snapshot.capturedAt,
    warningCount: snapshot.warnings.length,
    applications: snapshot.tunnels.flatMap((tunnel) =>
      tunnel.ingress.flatMap((ingress, index) =>
        ingress.hostname
          ? [{
              id: `${tunnel.id}:${index}`,
              hostname: ingress.hostname,
              path: ingress.path,
              service: ingress.service,
              tunnelName: tunnel.name,
              tunnelStatus: tunnel.status,
            }]
          : [],
      ),
    ),
    privateRoutes: snapshot.privateRoutes.map((route) => ({
      id: route.id,
      network: route.network,
      tunnelName: route.tunnelName,
      virtualNetworkName: route.virtualNetworkName,
    })),
  }));
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
    ...tailscaleSnapshots.map((snapshot) => ({
      id: `tailscale:${snapshot.integrationId}`,
      name: `Tailscale · ${snapshot.dns.tailnetDomain ?? (snapshot.tailnet === "-" ? "default tailnet" : snapshot.tailnet)}`,
      vlanId: null,
      cidr: null,
      externalId: `tailscale:${snapshot.tailnet}`,
      purpose: "Tailscale encrypted overlay",
      gateway: null,
      source: "TAILSCALE" as const,
    })),
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
  // Layer 2: where each VLAN is physically delivered, from parsed switch
  // configs. Port-channels represent their members; access ports carry their
  // access/voice VLAN; trunks carry their allowed list (default: every VLAN
  // the switch knows) plus the native VLAN.
  const networkIdByVlan = new Map<number, string>();
  for (const net of networks) {
    if (net.vlanId !== null && !networkIdByVlan.has(net.vlanId)) networkIdByVlan.set(net.vlanId, net.id);
  }
  const carriers: Record<string, NetworkCarrier[]> = {};
  for (const config of switchConfigs) {
    const allVlanIds = config.vlans.map((v) => v.vlanId);
    const resolveNetworkId = (vlanId: number): string | null =>
      config.vlans.find((v) => v.vlanId === vlanId)?.networkId ?? networkIdByVlan.get(vlanId) ?? null;

    // SVI addresses join the member list of their network.
    for (const vlan of config.vlans) {
      if (!vlan.svIpAddress) continue;
      const networkId = resolveNetworkId(vlan.vlanId);
      if (!networkId) continue;
      const address = vlan.svIpAddress.split("/")[0];
      if (seen.has(`${networkId}|${address}`)) continue;
      seen.add(`${networkId}|${address}`);
      (members[networkId] ??= []).push({ ip: address, label: config.device.name, kind: "svi" });
    }

    const byNetwork = new Map<string, NetworkCarrier["entries"]>();
    for (const port of config.ports) {
      if (port.isShutdown) continue;
      // Members of a port-channel are represented by the Po interface.
      if (!port.isPortChannel && port.channelGroup !== null) continue;
      const vlanIds = new Set<number>();
      if (port.mode === "access" || port.accessVlanId !== null) {
        if (port.accessVlanId !== null) vlanIds.add(port.accessVlanId);
        if (port.voiceVlanId !== null) vlanIds.add(port.voiceVlanId);
      } else if (port.mode === "trunk") {
        for (const id of port.allowedVlans ? expandVlanSpec(port.allowedVlans) : allVlanIds) vlanIds.add(id);
        if (port.nativeVlanId !== null) vlanIds.add(port.nativeVlanId);
      }
      for (const vlanId of vlanIds) {
        const networkId = resolveNetworkId(vlanId);
        if (!networkId) continue;
        const entries = byNetwork.get(networkId) ?? [];
        entries.push({
          port: port.shortName,
          label: port.connectedDevice?.name ?? port.description,
          mode: port.mode === "access" ? "access" : "trunk",
        });
        byNetwork.set(networkId, entries);
      }
    }
    for (const [networkId, entries] of byNetwork) {
      (carriers[networkId] ??= []).push({ switchName: config.device.name, entries });
    }
  }

  for (const list of Object.values(members)) {
    list.sort((a, b) => ipSortKey(a.ip) - ipSortKey(b.ip));
  }

  const tailscale: TailscaleMapTailnet[] = tailscaleSnapshots.map((snapshot) => ({
    integrationId: snapshot.integrationId,
    tailnet: snapshot.tailnet,
    capturedAt: snapshot.capturedAt,
    warningCount: snapshot.warnings.length,
    dns: snapshot.dns,
    policy: snapshot.policy,
    devices: snapshot.devices.map((device) => ({
      id: device.id,
      name: device.hostname,
      addresses: device.addresses,
      online: device.online,
      tags: device.tags,
      advertisedRoutes: device.advertisedRoutes,
      enabledRoutes: device.enabledRoutes,
      owner: device.owner,
      isExternal: device.isExternal,
      blocksIncomingConnections: device.blocksIncomingConnections,
      connectivity: device.connectivity,
      ...tailscaleAssetByDeviceId.get(device.id),
    })),
  }));

  // WiFi as a physical medium: SSIDs deliver their VLAN network wirelessly.
  const wireless: Record<string, NetworkWifi[]> = {};
  const wifiNetworkIds = new Set<string>();
  for (const ssid of wifiSsids) {
    if (!ssid.networkId) continue;
    wifiNetworkIds.add(ssid.networkId);
    (wireless[ssid.networkId] ??= []).push({
      ssid: ssid.name,
      band: ssid.band,
      security: ssid.security,
      hidden: ssid.hidden,
      guest: ssid.isGuest,
      enabled: ssid.enabled,
    });
  }
  // Access points broadcast every SSID's network, so each AP node links to the
  // union of networks that have at least one SSID.
  const wifiApNodes: MapWifiAp[] = wifiAps.map((ap) => ({
    id: ap.id,
    name: ap.name,
    model: ap.model,
    networkIds: [...wifiNetworkIds],
  }));

  // Switch nodes for the plane: which networks each documented switch carries.
  const switchNodes: MapSwitch[] = switchConfigs.map((config) => {
    const carried = new Map<string, number>();
    for (const carrier of Object.entries(carriers)) {
      const [networkId, list] = carrier;
      for (const c of list) {
        if (c.switchName === config.device.name) {
          carried.set(networkId, (carried.get(networkId) ?? 0) + c.entries.length);
        }
      }
    }
    return {
      deviceId: config.device.id,
      name: config.device.name,
      carried: [...carried.entries()].map(([networkId, ports]) => ({ networkId, ports })),
    };
  });

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

  interface GuestMeta {
    firewall?: { enabled?: boolean; groups?: string[] };
  }
  const observedIpsByOwner = new Map<string, string[]>();
  for (const observation of resolvedGuestObservations) {
    const list = observedIpsByOwner.get(observation.ownerId) ?? [];
    if (!list.includes(observation.address)) list.push(observation.address);
    observedIpsByOwner.set(observation.ownerId, list);
  }
  const guestInputs = new Map<string, PveGuestInput>();
  const guestIdByExternalId = new Map<string, string>();
  for (const iface of guestInterfaces) {
    const owner = iface.container ?? iface.vm;
    if (!owner) continue;
    const kind = iface.container ? ("container" as const) : ("vm" as const);
    const meta = (owner.metadata ?? {}) as GuestMeta;
    const existing = guestInputs.get(owner.id);
    if (existing) {
      if (iface.ip?.address && !existing.ips.includes(iface.ip.address)) existing.ips.push(iface.ip.address);
      continue;
    }
    if (owner.externalId) guestIdByExternalId.set(owner.externalId, owner.id);
    guestInputs.set(owner.id, {
      id: owner.id,
      name: owner.name,
      kind,
      ips: [iface.ip?.address, ...(observedIpsByOwner.get(owner.id) ?? [])].filter(
        (address): address is string => Boolean(address),
      ),
      firewallEnabled: meta.firewall?.enabled === true,
      groups: meta.firewall?.groups ?? [],
    });
  }
  const pveGuests = [...guestInputs.values()];

  const groupRuleInputs: PveGroupRuleInput[] = [];
  for (const r of pveRules) {
    const meta = (r.metadata ?? {}) as {
      scope?: string;
      group?: string;
      groupComment?: string;
      guestExternalId?: string;
    };
    let group: string;
    let groupLabel: string | undefined;
    let scope: "group" | "guest";
    let groupComment = meta.groupComment ?? null;
    if (meta.scope === "group" && meta.group) {
      group = meta.group;
      scope = "group";
    } else if (meta.scope === "guest" && meta.guestExternalId) {
      const guestId = guestIdByExternalId.get(meta.guestExternalId);
      const guest = guestId ? guestInputs.get(guestId) : undefined;
      if (!guest) continue;
      group = `guest-local:${guest.id}`;
      groupLabel = `${guest.name} · local rules`;
      groupComment = "Rules defined directly on this Proxmox guest";
      scope = "guest";
      if (!guest.groups.includes(group)) guest.groups.push(group);
    } else {
      continue;
    }
    groupRuleInputs.push({
      group,
      groupLabel,
      scope,
      groupComment,
      direction: r.direction,
      action: r.action,
      sourceSpec: r.sourceSpec,
      protocol: r.protocol,
      destPort: r.destPort,
      enabled: r.enabled,
      comment: r.descriptionText,
    });
  }

  // Home network = where most firewalled guests live.
  const homeVotes = new Map<string, number>();
  for (const guest of pveGuests) {
    if (!guest.firewallEnabled) continue;
    for (const ip of guest.ips) {
      const net = containingPveNetwork(ip, networks);
      if (net) homeVotes.set(net.id, (homeVotes.get(net.id) ?? 0) + 1);
    }
  }
  const homeNetworkId = [...homeVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const pve =
    groupRuleInputs.length > 0
      ? derivePveAccess(
          pveGuests,
          groupRuleInputs,
          pveAddressSets,
          networks.map((n) => ({ id: n.id, name: n.name, cidr: n.cidr })),
          homeNetworkId,
        )
      : null;

  return (
    <div>
      <PageHeader
        title="Access map"
        description="One reachability view assembled from every connected source: gateway policy, Proxmox workload firewalls, observed addresses, switching, and WiFi."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Using evidence from</span>
        {integrationEvidence.map((source) => (
          <Badge key={source} variant="outline" className="font-normal">
            {source}
          </Badge>
        ))}
        {switchConfigs.length > 0 && (
          <Badge variant="outline" className="font-normal">switch configs</Badge>
        )}
      </div>
      {rules.length === 0 && groupRuleInputs.length === 0 && cloudflareAccounts.length === 0 && tailscale.length === 0 ? (
        <EmptyState
          icon={Waypoints}
          title="Nothing to map yet"
          description="Connect a network or compute integration with networks and firewall policy to draw the paths your environment allows."
          action={
            user.role === "ADMIN" ? (
              <Button asChild>
                <Link href="/settings/integrations">Add an integration</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <NetworkAccessMap
          graph={graph}
          members={members}
          carriers={carriers}
          wireless={wireless}
          wifiAps={wifiApNodes}
          switches={switchNodes}
          cloudflare={cloudflareAccounts}
          tailscale={tailscale}
          pve={pve}
          pveHomeNetworkId={homeNetworkId ?? null}
        />
      )}
    </div>
  );
}
