/**
 * Privacy-safe lab shape used by the deterministic scenario generator.
 *
 * A blueprint deliberately contains no database ids, names, hostnames, MACs,
 * addresses, or CIDRs. It captures only aggregate scale and coarse topology,
 * which makes it safe to persist in tests or use as a mock-data recipe.
 */

export type BlueprintNetworkCategory =
  | "wan"
  | "management"
  | "servers"
  | "services"
  | "users"
  | "iot"
  | "guest"
  | "vpn"
  | "storage"
  | "other";

export interface ScenarioBlueprintCounts {
  devices: number;
  vms: number;
  containers: number;
  networks: number;
  firewallRules: number;
  dhcpLeases: number;
  services: number;
  tunnels: number;
}

export interface ScenarioBlueprintNetwork {
  /** Anonymous ordinal, never a database id or network name. */
  key: string;
  category: BlueprintNetworkCategory;
  vlan: boolean;
  members: {
    devices: number;
    vms: number;
    containers: number;
    leases: number;
  };
}

export interface ScenarioBlueprint {
  version: 1;
  counts: ScenarioBlueprintCounts;
  topology: {
    networks: ScenarioBlueprintNetwork[];
    deviceKinds: Record<string, number>;
    firewallActions: { pass: number; block: number; reject: number; other: number };
    exposure: {
      enabledPortForwards: number;
      tunnels: number;
      publishedRoutes: number;
    };
  };
}

/** Minimal relation-only input easily projected from Prisma query results. */
export interface ScenarioBlueprintSource {
  devices: Array<{ id: string; kind?: string | null; networkIds?: string[] }>;
  vms: Array<{ id: string; networkIds?: string[] }>;
  containers: Array<{ id: string; networkIds?: string[] }>;
  networks: Array<{
    id: string;
    vlanId?: number | null;
    category?: BlueprintNetworkCategory | null;
  }>;
  firewallRules: Array<{ action?: string | null }>;
  dhcpLeases: Array<{ networkId?: string | null }>;
  services?: Array<unknown>;
  portForwards?: Array<{ enabled?: boolean }>;
  tunnels?: Array<{ publishedRouteCount?: number; ingressHostnames?: unknown[] }>;
}

function countBy(values: Array<string | null | undefined>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = value?.trim().toLowerCase() || "other";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function memberCount(
  records: Array<{ networkIds?: string[] }>,
  networkId: string,
): number {
  return records.filter((record) => record.networkIds?.includes(networkId)).length;
}

function normalizedAction(action: string | null | undefined): "pass" | "block" | "reject" | "other" {
  const normalized = action?.trim().toLowerCase();
  if (normalized === "pass" || normalized === "allow" || normalized === "accept") return "pass";
  if (normalized === "block" || normalized === "drop" || normalized === "deny") return "block";
  if (normalized === "reject") return "reject";
  return "other";
}

/**
 * Derive and anonymize a blueprint in one pass. Original identifiers are used
 * only for joins and are replaced by stable input-order ordinals in output.
 */
export function deriveScenarioBlueprint(source: ScenarioBlueprintSource): ScenarioBlueprint {
  const firewallActions = { pass: 0, block: 0, reject: 0, other: 0 };
  for (const rule of source.firewallRules) firewallActions[normalizedAction(rule.action)]++;
  const tunnels = source.tunnels ?? [];
  return {
    version: 1,
    counts: {
      devices: source.devices.length,
      vms: source.vms.length,
      containers: source.containers.length,
      networks: source.networks.length,
      firewallRules: source.firewallRules.length,
      dhcpLeases: source.dhcpLeases.length,
      services: source.services?.length ?? 0,
      tunnels: tunnels.length,
    },
    topology: {
      networks: source.networks.map((network, index) => ({
        key: `network-${index + 1}`,
        category: network.category ?? "other",
        vlan: network.vlanId !== null && network.vlanId !== undefined,
        members: {
          devices: memberCount(source.devices, network.id),
          vms: memberCount(source.vms, network.id),
          containers: memberCount(source.containers, network.id),
          leases: source.dhcpLeases.filter((lease) => lease.networkId === network.id).length,
        },
      })),
      deviceKinds: countBy(source.devices.map((device) => device.kind)),
      firewallActions,
      exposure: {
        enabledPortForwards: (source.portForwards ?? []).filter((forward) => forward.enabled !== false).length,
        tunnels: tunnels.length,
        publishedRoutes: tunnels.reduce(
          (total, tunnel) =>
            total + (tunnel.publishedRouteCount ?? tunnel.ingressHostnames?.length ?? 0),
          0,
        ),
      },
    },
  };
}

/**
 * Scale-only recipe modeled on the current lab proportions. All labels and
 * network identities are generic; no private inventory values are embedded.
 */
export const CURRENT_LAB_BLUEPRINT: ScenarioBlueprint = {
  version: 1,
  counts: {
    devices: 7,
    vms: 4,
    containers: 44,
    networks: 9,
    firewallRules: 31,
    dhcpLeases: 9,
    services: 0,
    tunnels: 2,
  },
  topology: {
    networks: [
      { key: "network-1", category: "wan", vlan: false, members: { devices: 1, vms: 0, containers: 0, leases: 0 } },
      { key: "network-2", category: "management", vlan: true, members: { devices: 2, vms: 0, containers: 2, leases: 1 } },
      { key: "network-3", category: "servers", vlan: true, members: { devices: 2, vms: 2, containers: 18, leases: 2 } },
      { key: "network-4", category: "services", vlan: true, members: { devices: 0, vms: 1, containers: 10, leases: 1 } },
      { key: "network-5", category: "iot", vlan: true, members: { devices: 1, vms: 0, containers: 6, leases: 2 } },
      { key: "network-6", category: "users", vlan: true, members: { devices: 0, vms: 1, containers: 4, leases: 1 } },
      { key: "network-7", category: "guest", vlan: true, members: { devices: 0, vms: 0, containers: 2, leases: 2 } },
      { key: "network-8", category: "vpn", vlan: false, members: { devices: 1, vms: 0, containers: 1, leases: 0 } },
      { key: "network-9", category: "storage", vlan: true, members: { devices: 1, vms: 0, containers: 1, leases: 0 } },
    ],
    deviceKinds: { hypervisor: 5, firewall: 1, switch: 1 },
    firewallActions: { pass: 20, block: 9, reject: 2, other: 0 },
    exposure: { enabledPortForwards: 2, tunnels: 2, publishedRoutes: 21 },
  },
};
