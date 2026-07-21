import { expandVlanSpec } from "@/lib/switch/cisco";
import type {
  MapSwitch,
  MapWifiAp,
  NetworkCarrier,
  NetworkMember,
  NetworkWifi,
} from "@/components/topology/network-access-map";

interface NetworkRef {
  id: string;
  vlanId: number | null;
}

interface SwitchConfigInput {
  device: { id: string; name: string };
  vlans: readonly {
    vlanId: number;
    svIpAddress: string | null;
    networkId: string | null;
  }[];
  ports: readonly {
    shortName: string;
    description: string | null;
    mode: string | null;
    accessVlanId: number | null;
    voiceVlanId: number | null;
    nativeVlanId: number | null;
    allowedVlans: string | null;
    channelGroup: number | null;
    isPortChannel: boolean;
    isShutdown: boolean;
    connectedDevice: { name: string } | null;
  }[];
}

interface WirelessNetworkInput {
  name: string;
  band: string | null;
  security: string | null;
  hidden: boolean;
  isGuest: boolean;
  enabled: boolean;
  networkId: string | null;
}

interface WirelessApInput {
  id: string;
  name: string;
  model: string | null;
}

export interface SwitchSviMember {
  networkId: string;
  member: NetworkMember;
}

export interface PhysicalNetworkData {
  carriers: Record<string, NetworkCarrier[]>;
  switches: MapSwitch[];
  wireless: Record<string, NetworkWifi[]>;
  wifiAps: MapWifiAp[];
  sviMembers: SwitchSviMember[];
}

/** Derive layer-2 delivery, SVI members, and wireless delivery from inventory. */
export function buildPhysicalNetworkData(
  networks: readonly NetworkRef[],
  switchConfigs: readonly SwitchConfigInput[],
  wifiSsids: readonly WirelessNetworkInput[],
  wifiAps: readonly WirelessApInput[],
): PhysicalNetworkData {
  const networkIdByVlan = new Map<number, string>();
  for (const network of networks) {
    if (
      network.vlanId !== null &&
      !networkIdByVlan.has(network.vlanId)
    ) {
      networkIdByVlan.set(network.vlanId, network.id);
    }
  }

  const carriers: Record<string, NetworkCarrier[]> = {};
  const sviMembers: SwitchSviMember[] = [];
  for (const config of switchConfigs) {
    const allVlanIds = config.vlans.map((vlan) => vlan.vlanId);
    const resolveNetworkId = (vlanId: number): string | null =>
      config.vlans.find((vlan) => vlan.vlanId === vlanId)?.networkId ??
      networkIdByVlan.get(vlanId) ??
      null;

    for (const vlan of config.vlans) {
      if (!vlan.svIpAddress) continue;
      const networkId = resolveNetworkId(vlan.vlanId);
      if (!networkId) continue;
      sviMembers.push({
        networkId,
        member: {
          ip: vlan.svIpAddress.split("/")[0],
          label: config.device.name,
          kind: "svi",
        },
      });
    }

    const byNetwork = new Map<string, NetworkCarrier["entries"]>();
    for (const port of config.ports) {
      if (port.isShutdown) continue;
      if (!port.isPortChannel && port.channelGroup !== null) continue;
      const vlanIds = new Set<number>();
      if (port.mode === "access" || port.accessVlanId !== null) {
        if (port.accessVlanId !== null) vlanIds.add(port.accessVlanId);
        if (port.voiceVlanId !== null) vlanIds.add(port.voiceVlanId);
      } else if (port.mode === "trunk") {
        for (const id of port.allowedVlans
          ? expandVlanSpec(port.allowedVlans)
          : allVlanIds) {
          vlanIds.add(id);
        }
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
      (carriers[networkId] ??= []).push({
        switchName: config.device.name,
        entries,
      });
    }
  }

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

  const wifiApNodes = wifiAps.map((ap) => ({
    id: ap.id,
    name: ap.name,
    model: ap.model,
    networkIds: [...wifiNetworkIds],
  }));
  const switchNodes = switchConfigs.map((config) => {
    const carried = new Map<string, number>();
    for (const [networkId, carrierList] of Object.entries(carriers)) {
      for (const carrier of carrierList) {
        if (carrier.switchName === config.device.name) {
          carried.set(
            networkId,
            (carried.get(networkId) ?? 0) + carrier.entries.length,
          );
        }
      }
    }
    return {
      deviceId: config.device.id,
      name: config.device.name,
      carried: [...carried.entries()].map(([networkId, ports]) => ({
        networkId,
        ports,
      })),
    };
  });

  return {
    carriers,
    switches: switchNodes,
    wireless,
    wifiAps: wifiApNodes,
    sviMembers,
  };
}
