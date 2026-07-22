/**
 * Lab footprint derivation.
 *
 * Pure logic (no server-only imports) that assembles the dashboard's overview
 * map: every machine grouped into the network it lives in, inter-network
 * reachability (from the access-map derivation), the physical layer (switch
 * uplinks / VLAN carriage), and — the headline — every inbound vector from the
 * Internet: destination-NAT port forwards, tunnel ingress (e.g. cloudflared)
 * and dynamic-DNS names, plus the firewall's gateways.
 *
 * Inbound vectors are never silently dropped: a NAT target or tunnel origin
 * that doesn't match any documented machine resolves to a pseudo "unknown
 * target" node instead.
 */

import {
  INTERNET_NODE_ID,
  cidrContains,
  isPrivateAddress,
} from "./access";

import {
  UNASSIGNED_LANE_ID,
  footprintRouteNodeId,
  type FpClient,
  type FpHostnameResolution,
  type FpMachine,
  type FpNetwork,
  type FpPortForward,
  type FootprintGraph,
  type FootprintInboundEdge,
  type FootprintInput,
  type FootprintLane,
  type FootprintLanePolicy,
  type FootprintMachine,
  type FootprintReachEdge,
  type FootprintRoute,
  type FootprintStats,
  type FootprintSwitchLink,
  type FootprintTunnel,
  type FootprintUnknownTarget,
} from "./footprint-types";

export * from "./footprint-types";

// ---------- input types (backend maps prisma rows to exactly these) ----------


export { focusFootprintGraph } from "./footprint-focus";

// ---------- helpers ----------

const CATEGORY_RANK: Record<FootprintLane["category"], number> = {
  mgmt: 0,
  lan: 1,
  other: 2,
  unassigned: 3,
  wan: 4,
};

const KIND_RANK: Record<FpMachine["kind"], number> = {
  host: 0,
  device: 1,
  vm: 2,
  ct: 3,
  firewall: 4,
  switch: 5,
};

function isLoopbackIp(ip: string): boolean {
  return cidrContains("127.0.0.0/8", ip);
}

/** Numeric sort key for a dotted IPv4 address (non-IPv4 sinks to 0). */
function ipSortKey(ip: string): number {
  return ip
    .split(".")
    .reduce((acc, octet) => acc * 256 + (Number(octet) || 0), 0);
}

/**
 * Networks a machine is homed on, in input order. Primary placement prefers
 * the first private-CIDR match so a machine with both a private and a public
 * address lands in its LAN, not the WAN.
 */
function machineHomes(machine: FpMachine, networks: FpNetwork[]): string[] {
  const matches: { id: string; isPrivate: boolean }[] = [];
  for (const net of networks) {
    if (!net.cidr) continue;
    if (machine.ips.some((ip) => cidrContains(net.cidr!, ip))) {
      matches.push({ id: net.id, isPrivate: isPrivateAddress(net.cidr) });
    }
  }
  const networkIds = new Set(networks.map((network) => network.id));
  const hints = (machine.networkHints ?? []).filter((id) => networkIds.has(id));
  const primary = matches.find((m) => m.isPrivate) ?? matches[0] ?? (hints[0] ? { id: hints[0], isPrivate: true } : undefined);
  if (!primary) return [];
  return [...new Set([
    primary.id,
    ...matches.filter((m) => m.id !== primary.id).map((m) => m.id),
    ...hints.filter((id) => id !== primary.id),
  ])];
}

function natLabel(pf: FpPortForward): string {
  const proto = pf.proto.trim() || "any";
  const port = pf.wanPort.trim() || "any";
  const remap =
    pf.targetPort && pf.targetPort !== pf.wanPort ? `→${pf.targetPort}` : "";
  return `${proto} ${port}${remap}`;
}

/** Host portion of a documented ingress service target. */
export function serviceTargetHost(
  serviceTarget: string | null | undefined,
): string | null {
  if (!serviceTarget) return null;
  const value = serviceTarget.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

/** IP portion of a documented ingress service target. */
export function serviceTargetIp(
  serviceTarget: string | null | undefined,
): string | null {
  const host = serviceTargetHost(serviceTarget);
  if (!host || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
  return host.split(".").every((part) => Number(part) <= 255) ? host : null;
}

function natSecondaryDetail(pf: FpPortForward): string {
  return [
    `wan:${pf.wanPort || "any"} → ${pf.targetIp}:${pf.targetPort || pf.wanPort || "any"}`,
    pf.proto.trim() || "any",
    pf.sourceRestricted ? "source-restricted" : null,
    pf.enabled ? null : "disabled",
  ].filter(Boolean).join(" · ");
}

function footprintNatEdge(pf: FpPortForward, targetId: string, label: string): FootprintInboundEdge {
  return {
    id: `nat:${pf.id}`, type: "nat", targetId, label,
    enabled: pf.enabled, sourceRestricted: pf.sourceRestricted,
    nat: {
      protocol: pf.proto.trim() || "any",
      publicPort: pf.wanPort.trim() || "any",
      targetPort: pf.targetPort?.trim() || pf.wanPort.trim() || "any",
      sourceSpec: pf.sourceSpec?.trim() || null,
      destinationSpec: pf.destinationSpec?.trim() || null,
    },
    detail: [{ primary: pf.description?.trim() || "(no description)", secondary: natSecondaryDetail(pf) }],
  };
}

// ---------- main derivation ----------

export function deriveFootprint(input: FootprintInput): FootprintGraph {
  const machineById = new Map(input.machines.map((m) => [m.id, m]));
  const ipToMachine = new Map<string, FpMachine>();
  const nameToMachine = new Map<string, FpMachine | null>();
  (() => {
  for (const machine of input.machines) {
    for (const ip of machine.ips) {
      if (!ipToMachine.has(ip)) ipToMachine.set(ip, machine);
    }
    const normalizedName = machine.name.trim().toLowerCase().replace(/\.$/, "");
    for (const alias of new Set([normalizedName, normalizedName.split(".")[0]])) {
      if (!alias) continue;
      if (!nameToMachine.has(alias)) {
        nameToMachine.set(alias, machine);
      } else if (nameToMachine.get(alias)?.id !== machine.id) {
        nameToMachine.set(alias, null);
      }
    }
  }
  })();
  const firewallMachine =
    input.machines.find((m) => m.kind === "firewall") ?? null;
  const machineForServiceHost = (host: string): FpMachine | undefined => {
    const byIp = ipToMachine.get(host);
    if (byIp) return byIp;
    if (nameToMachine.has(host)) return nameToMachine.get(host) ?? undefined;
    return nameToMachine.get(host.split(".")[0]) ?? undefined;
  };

  // ----- inbound vectors (resolved first so machines can carry counts) -----

  const inbound: FootprintInboundEdge[] = [];
  const unknown = new Map<string, FootprintUnknownTarget>();
  const natCounts = new Map<string, number>();
  const tunnelCounts = new Map<string, number>();

  const resolveTarget = (ip: string, viaLabel: string): string => {
    // Loopback targets (e.g. transparent-proxy redirects) are the firewall itself.
    if (isLoopbackIp(ip) && firewallMachine) return firewallMachine.id;
    const machine = ipToMachine.get(ip);
    if (machine) return machine.id;
    const id = `unknown:${ip}`;
    const entry = unknown.get(id) ?? { id, ip, via: [] };
    entry.via.push(viaLabel);
    unknown.set(id, entry);
    return id;
  };

  (() => {
  for (const pf of input.portForwards) {
    const label = natLabel(pf);
    const targetId = resolveTarget(pf.targetIp, label);
    inbound.push(footprintNatEdge(pf, targetId, label));
    if (pf.enabled) natCounts.set(targetId, (natCounts.get(targetId) ?? 0) + 1);
  }
  })();

  const footprintTunnels: FootprintTunnel[] = [];
  const routes: FootprintRoute[] = [];
  let exposedHostnames = 0;
  (() => {
  for (const tunnel of input.tunnels) {
    const connectorMachine = tunnel.originIp
      ? undefined
      : machineForServiceHost(tunnel.name.trim().toLowerCase().replace(/\.$/, ""));
    const originTargetId = tunnel.originIp
      ? resolveTarget(tunnel.originIp, tunnel.name)
      : (connectorMachine?.id ?? firewallMachine?.id ?? `unknown:${tunnel.name}`);
    if (!tunnel.originIp && !connectorMachine && !firewallMachine) {
      const id = `unknown:${tunnel.name}`;
      const entry = unknown.get(id) ?? { id, ip: tunnel.name, via: [] };
      entry.via.push(tunnel.name);
      unknown.set(id, entry);
    }
    // Merge resolution (when present) with the plain ingress list so every
    // documented hostname appears, resolved or not.
    const resByHost = new Map(
      (tunnel.hostnames ?? []).map((h) => [h.hostname, h]),
    );
    const hostnames: FpHostnameResolution[] = tunnel.ingressHostnames.map(
      (hostname): FpHostnameResolution =>
        resByHost.get(hostname) ?? {
          hostname,
          resolvedIps: [],
          classification: "unresolved",
          proxied: null,
        },
    );
    exposedHostnames += hostnames.filter(
      (h) => h.classification === "unproxied-wan-exposed",
    ).length;
    footprintTunnels.push({
      id: tunnel.id,
      name: tunnel.name,
      provider: tunnel.provider,
      targetId: originTargetId,
      hostnames,
    });

    // Each published hostname becomes a route node: Internet -> route -> the
    // machine that serves it (documented service target, else the tunnel
    // origin). Service targets match a synced machine by IP or an unambiguous
    // machine/DNS name; unmatched targets fall back to the connector origin.
    hostnames.forEach((h) => {
      const serviceIp = serviceTargetIp(h.serviceTarget);
      const serviceHost = serviceTargetHost(h.serviceTarget);
      const serviceMachine = serviceIp
        ? ipToMachine.get(serviceIp)
        : serviceHost
          ? machineForServiceHost(serviceHost)
          : undefined;
      routes.push({
        id: footprintRouteNodeId(tunnel.id, h.hostname),
        hostname: h.hostname,
        tunnelId: tunnel.id,
        tunnelName: tunnel.name,
        provider: tunnel.provider,
        classification: h.classification,
        resolvedIps: h.resolvedIps,
        serviceTarget: h.serviceTarget ?? null,
        targetId: serviceMachine?.id ?? originTargetId,
      });
    });
    tunnelCounts.set(
      originTargetId,
      (tunnelCounts.get(originTargetId) ?? 0) + 1,
    );
  }
  })();

  // ----- machines -> lanes -----

  const toFootprintMachine = (
    machine: FpMachine,
    homes: string[],
  ): FootprintMachine => ({
    ...machine,
    primaryNetworkId: homes[0] ?? null,
    secondaryNetworkIds: homes.slice(1),
    inboundNat: natCounts.get(machine.id) ?? 0,
    inboundTunnel: tunnelCounts.get(machine.id) ?? 0,
  });

  const laneMachines = new Map<string, FootprintMachine[]>();
  const firewalls: FootprintMachine[] = [];
  const switches: FootprintMachine[] = [];
  (() => {
  for (const machine of input.machines) {
    const homes = machineHomes(machine, input.networks);
    const fp = toFootprintMachine(machine, homes);
    if (machine.kind === "firewall") {
      firewalls.push(fp);
      continue;
    }
    if (machine.kind === "switch") {
      switches.push(fp);
      continue;
    }
    const laneId = fp.primaryNetworkId ?? UNASSIGNED_LANE_ID;
    const list = laneMachines.get(laneId) ?? [];
    list.push(fp);
    laneMachines.set(laneId, list);
  }
  })();

  // Client devices (DHCP/ARP) attach to their network. Defensively drop any
  // client already drawn as a synced machine (same IP) and de-dup within a
  // network — the input is ordered by precedence (static > dynamic > detected)
  // so the first entry for an IP wins.
  const clientsByNetwork = input.clients ?? {};
  const laneClients = (networkId: string): FpClient[] => {
    const raw = clientsByNetwork[networkId];
    if (!raw || raw.length === 0) return [];
    const seen = new Set<string>();
    const out: FpClient[] = [];
    for (const client of raw) {
      if (ipToMachine.has(client.ip)) continue;
      if (seen.has(client.ip)) continue;
      seen.add(client.ip);
      out.push(client);
    }
    out.sort((a, b) => ipSortKey(a.ip) - ipSortKey(b.ip));
    return out;
  };

  const lanes: FootprintLane[] = [];
  const lanePolicy = (machines: FootprintMachine[]): FootprintLanePolicy | null => {
    const workloads = machines.filter((machine) => machine.kind === "vm" || machine.kind === "ct");
    const protectedMachines = workloads.filter((machine) => machine.workloadPolicy?.firewallEnabled);
    if (protectedMachines.length === 0) return null;

    const baselineCounts = new Map<string, number>();
    const peerMembers = new Map<string, string[]>();
    for (const machine of protectedMachines) {
      const policy = machine.workloadPolicy!;
      if (policy.baselineGroup) {
        baselineCounts.set(policy.baselineGroup, (baselineCounts.get(policy.baselineGroup) ?? 0) + 1);
      }
      for (const group of policy.peerGroups) {
        const members = peerMembers.get(group) ?? [];
        members.push(machine.id);
        peerMembers.set(group, members);
      }
    }
    const baselineGroup = [...baselineCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    const peerGroups = [...peerMembers.entries()]
      .filter(([, memberIds]) => memberIds.length > 1)
      .map(([name, memberIds]) => ({ name, memberIds: memberIds.sort() }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      baselineGroup,
      protectedCount: protectedMachines.length,
      workloadCount: workloads.length,
      peerGroups,
    };
  };
  (() => {
  for (const net of input.networks) {
    const machines = laneMachines.get(net.id) ?? [];
    const clients = laneClients(net.id);
    // A network earns a lane when it has synced machines OR client devices.
    if (machines.length === 0 && clients.length === 0) continue;
    lanes.push({
      id: net.id,
      name: net.name,
      vlanId: net.vlanId ?? null,
      cidr: net.cidr ?? null,
      category: net.category,
      machines,
      clients,
      workloadPolicy: lanePolicy(machines),
    });
  }
  })();
  const unassigned = laneMachines.get(UNASSIGNED_LANE_ID);
  (() => {
  if (unassigned && unassigned.length > 0) {
    lanes.push({
      id: UNASSIGNED_LANE_ID,
      name: "Unassigned",
      vlanId: null,
      cidr: null,
      category: "unassigned",
      machines: unassigned,
      clients: [],
      workloadPolicy: lanePolicy(unassigned),
    });
  }
  })();
  lanes.sort(
    (a, b) =>
      CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] ||
      (a.vlanId ?? Number.MAX_SAFE_INTEGER) -
        (b.vlanId ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name),
  );
  for (const lane of lanes) {
    lane.machines.sort(
      (a, b) =>
        KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
        (a.workloadPolicy?.peerGroups[0] ?? "~").localeCompare(
          b.workloadPolicy?.peerGroups[0] ?? "~",
        ) ||
        a.name.localeCompare(b.name),
    );
  }
  const laneIds = new Set(lanes.map((lane) => lane.id));

  // ----- reachability (lane <-> lane / internet), from the access graph -----

  const reachability: FootprintReachEdge[] = [];
  (() => {
  for (const edge of input.accessGraph.edges) {
    const source =
      edge.source === INTERNET_NODE_ID ? INTERNET_NODE_ID : edge.source;
    const target =
      edge.target === INTERNET_NODE_ID ? INTERNET_NODE_ID : edge.target;
    const sourceOk = source === INTERNET_NODE_ID || laneIds.has(source);
    const targetOk = target === INTERNET_NODE_ID || laneIds.has(target);
    if (!sourceOk || !targetOk || source === target) continue;
    reachability.push({
      id: `reach:${edge.id}`,
      source,
      target,
      label: edge.label,
      rules: edge.rules,
    });
  }
  })();

  // ----- physical layer -----

  const switchLinks: FootprintSwitchLink[] = [];
  const switchIds = new Set(switches.map((sw) => sw.id));
  (() => {
  for (const uplink of input.uplinks) {
    if (!switchIds.has(uplink.switchId)) continue;
    const target = machineById.get(uplink.deviceId);
    if (!target || target.kind === "switch") continue;
    switchLinks.push({
      id: `uplink:${uplink.switchId}->${uplink.deviceId}`,
      switchId: uplink.switchId,
      kind: "uplink",
      targetId: uplink.deviceId,
      label: uplink.label,
    });
  }
  })();
  (() => {
  for (const carried of input.carriage ?? []) {
    if (!switchIds.has(carried.switchId) || !laneIds.has(carried.networkId))
      continue;
    switchLinks.push({
      id: `carriage:${carried.switchId}->${carried.networkId}`,
      switchId: carried.switchId,
      kind: "carriage",
      targetId: carried.networkId,
      label: `${carried.ports} port${carried.ports === 1 ? "" : "s"}`,
    });
  }
  })();

  // ----- summary -----

  const gateways = [...input.gateways].sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name),
  );
  const dyndns = [...input.dyndns].sort(
    (a, b) =>
      Number(b.enabled) - Number(a.enabled) ||
      a.hostname.localeCompare(b.hostname),
  );

  const exposedDyndns = dyndns.filter(
    (d) => d.resolution?.matchesWan === true,
  ).length;

  const stats: FootprintStats = {
    openPorts: input.portForwards.filter((pf) => pf.enabled).length,
    tunnelHostnames: input.tunnels.reduce(
      (acc, t) => acc + t.ingressHostnames.length,
      0,
    ),
    dyndnsNames: dyndns.filter((d) => d.enabled).length,
    exposedHostnames: exposedHostnames + exposedDyndns,
  };

  return {
    lanes,
    firewalls,
    switches,
    reachability,
    inbound,
    unknownTargets: [...unknown.values()].sort((a, b) =>
      a.ip.localeCompare(b.ip),
    ),
    switchLinks,
    gateways,
    dyndns,
    tunnels: footprintTunnels,
    routes,
    wanIp: input.wanIp ?? null,
    stats,
    unmapped: input.accessGraph.unmapped,
  };
}
