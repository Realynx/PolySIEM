import { serviceTargetIp } from "./footprint";

export interface TraceTunnelIdentityInput {
  id: string;
  name: string;
  originIp: string | null;
  ingressHostnames: string[];
  deviceId: string | null;
  vmId: string | null;
  containerId: string | null;
  hostnames: { hostname: string; metadata: unknown }[];
}

export interface TraceAssetIdentityInput {
  type: "hosts" | "containers" | "vms";
  id: string;
  ips: string[];
}

export interface FocusedTraceIdentity {
  names: string[];
  ips: string[];
  domains: string[];
}

function cleanIp(value: string): string {
  return value.trim().replace(/^\[|\]$/g, "").split("/")[0].split("%")[0];
}

function serviceTarget(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>).serviceTarget;
  return typeof value === "string" ? value : null;
}

function directlyAttached(
  asset: TraceAssetIdentityInput,
  tunnel: TraceTunnelIdentityInput,
): boolean {
  if (asset.type === "hosts") return tunnel.deviceId === asset.id;
  if (asset.type === "containers") return tunnel.containerId === asset.id;
  return tunnel.vmId === asset.id;
}

/**
 * Return tunnel endpoints that appear in an asset's focused graph trace.
 * Route targets use the same documented serviceTarget IP rule as the graph.
 */
export function focusedTunnelTraceIdentity(
  asset: TraceAssetIdentityInput,
  tunnels: TraceTunnelIdentityInput[],
): FocusedTraceIdentity {
  const assetIps = new Set(asset.ips.map(cleanIp).filter(Boolean));
  const names = new Set<string>();
  const ips = new Set<string>();
  const domains = new Set<string>();

  for (const tunnel of tunnels) {
    const originIp = tunnel.originIp ? cleanIp(tunnel.originIp) : null;
    const ownsConnector = Boolean(originIp && assetIps.has(originIp));
    const attached = directlyAttached(asset, tunnel);
    const ingress = new Set(
      tunnel.ingressHostnames.map((hostname) => hostname.trim().toLowerCase()),
    );
    const matchedHostnames = tunnel.hostnames
      .filter((hostname) => ingress.has(hostname.hostname.trim().toLowerCase()))
      .filter((hostname) => {
        const targetIp = serviceTargetIp(serviceTarget(hostname.metadata));
        return Boolean(targetIp && assetIps.has(cleanIp(targetIp)));
      })
      .map((hostname) => hostname.hostname);

    if (!attached && !ownsConnector && matchedHostnames.length === 0) continue;

    const ownsWholeTunnel = attached || ownsConnector;
    // A connector may publish many unrelated apps. For a downstream service,
    // the focused route contributes only its hostname; matching the connector
    // host/IP would otherwise return every request handled by that tunnel.
    if (ownsWholeTunnel) {
      names.add(tunnel.name);
      if (originIp) ips.add(originIp);
    }
    const visibleHostnames = ownsWholeTunnel
      ? tunnel.ingressHostnames
      : matchedHostnames;
    for (const hostname of visibleHostnames) {
      const normalized = hostname.trim().toLowerCase();
      if (normalized) domains.add(normalized);
    }
  }

  return { names: [...names], ips: [...ips], domains: [...domains] };
}
