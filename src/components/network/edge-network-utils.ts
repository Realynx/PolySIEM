import type { OtherEdgeNetwork } from "./edge-networks-types";

export function cloudflareZoneForHostname(
  network: OtherEdgeNetwork,
  hostname: string,
) {
  return [...(network.zones ?? [])]
    .filter(
      (zone) => hostname === zone.name || hostname.endsWith(`.${zone.name}`),
    )
    .sort((a, b) => b.name.length - a.name.length)[0] ?? null;
}

export function isValidNetworkPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65_535;
}
