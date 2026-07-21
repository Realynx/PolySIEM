import type { TailscaleDnsSnapshot, TailscalePolicySnapshot } from "@/lib/validators/integrations";

export interface NetworkMember {
  ip: string;
  label: string | null;
  kind: "ip" | "lease-dynamic" | "lease-static" | "svi" | "detected";
  /** Synced asset identity; present members are promoted to their own graph node. */
  assetId?: string;
  assetKind?: "device" | "vm" | "container";
  /** Integration-provided DNS identity (for example a MagicDNS FQDN). */
  dnsName?: string;
}

/** Layer-2 delivery of a network: the switch ports/LAGs that carry its VLAN. */
export interface NetworkCarrier {
  switchName: string;
  entries: { port: string; label: string | null; mode: "trunk" | "access" }[];
}

/** A documented switch and the networks it carries, for its own node. */
export interface MapSwitch {
  deviceId: string;
  name: string;
  carried: { networkId: string; ports: number }[];
}

/** A wireless SSID that delivers a network over the air. */
export interface NetworkWifi {
  ssid: string;
  band: string | null;
  security: string | null;
  hidden: boolean;
  guest: boolean;
  enabled: boolean;
}

/** A wireless access point node and the networks it serves. */
export interface MapWifiAp {
  id: string;
  name: string;
  model: string | null;
  networkIds: string[];
}

/** Secret-free Cloudflare configuration projected into the access map. */
export interface CloudflareMapAccount {
  integrationId: string;
  accountName: string;
  capturedAt: string;
  warningCount: number;
  applications: {
    id: string;
    hostname: string;
    path: string | null;
    service: string;
    tunnelName: string;
    tunnelStatus: string;
  }[];
  privateRoutes: {
    id: string;
    network: string;
    tunnelName: string | null;
    virtualNetworkName: string | null;
  }[];
}

/** Secret-free Tailscale state projected into the shared access map. */
export interface TailscaleMapTailnet {
  integrationId: string;
  tailnet: string;
  capturedAt: string;
  warningCount: number;
  dns: TailscaleDnsSnapshot;
  policy: TailscalePolicySnapshot | null;
  devices: {
    id: string;
    name: string;
    addresses: string[];
    online: boolean | null;
    tags: string[];
    advertisedRoutes: string[];
    enabledRoutes: string[];
    owner: string | null;
    isExternal: boolean;
    blocksIncomingConnections: boolean;
    connectivity: {
      endpoints: string[];
      derp: string | null;
      mappingVariesByDestIp: boolean | null;
      derpLatency: { region: string; latencyMs: number; preferred: boolean }[];
    } | null;
    assetId?: string;
    assetKind?: "device" | "vm" | "container";
  }[];
}

