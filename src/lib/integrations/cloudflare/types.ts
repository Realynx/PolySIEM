export interface CloudflareDnsRecord {
  id: string;
  zoneId: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean | null;
  ttl: number | null;
  comment: string | null;
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
  type: string | null;
  nameServers: string[];
  dnsRecords: CloudflareDnsRecord[];
}

export interface CloudflareTunnelIngress {
  hostname: string | null;
  service: string;
  path: string | null;
}

export interface CloudflareTunnelConnection {
  id: string;
  connectorId: string | null;
  version: string | null;
  coloName: string | null;
  originIp: string | null;
  openedAt: string | null;
  pendingReconnect: boolean;
}

export interface CloudflareTunnel {
  id: string;
  name: string;
  status: string;
  configSource: "local" | "cloudflare" | "unknown";
  createdAt: string | null;
  ingress: CloudflareTunnelIngress[];
  connections: CloudflareTunnelConnection[];
}

export interface CloudflarePrivateRoute {
  id: string;
  network: string;
  comment: string | null;
  tunnelId: string | null;
  tunnelName: string | null;
  virtualNetworkId: string | null;
  virtualNetworkName: string | null;
}

/** Bounded, secret-free account evidence persisted in IntegrationConfig.settings. */
export interface CloudflareAccountSnapshot {
  schemaVersion: 1;
  integrationId: string;
  account: { id: string; name: string };
  capturedAt: string;
  zones: CloudflareZone[];
  tunnels: CloudflareTunnel[];
  privateRoutes: CloudflarePrivateRoute[];
  warnings: string[];
  routeManagementCapability: {
    status: "unknown" | "granted" | "denied";
    checkedAt: string | null;
    reason: string | null;
  };
}
