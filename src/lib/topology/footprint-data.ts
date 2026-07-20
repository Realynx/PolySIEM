import "server-only";

import { prisma } from "@/lib/db";
import { cidrContains, deriveAccessGraph } from "@/lib/topology/access";
import { expandVlanSpec } from "@/lib/switch/cisco";
import { resolveObservedAssetAddresses } from "@/lib/topology/address-evidence";
import { deriveProxmoxNetworkEvidence } from "@/lib/topology/proxmox-network-evidence";
import {
  derivePveAccess,
  type PveGroupRuleInput,
  type PveGuestInput,
} from "@/lib/topology/pve-access";
import { refreshTunnelDnsIfStale } from "@/lib/services/tunnel-dns";
import type { DnsClassification } from "@/lib/dns/cloudflare";
import { discoveredCloudflaredTunnels } from "@/lib/integrations/elasticsearch/catalog";
import { listStoredCloudflareSnapshots } from "@/lib/services/cloudflare";
import { listStoredTailscaleSnapshots } from "@/lib/services/tailscale";
import type {
  FootprintInput,
  FpCarriage,
  FpClient,
  FpHostnameResolution,
  FpMachine,
  FpNetwork,
  FpUplink,
} from "@/lib/topology/footprint";

const notRemoved = { status: { not: "REMOVED" as const } };

function deviceKind(kind: string): FpMachine["kind"] {
  if (kind === "firewall") return "firewall";
  if (kind === "switch") return "switch";
  if (kind === "hypervisor" || kind === "server") return "host";
  return "device";
}

/** Load everything the footprint derivation needs. */
export async function loadFootprintInput(): Promise<FootprintInput> {
  const [devices, vms, containers, networks, rules, pveRules, aliases, pveAddressSets, ips, assetInterfaces, switchConfigs, leases, neighbors, tailscaleSnapshots] =
    await Promise.all([
    prisma.device.findMany({
      where: notRemoved,
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true, osName: true },
    }),
    prisma.virtualMachine.findMany({
      where: notRemoved,
      orderBy: { name: "asc" },
      select: { id: true, name: true, externalId: true, powerState: true, hostId: true, osName: true, metadata: true },
    }),
    prisma.container.findMany({
      where: notRemoved,
      orderBy: { name: "asc" },
      select: { id: true, name: true, externalId: true, powerState: true, hostId: true, osName: true, metadata: true },
    }),
    prisma.network.findMany({
      where: notRemoved,
      orderBy: { name: "asc" },
      select: { id: true, name: true, vlanId: true, cidr: true, externalId: true, purpose: true },
    }),
    prisma.firewallRule.findMany({
      where: { ...notRemoved, enabled: true, source: { not: "PROXMOX" } },
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        action: true,
        enabled: true,
        sequence: true,
        protocol: true,
        sourceSpec: true,
        destSpec: true,
        destPort: true,
        descriptionText: true,
        metadata: true,
      },
    }),
    prisma.firewallRule.findMany({
      where: { ...notRemoved, enabled: true, source: "PROXMOX" },
      orderBy: { sequence: "asc" },
      select: {
        action: true,
        direction: true,
        protocol: true,
        sourceSpec: true,
        destPort: true,
        descriptionText: true,
        enabled: true,
        metadata: true,
      },
    }),
    prisma.firewallAlias.findMany({
      where: { ...notRemoved, aliasType: { notIn: ["pve-ipset", "pve-alias"] } },
      select: { name: true, aliasType: true, content: true },
    }),
    prisma.firewallAlias.findMany({
      where: { ...notRemoved, aliasType: { in: ["pve-ipset", "pve-alias"] } },
      select: { name: true, content: true },
    }),
    prisma.ipAddress.findMany({
      select: {
        address: true,
        networkId: true,
        interface: {
          select: {
            device: { select: { id: true, kind: true } },
            vm: { select: { id: true } },
            container: { select: { id: true } },
          },
        },
      },
    }),
    prisma.networkInterface.findMany({
      where: {
        OR: [
          { deviceId: { not: null } },
          { vmId: { not: null } },
          { containerId: { not: null } },
        ],
      },
      orderBy: { externalId: "asc" },
      select: {
        source: true,
        integrationId: true,
        macAddress: true,
        networkId: true,
        metadata: true,
        ip: { select: { address: true } },
        deviceId: true,
        vmId: true,
        containerId: true,
      },
    }),
    prisma.switchConfig.findMany({
      select: {
        device: { select: { id: true } },
        vlans: { select: { vlanId: true, networkId: true } },
        ports: {
          orderBy: { sortOrder: "asc" },
          select: {
            shortName: true,
            mode: true,
            accessVlanId: true,
            voiceVlanId: true,
            nativeVlanId: true,
            allowedVlans: true,
            channelGroup: true,
            isPortChannel: true,
            isShutdown: true,
            connectedDeviceId: true,
          },
        },
      },
    }),
    prisma.dhcpLease.findMany({
      where: notRemoved,
      select: { id: true, ipAddress: true, macAddress: true, hostname: true, isStatic: true, networkId: true },
    }),
    // permanent ARP entries are the firewall's own addresses — excluded.
    prisma.networkNeighbor.findMany({
      where: { ...notRemoved, permanent: false },
      select: { id: true, ipAddress: true, macAddress: true, hostname: true, manufacturer: true, networkId: true },
    }),
    listStoredTailscaleSnapshots(),
  ]);

  const proxmoxNetworkEvidence = deriveProxmoxNetworkEvidence(
    assetInterfaces.flatMap((iface) => {
      if (iface.source !== "PROXMOX" || !iface.integrationId) return [];
      const ownerId = iface.deviceId ?? iface.vmId ?? iface.containerId;
      if (!ownerId) return [];
      const metadata = iface.metadata && typeof iface.metadata === "object"
        ? iface.metadata as { bridge?: unknown; vlanTag?: unknown }
        : null;
      return [{
        ownerId,
        integrationId: iface.integrationId,
        bridge: typeof metadata?.bridge === "string" ? metadata.bridge : null,
        vlanTag: typeof metadata?.vlanTag === "number" ? metadata.vlanTag : null,
        address: iface.ip?.address ?? null,
        networkId: iface.networkId,
      }];
    }),
    networks,
    pveAddressSets.map((set) => ({ name: set.name, entries: set.content })),
  );
  // Tailnets are overlay membership, not proof that every peer can talk to
  // every other peer. They intentionally have no CIDR here so two separately
  // configured tailnets never absorb each other's 100.64.0.0/10 addresses;
  // interfaces attach assets to the correct overlay through integration IDs.
  const tailscaleNetworks = tailscaleSnapshots.map((snapshot) => ({
    id: `tailscale:${snapshot.integrationId}`,
    name: `Tailscale · ${snapshot.dns.tailnetDomain ?? (snapshot.tailnet === "-" ? "default tailnet" : snapshot.tailnet)}`,
    vlanId: null,
    cidr: null,
    externalId: `tailscale:${snapshot.tailnet}`,
    purpose: "Tailscale encrypted overlay",
  }));
  const allNetworks = [
    ...networks,
    ...proxmoxNetworkEvidence.inferredNetworks,
    ...tailscaleNetworks,
  ];
  const networkIdForAddress = (address: string): string | null => {
    const candidates = allNetworks
      .filter((network) => network.cidr && cidrContains(network.cidr, address))
      .sort((a, b) => Number(b.cidr?.split("/")[1] ?? 0) - Number(a.cidr?.split("/")[1] ?? 0));
    return candidates[0]?.id ?? null;
  };

  // The access graph provides both reachability and each network's category.
  const accessGraph = deriveAccessGraph(allNetworks, rules, aliases);
  const categoryOf = new Map(accessGraph.nodes.map((n) => [n.id, n.category]));

  const fpNetworks: FpNetwork[] = allNetworks
    .filter((net) => categoryOf.has(net.id))
    .map((net) => ({
      id: net.id,
      name: net.name,
      vlanId: net.vlanId,
      cidr: net.cidr,
      category: categoryOf.get(net.id) ?? "other",
    }));

  // ----- machines + their addresses -----

  const ipsByOwner = new Map<string, string[]>();
  const addOwnerIp = (ownerId: string, address: string): void => {
    const list = ipsByOwner.get(ownerId) ?? [];
    if (!list.includes(address)) list.push(address);
    ipsByOwner.set(ownerId, list);
  };
  const tailscaleNetworkIdByIntegration = new Map(
    tailscaleSnapshots.map((snapshot) => [
      snapshot.integrationId,
      `tailscale:${snapshot.integrationId}`,
    ]),
  );
  const tailscaleHintsByOwner = new Map<string, string[]>();
  for (const iface of assetInterfaces) {
    if (iface.source !== "TAILSCALE" || !iface.integrationId) continue;
    const ownerId = iface.deviceId ?? iface.vmId ?? iface.containerId;
    const networkId = tailscaleNetworkIdByIntegration.get(iface.integrationId);
    if (!ownerId || !networkId) continue;
    const hints = tailscaleHintsByOwner.get(ownerId) ?? [];
    if (!hints.includes(networkId)) hints.push(networkId);
    tailscaleHintsByOwner.set(ownerId, hints);
  }
  const networkHintsFor = (ownerId: string): string[] | undefined => {
    const hints = [
      ...(proxmoxNetworkEvidence.networkHintsByOwner.get(ownerId) ?? []),
      ...(tailscaleHintsByOwner.get(ownerId) ?? []),
    ];
    return hints.length > 0 ? [...new Set(hints)] : undefined;
  };
  for (const ip of ips) {
    const ownerId = ip.interface?.device?.id ?? ip.interface?.vm?.id ?? ip.interface?.container?.id;
    if (!ownerId) continue;
    addOwnerIp(ownerId, ip.address);
  }
  const observedAddresses = resolveObservedAssetAddresses(
    assetInterfaces.flatMap((iface) => {
      const ownerId = iface.deviceId ?? iface.vmId ?? iface.containerId;
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
  for (const observed of observedAddresses) {
    addOwnerIp(observed.ownerId, observed.address);
  }

  // Proxmox policy subdivides a VLAN after layer-2 placement. Reuse the same
  // derivation as the Access Map so default-deny and peer-group semantics stay
  // consistent between both views.
  interface GuestMeta {
    firewall?: { enabled?: boolean; groups?: string[] };
  }
  const pveGuests = new Map<string, PveGuestInput>();
  const guestIdByExternalId = new Map<string, string>();
  for (const guest of [
    ...vms.map((vm) => ({ ...vm, kind: "vm" as const })),
    ...containers.map((ct) => ({ ...ct, kind: "container" as const })),
  ]) {
    const meta = (guest.metadata ?? {}) as GuestMeta;
    if (guest.externalId) guestIdByExternalId.set(guest.externalId, guest.id);
    pveGuests.set(guest.id, {
      id: guest.id,
      name: guest.name,
      kind: guest.kind,
      ips: ipsByOwner.get(guest.id) ?? [],
      firewallEnabled: meta.firewall?.enabled === true,
      groups: [...(meta.firewall?.groups ?? [])],
    });
  }

  const pveGroupRules: PveGroupRuleInput[] = [];
  for (const rule of pveRules) {
    const meta = (rule.metadata ?? {}) as {
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
      const guest = guestId ? pveGuests.get(guestId) : undefined;
      if (!guest) continue;
      group = `guest-local:${guest.id}`;
      groupLabel = `${guest.name} · local rules`;
      groupComment = "Rules defined directly on this Proxmox guest";
      scope = "guest";
      if (!guest.groups.includes(group)) guest.groups.push(group);
    } else {
      continue;
    }
    pveGroupRules.push({
      group,
      groupLabel,
      scope,
      groupComment,
      direction: rule.direction,
      action: rule.action,
      sourceSpec: rule.sourceSpec,
      protocol: rule.protocol,
      destPort: rule.destPort,
      enabled: rule.enabled,
      comment: rule.descriptionText,
    });
  }

  const pveView = pveGroupRules.length > 0
    ? derivePveAccess(
        [...pveGuests.values()],
        pveGroupRules,
        pveAddressSets.map((set) => ({ name: set.name, entries: set.content })),
        fpNetworks.map((network) => ({ id: network.id, name: network.name, cidr: network.cidr ?? null })),
      )
    : null;
  const pveBaseline = pveView?.baseline?.group ?? null;
  const pvePeerGroups = new Set(
    pveView?.groups.filter((group) => group.peer).map((group) => group.name) ?? [],
  );
  const pveServiceGroups = new Set(
    pveView?.groups.filter((group) => !group.peer).map((group) => group.name) ?? [],
  );
  const workloadPolicyFor = (ownerId: string): FpMachine["workloadPolicy"] => {
    const guest = pveGuests.get(ownerId);
    if (!guest?.firewallEnabled) return undefined;
    const nonBaselineGroups = guest.groups.filter((group) => group !== pveBaseline);
    return {
      firewallEnabled: true,
      baselineGroup: pveBaseline && guest.groups.includes(pveBaseline) ? pveBaseline : null,
      groups: nonBaselineGroups,
      peerGroups: nonBaselineGroups.filter((group) => pvePeerGroups.has(group)),
      serviceGroups: nonBaselineGroups.filter((group) => pveServiceGroups.has(group)),
    };
  };

  const machines: FpMachine[] = [
    ...devices.map((device): FpMachine => {
      const kind = deviceKind(device.kind);
      return {
        id: device.id,
        name: device.name,
        kind,
        ips: ipsByOwner.get(device.id) ?? [],
        networkHints: networkHintsFor(device.id),
        osName: device.osName,
        detailHref: `/inventory/hosts/${device.id}`,
      };
    }),
    ...vms.map(
      (vm): FpMachine => ({
        id: vm.id,
        name: vm.name,
        kind: "vm",
        powerState: vm.powerState,
        hostId: vm.hostId,
        ips: ipsByOwner.get(vm.id) ?? [],
        networkHints: networkHintsFor(vm.id),
        osName: vm.osName,
        workloadPolicy: workloadPolicyFor(vm.id),
        detailHref: `/inventory/vms/${vm.id}`,
      }),
    ),
    ...containers.map(
      (ct): FpMachine => ({
        id: ct.id,
        name: ct.name,
        kind: "ct",
        powerState: ct.powerState,
        hostId: ct.hostId,
        ips: ipsByOwner.get(ct.id) ?? [],
        networkHints: networkHintsFor(ct.id),
        osName: ct.osName,
        workloadPolicy: workloadPolicyFor(ct.id),
        detailHref: `/inventory/containers/${ct.id}`,
      }),
    ),
  ];

  // ----- client devices: DHCP leases + ARP neighbors on each network -----
  //
  // Everything the firewall/DHCP server sees that inventory hasn't synced as
  // its own machine: phones, cameras, IoT, static-IP boxes. Deduped by IP
  // against synced machine addresses (a synced machine always wins) and against
  // each other with precedence static lease > dynamic lease > detected.

  const machineIps = new Set<string>();
  for (const machine of machines) for (const ip of machine.ips) machineIps.add(ip);

  const fpNetworkIds = new Set(fpNetworks.map((net) => net.id));
  const clients: Record<string, FpClient[]> = {};
  const seenClient = new Set<string>();
  const addClient = (
    networkId: string | null,
    ip: string,
    label: string | null,
    kind: FpClient["kind"],
  ): void => {
    if (!networkId || !fpNetworkIds.has(networkId)) return;
    if (machineIps.has(ip)) return; // already drawn as a synced machine
    const key = `${networkId}|${ip}`;
    if (seenClient.has(key)) return; // a higher-precedence entry already claimed it
    seenClient.add(key);
    (clients[networkId] ??= []).push({ ip, label, kind });
  };
  const leaseLabel = (hostname: string | null): string | null =>
    hostname && hostname !== "*" ? hostname : null;
  // Precedence via processing order: static reservations, then dynamic leases,
  // then ARP-only detections fill in whatever the lease list missed.
  for (const lease of leases) if (lease.isStatic) addClient(lease.networkId ?? networkIdForAddress(lease.ipAddress), lease.ipAddress, leaseLabel(lease.hostname), "lease-static");
  for (const lease of leases) if (!lease.isStatic) addClient(lease.networkId ?? networkIdForAddress(lease.ipAddress), lease.ipAddress, leaseLabel(lease.hostname), "lease-dynamic");
  for (const n of neighbors) addClient(n.networkId ?? networkIdForAddress(n.ipAddress), n.ipAddress, n.hostname ?? n.manufacturer, "detected");

  const clientIpSortKey = (ip: string) =>
    ip.split(".").reduce((acc, octet) => acc * 256 + (Number(octet) || 0), 0);
  for (const list of Object.values(clients)) list.sort((a, b) => clientIpSortKey(a.ip) - clientIpSortKey(b.ip));

  // ----- physical layer from parsed switch configs -----

  const uplinks: FpUplink[] = [];
  const carriage: FpCarriage[] = [];
  const networkIdByVlan = new Map<number, string>();
  for (const net of allNetworks) {
    if (net.vlanId !== null && !networkIdByVlan.has(net.vlanId)) networkIdByVlan.set(net.vlanId, net.id);
  }
  for (const config of switchConfigs) {
    const switchId = config.device.id;
    const allVlanIds = config.vlans.map((v) => v.vlanId);
    const resolveNetworkId = (vlanId: number): string | null =>
      config.vlans.find((v) => v.vlanId === vlanId)?.networkId ?? networkIdByVlan.get(vlanId) ?? null;

    // Uplinks: one edge per (switch, connected device); Po edges absorb members.
    const memberCounts = new Map<number, number>();
    for (const port of config.ports) {
      if (!port.isPortChannel && port.channelGroup !== null) {
        memberCounts.set(port.channelGroup, (memberCounts.get(port.channelGroup) ?? 0) + 1);
      }
    }
    const labelsByDevice = new Map<string, string[]>();
    for (const port of config.ports) {
      if (!port.connectedDeviceId) continue;
      if (!port.isPortChannel && port.channelGroup !== null) continue;
      let label = port.shortName;
      if (port.isPortChannel) {
        const channel = /(\d+)$/.exec(port.shortName)?.[1];
        const members = channel ? (memberCounts.get(Number(channel)) ?? 0) : 0;
        if (members > 0) label = `${port.shortName} · ${members}×`;
      }
      const labels = labelsByDevice.get(port.connectedDeviceId) ?? [];
      labels.push(label);
      labelsByDevice.set(port.connectedDeviceId, labels);
    }
    for (const [deviceId, labels] of labelsByDevice) {
      uplinks.push({ switchId, deviceId, label: labels.join(", ") });
    }

    // Carriage: how many active ports/LAGs deliver each network's VLAN.
    const portCounts = new Map<string, number>();
    for (const port of config.ports) {
      if (port.isShutdown) continue;
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
        portCounts.set(networkId, (portCounts.get(networkId) ?? 0) + 1);
      }
    }
    for (const [networkId, ports] of portCounts) {
      carriage.push({ switchId, networkId, ports });
    }
  }

  // ----- WAN address: the firewall's IP on the wan-keyed network -----

  const wanNetworkId = allNetworks.find((net) => (net.externalId ?? "").toLowerCase() === "wan")?.id ?? null;
  let wanIp: string | null = null;
  if (wanNetworkId) {
    const wanIps = ips.filter((ip) => ip.networkId === wanNetworkId);
    wanIp =
      wanIps.find((ip) => ip.interface?.device?.kind === "firewall")?.address ?? wanIps[0]?.address ?? null;
  }

  // ----- inbound vectors + gateways -----

  const [pfRows, ddRows, tunnelRows, gwRows, elasticRows, cloudflareSnapshots] = await Promise.all([
    prisma.portForward.findMany({
      where: notRemoved,
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        protocol: true,
        destSpec: true,
        destPort: true,
        targetIp: true,
        targetPort: true,
        descriptionText: true,
        enabled: true,
        sourceSpec: true,
      },
    }),
    prisma.dyndnsHost.findMany({
      where: notRemoved,
      orderBy: { hostname: "asc" },
      select: { id: true, hostname: true, service: true, enabled: true, currentIp: true, metadata: true },
    }),
    prisma.tunnel.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        provider: true,
        originIp: true,
        ingressHostnames: true,
        hostnames: {
          select: { hostname: true, resolvedIps: true, proxied: true, metadata: true },
        },
      },
    }),
    prisma.networkGateway.findMany({
      where: notRemoved,
      orderBy: { name: "asc" },
      select: { id: true, name: true, interfaceName: true, ipAddress: true, isDefault: true, online: true },
    }),
    prisma.integrationConfig.findMany({
      where: { type: "ELASTICSEARCH", enabled: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, settings: true },
    }),
    listStoredCloudflareSnapshots(),
  ]);

  const isUnrestricted = (spec: string | null): boolean =>
    !spec || spec.trim() === "" || spec.trim() === "*" || spec.trim().toLowerCase() === "any";

  const portForwards: FootprintInput["portForwards"] = pfRows.map((pf) => ({
    id: pf.id,
    proto: pf.protocol ?? "any",
    wanPort: pf.destPort ?? "",
    targetIp: pf.targetIp,
    targetPort: pf.targetPort,
    description: pf.descriptionText,
    enabled: pf.enabled,
    sourceRestricted: !isUnrestricted(pf.sourceSpec),
    sourceSpec: pf.sourceSpec,
    destinationSpec: pf.destSpec,
  }));

  const classificationOf = (proxied: boolean | null, meta: unknown): DnsClassification => {
    const fromMeta = meta && typeof meta === "object" ? (meta as { classification?: unknown }).classification : undefined;
    if (typeof fromMeta === "string" && ["proxied", "unproxied-wan-exposed", "unproxied-other", "unresolved"].includes(fromMeta)) {
      return fromMeta as DnsClassification;
    }
    if (proxied === true) return "proxied";
    if (proxied === false) return "unproxied-other";
    return "unresolved";
  };

  const tunnels: FootprintInput["tunnels"] = tunnelRows.map((t) => ({
    id: t.id,
    name: t.name,
    provider: t.provider,
    originIp: t.originIp,
    ingressHostnames: t.ingressHostnames,
    hostnames: t.hostnames.map((h): FpHostnameResolution => {
      const meta = h.metadata && typeof h.metadata === "object" ? (h.metadata as Record<string, unknown>) : null;
      return {
        hostname: h.hostname,
        resolvedIps: h.resolvedIps,
        proxied: h.proxied,
        classification: classificationOf(h.proxied, h.metadata),
        serviceTarget: typeof meta?.serviceTarget === "string" ? (meta.serviceTarget as string) : null,
      };
    }),
  }));
  const documentedHostnames = new Set(
    tunnels.flatMap((tunnel) => tunnel.ingressHostnames.map((hostname) => hostname.toLowerCase())),
  );
  // Account configuration is stronger evidence than routes inferred from
  // logs. Keep each account/tunnel separate and preserve the configured
  // service target so the footprint can attach a hostname to its workload.
  for (const snapshot of cloudflareSnapshots) {
    for (const tunnel of snapshot.tunnels) {
      const ingress = tunnel.ingress.filter(
        (route): route is typeof route & { hostname: string } =>
          Boolean(route.hostname) && !documentedHostnames.has(route.hostname!.toLowerCase()),
      );
      if (ingress.length === 0) continue;
      ingress.forEach((route) => documentedHostnames.add(route.hostname.toLowerCase()));
      tunnels.push({
        id: `cloudflare:${snapshot.integrationId}:${tunnel.id}`,
        name: `${snapshot.account.name} · ${tunnel.name}`,
        provider: "cloudflare-api",
        originIp: tunnel.connections.find((connection) => connection.originIp)?.originIp ?? null,
        ingressHostnames: ingress.map((route) => route.hostname),
        hostnames: ingress.map((route) => ({
          hostname: route.hostname,
          resolvedIps: snapshot.zones.flatMap((zone) =>
            zone.dnsRecords
              .filter((record) => record.name.toLowerCase() === route.hostname.toLowerCase())
              .map((record) => record.content),
          ),
          proxied: true,
          classification: "proxied" as const,
          serviceTarget: route.service,
        })),
      });
    }
  }
  for (const integration of elasticRows) {
    for (const discovered of discoveredCloudflaredTunnels(integration)) {
      const hostnames = discovered.hostnames.filter(
        (route) => !documentedHostnames.has(route.hostname.toLowerCase()),
      );
      if (hostnames.length === 0) continue;
      hostnames.forEach((route) => documentedHostnames.add(route.hostname.toLowerCase()));
      tunnels.push({
        ...discovered,
        ingressHostnames: hostnames.map((route) => route.hostname),
        hostnames,
      });
    }
  }

  const dyndns: FootprintInput["dyndns"] = ddRows.map((d) => {
    const meta = d.metadata && typeof d.metadata === "object" ? (d.metadata as Record<string, unknown>) : null;
    const resolvedIps = Array.isArray(meta?.resolvedIps) ? (meta!.resolvedIps as string[]) : null;
    return {
      id: d.id,
      hostname: d.hostname,
      service: d.service,
      enabled: d.enabled,
      currentIp: d.currentIp,
      resolution: resolvedIps
        ? { resolvedIps, matchesWan: typeof meta?.matchesWan === "boolean" ? (meta!.matchesWan as boolean) : null }
        : null,
    };
  });
  const gateways: FootprintInput["gateways"] = gwRows;

  // Kick a background DNS refresh if the last one is stale — never blocks render.
  void refreshTunnelDnsIfStale();

  return {
    machines,
    networks: fpNetworks,
    accessGraph,
    uplinks,
    carriage,
    clients,
    portForwards,
    dyndns,
    tunnels,
    gateways,
    // The firewall's own WAN address when documented; otherwise fall back to
    // the default gateway's observed address so the Internet node isn't blank.
    wanIp: wanIp ?? gateways.find((gw) => gw.isDefault)?.ipAddress ?? null,
  };
}
