import type {
  CloudflareMapAccount,
  TailscaleMapTailnet,
} from "@/components/topology/network-access-map";

interface CloudflareSnapshotInput {
  integrationId: string;
  capturedAt: string;
  warnings: readonly unknown[];
  account: { name: string };
  tunnels: readonly {
    id: string;
    name: string;
    status: string;
    ingress: readonly {
      hostname: string | null;
      path: string | null;
      service: string;
    }[];
  }[];
  privateRoutes: readonly {
    id: string;
    network: string;
    tunnelName: string | null;
    virtualNetworkName: string | null;
  }[];
}

interface TailscaleSnapshotInput {
  integrationId: string;
  tailnet: string;
  capturedAt: string;
  warnings: readonly unknown[];
  dns: TailscaleMapTailnet["dns"];
  policy: TailscaleMapTailnet["policy"];
  devices: readonly {
    id: string;
    hostname: string;
    addresses: string[];
    online: boolean | null;
    tags: string[];
    advertisedRoutes: string[];
    enabledRoutes: string[];
    owner: string | null;
    isExternal: boolean;
    blocksIncomingConnections: boolean;
    connectivity: TailscaleMapTailnet["devices"][number]["connectivity"];
  }[];
}

export interface TailscaleAssetIdentity {
  assetId: string;
  assetKind: "device" | "vm" | "container";
}

const INTEGRATION_LABELS: Readonly<Record<string, string>> = {
  PROXMOX: "Proxmox",
  OPNSENSE: "OPNsense",
  UNIFI: "UniFi",
  CLOUDFLARE: "Cloudflare",
  TAILSCALE: "Tailscale",
  EDGE_NAT_SERVER: "Edge NAT Server",
};

export function buildIntegrationEvidence(
  integrationTypes: readonly string[],
): string[] {
  return integrationTypes.flatMap((type) => {
    const label = INTEGRATION_LABELS[type];
    return label ? [label] : [];
  });
}

export function buildCloudflareAccounts(
  snapshots: readonly CloudflareSnapshotInput[],
): CloudflareMapAccount[] {
  return snapshots.map((snapshot) => ({
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
}

export function buildTailscaleNetworks(
  snapshots: readonly Pick<TailscaleSnapshotInput, "integrationId" | "tailnet" | "dns">[],
) {
  return snapshots.map((snapshot) => ({
    id: `tailscale:${snapshot.integrationId}`,
    name: `Tailscale · ${snapshot.dns.tailnetDomain ?? (snapshot.tailnet === "-" ? "default tailnet" : snapshot.tailnet)}`,
    vlanId: null,
    cidr: null,
    externalId: `tailscale:${snapshot.tailnet}`,
    purpose: "Tailscale encrypted overlay",
    gateway: null,
    source: "TAILSCALE" as const,
  }));
}

export function buildTailscaleTailnets(
  snapshots: readonly TailscaleSnapshotInput[],
  assetsByDeviceId: ReadonlyMap<string, TailscaleAssetIdentity>,
): TailscaleMapTailnet[] {
  return snapshots.map((snapshot) => ({
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
      ...assetsByDeviceId.get(device.id),
    })),
  }));
}
