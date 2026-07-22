import { cidrContains } from "@/lib/topology/access";
import type { TailscaleMapTailnet } from "./types";

const PVE_NODE_HEADER_HEIGHT = 42;
const PVE_MEMBER_ROW_HEIGHT = 20;
const PVE_VISIBLE_MEMBER_LIMIT = 8;

export function pveNodeId(ref: {
  type: string;
  networkId?: string;
  group?: string;
  setId?: string;
}): string {
  if (ref.type === "network") return ref.networkId!;
  if (ref.type === "group") return `pve:grp:${ref.group}`;
  if (ref.type === "baseline") return "pve:baseline";
  return `pve:set:${ref.setId}`;
}

export const interfaceGateId = (networkId: string) => `interface-gate:${networkId}`;

export function serviceHost(service: string): string | null {
  const value = service.trim();
  if (!value || ["http_status:404", "hello_world"].includes(value.toLowerCase())) return null;
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname
      .replace(/^\[|\]$/g, "")
      .toLowerCase();
  } catch {
    return null;
  }
}

export function normalizedAssetName(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "").split(".")[0];
}

export type TailscaleMapDevice = TailscaleMapTailnet["devices"][number];

export function splitTailscaleDestination(value: string): { selector: string; ports: string | null } {
  const trimmed = value.trim();
  const bracketed = trimmed.match(/^\[([^\]]+)](?::(.+))?$/);
  if (bracketed) return { selector: bracketed[1], ports: bracketed[2] ?? null };
  const portSuffix = trimmed.match(/^(.*):(\*|\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/);
  return portSuffix
    ? { selector: portSuffix[1], ports: portSuffix[2] }
    : { selector: trimmed, ports: null };
}

export function tailscaleSelectorDevices(
  rawSelector: string,
  tailnet: TailscaleMapTailnet,
  visited = new Set<string>(),
): TailscaleMapDevice[] {
  const selector = splitTailscaleDestination(rawSelector).selector.trim().toLowerCase();
  if (!selector || visited.has(selector)) return [];
  visited.add(selector);
  const devices = tailnet.devices;
  const autogroup = autogroupDevices(selector, devices);
  if (autogroup) return autogroup;
  if (selector.startsWith("group:")) {
    return [...new Map(
      (tailnet.policy?.groups[selector] ?? []).flatMap((member) =>
        tailscaleSelectorDevices(member, tailnet, new Set(visited)),
      ).map((device) => [device.id, device]),
    ).values()];
  }
  if (selector.startsWith("tag:")) {
    return devices.filter((device) => device.tags.some((tag) => tag.toLowerCase() === selector));
  }
  const namedHost = tailnet.policy?.hosts[selector];
  const addressSpec = namedHost ?? selector;
  const addressBase = addressSpec.split("/")[0];
  return devices.filter((device) => {
    if (device.owner?.toLowerCase() === selector) return true;
    if (normalizedAssetName(device.name) === normalizedAssetName(selector)) return true;
    return device.addresses.some((address) =>
      address.toLowerCase() === addressBase.toLowerCase() ||
      (addressSpec.includes("/") && cidrContains(addressSpec, address)),
    );
  });
}

function autogroupDevices(selector: string, devices: TailscaleMapDevice[]): TailscaleMapDevice[] | null {
  if (selector === "*" || selector === "autogroup:member") return devices;
  if (selector === "autogroup:tagged") return devices.filter((device) => device.tags.length > 0);
  if (selector === "autogroup:shared") return devices.filter((device) => device.isExternal);
  if (selector === "autogroup:self" || selector.startsWith("autogroup:")) return [];
  return null;
}

export function tailscaleConnectivitySummary(device: TailscaleMapDevice): string | null {
  if (!device.connectivity) return null;
  const bestDerp = [...device.connectivity.derpLatency]
    .sort((a, b) => a.latencyMs - b.latencyMs)[0];
  return [
    device.connectivity.derp ? `DERP ${device.connectivity.derp}` : null,
    bestDerp ? `${bestDerp.region} ${Math.round(bestDerp.latencyMs)} ms` : null,
    device.connectivity.endpoints.length > 0
      ? `${device.connectivity.endpoints.length} observed endpoint${device.connectivity.endpoints.length === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean).join(" · ") || null;
}

export function resolverAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.includes("://")) return new URL(trimmed).hostname.replace(/^\[|]$/g, "");
  } catch {
    return null;
  }
  const bracketed = trimmed.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketed) return bracketed[1];
  return trimmed.replace(/:\d+$/, "");
}

export function stableLane(value: string, count = 31): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % count;
}

export function pveGroupHeight(memberCount: number): number {
  const visible = Math.min(memberCount, PVE_VISIBLE_MEMBER_LIMIT);
  const rows = Math.ceil(visible / 2);
  const more = memberCount > PVE_VISIBLE_MEMBER_LIMIT ? 16 : 0;
  return PVE_NODE_HEADER_HEIGHT + rows * PVE_MEMBER_ROW_HEIGHT + more + 8;
}
