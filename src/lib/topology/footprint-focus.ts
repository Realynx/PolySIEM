import { INTERNET_NODE_ID } from "./access";
import type { FootprintGraph } from "./footprint";

/**
 * Build a one-asset inspection graph from the dashboard footprint.
 *
 * The selected machine remains the center. We retain its containing network,
 * one-hop policy routes, direct NAT/tunnel/service paths, host/guest
 * containment, and physical switch attachments. Connected network endpoints
 * remain as rails but do not bring every unrelated machine in that subnet.
 */
export function focusFootprintGraph(
  graph: FootprintGraph,
  targetId: string,
): FootprintGraph | null {
  const allMachines = graph.lanes.flatMap((lane) => lane.machines);
  const machineById = new Map(allMachines.map((machine) => [machine.id, machine]));
  const laneByMachine = new Map<string, string>();
  for (const lane of graph.lanes) {
    for (const machine of lane.machines) laneByMachine.set(machine.id, lane.id);
  }

  const targetMachine = machineById.get(targetId);
  const targetFirewall = graph.firewalls.find((machine) => machine.id === targetId);
  const targetSwitch = graph.switches.find((machine) => machine.id === targetId);
  if (!targetMachine && !targetFirewall && !targetSwitch) return null;

  const machineIds = new Set<string>();
  const laneIds = new Set<string>();
  const primaryLaneIds = new Set<string>();
  const addMachine = (id: string) => {
    const machine = machineById.get(id);
    if (!machine) return;
    machineIds.add(id);
    const laneId = laneByMachine.get(id);
    if (laneId) laneIds.add(laneId);
  };

  if (targetMachine) {
    addMachine(targetId);
    const laneId = laneByMachine.get(targetId);
    if (laneId) primaryLaneIds.add(laneId);
    if (targetMachine.hostId) addMachine(targetMachine.hostId);
    for (const machine of allMachines) {
      if (machine.hostId === targetId) addMachine(machine.id);
    }
    const peerGroups = new Set(targetMachine.workloadPolicy?.peerGroups ?? []);
    if (peerGroups.size > 0) {
      for (const machine of allMachines) {
        if (machine.workloadPolicy?.peerGroups.some((group) => peerGroups.has(group))) {
          addMachine(machine.id);
        }
      }
    }
  }

  const reachability = targetFirewall
    ? [...graph.reachability]
    : graph.reachability.filter(
        (edge) => primaryLaneIds.has(edge.source) || primaryLaneIds.has(edge.target),
      );
  for (const edge of reachability) {
    if (edge.source !== INTERNET_NODE_ID) laneIds.add(edge.source);
    if (edge.target !== INTERNET_NODE_ID) laneIds.add(edge.target);
  }

  const directTunnelIds = new Set(
    graph.tunnels
      .filter((tunnel) => tunnel.targetId === targetId)
      .map((tunnel) => tunnel.id),
  );
  const routes = graph.routes.filter(
    (route) => route.targetId === targetId || directTunnelIds.has(route.tunnelId),
  );
  for (const route of routes) addMachine(route.targetId);
  const tunnelIds = new Set(routes.map((route) => route.tunnelId));
  const routeHostsByTunnel = new Map<string, Set<string>>();
  for (const route of routes) {
    const hosts = routeHostsByTunnel.get(route.tunnelId) ?? new Set<string>();
    hosts.add(route.hostname);
    routeHostsByTunnel.set(route.tunnelId, hosts);
  }
  const tunnels = graph.tunnels
    .filter((tunnel) => tunnelIds.has(tunnel.id))
    .map((tunnel) => ({
      ...tunnel,
      hostnames: tunnel.hostnames.filter((hostname) =>
        routeHostsByTunnel.get(tunnel.id)?.has(hostname.hostname),
      ),
    }));

  const inbound = targetFirewall
    ? [...graph.inbound]
    : graph.inbound.filter((edge) => edge.targetId === targetId);

  const switchIds = new Set<string>();
  const switchLinks = graph.switchLinks.filter((link) => {
    const targetLane = link.kind === "carriage" && primaryLaneIds.has(link.targetId);
    const targetMachineLink = link.kind === "uplink" && link.targetId === targetId;
    const fromSelectedSwitch = link.switchId === targetId;
    if (!targetLane && !targetMachineLink && !fromSelectedSwitch) return false;
    switchIds.add(link.switchId);
    if (link.kind === "carriage") laneIds.add(link.targetId);
    else addMachine(link.targetId);
    return true;
  });

  const lanes = graph.lanes
    .filter((lane) => laneIds.has(lane.id))
    .map((lane) => {
      const machines = lane.machines.filter((machine) => machineIds.has(machine.id));
      const retainedIds = new Set(machines.map((machine) => machine.id));
      const workloadPolicy = lane.workloadPolicy
        ? {
            ...lane.workloadPolicy,
            protectedCount: machines.filter(
              (machine) => machine.workloadPolicy?.firewallEnabled,
            ).length,
            workloadCount: machines.filter(
              (machine) => machine.kind === "vm" || machine.kind === "ct",
            ).length,
            peerGroups: lane.workloadPolicy.peerGroups
              .map((group) => ({
                ...group,
                memberIds: group.memberIds.filter((id) => retainedIds.has(id)),
              }))
              .filter((group) => group.memberIds.length > 1),
          }
        : null;
      return { ...lane, machines, clients: [], workloadPolicy };
    });
  const includeFirewall =
    Boolean(targetFirewall) || reachability.length > 0 || inbound.length > 0;
  const firewalls = targetFirewall
    ? graph.firewalls.filter((machine) => machine.id === targetId)
    : includeFirewall
      ? [...graph.firewalls]
      : [];
  const switches = targetSwitch
    ? graph.switches.filter((machine) => machine.id === targetId)
    : graph.switches.filter((machine) => switchIds.has(machine.id));
  const gateways = firewalls.length > 0 || tunnels.length > 0 ? [...graph.gateways] : [];
  const unknownTargetIds = new Set(inbound.map((edge) => edge.targetId));

  return {
    lanes,
    firewalls,
    switches,
    reachability,
    inbound,
    unknownTargets: graph.unknownTargets.filter((target) =>
      unknownTargetIds.has(target.id),
    ),
    switchLinks,
    gateways,
    dyndns: [],
    tunnels,
    routes,
    wanIp: graph.wanIp,
    stats: {
      openPorts: inbound.filter((edge) => edge.enabled).length,
      tunnelHostnames: routes.length,
      dyndnsNames: 0,
      exposedHostnames: routes.filter(
        (route) => route.classification === "unproxied-wan-exposed",
      ).length,
    },
    unmapped: [],
  };
}
