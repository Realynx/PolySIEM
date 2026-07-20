export interface AssetInterfaceEvidence {
  ownerId: string;
  macAddress: string | null;
}

export interface NetworkAddressObservation {
  key: string;
  address: string;
  networkId: string | null;
  macAddress: string | null;
  source: "dhcp-static" | "dhcp-dynamic" | "neighbor";
}

export interface ResolvedAddressObservation extends NetworkAddressObservation {
  ownerId: string;
}

/** Normalize common colon, dash, and bare MAC formats to AA:BB:CC:DD:EE:FF. */
export function normalizeMac(value: string | null | undefined): string | null {
  if (!value) return null;
  const hex = value.replace(/[^0-9a-f]/gi, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(hex) || hex === "000000000000" || hex === "FFFFFFFFFFFF") {
    return null;
  }
  return hex.match(/.{2}/g)?.join(":") ?? null;
}

/**
 * Conservatively attach network observations to assets by MAC. A MAC must
 * identify exactly one owner; duplicates remain unresolved instead of being
 * guessed. The returned observations retain their original provenance.
 */
export function resolveObservedAssetAddresses(
  interfaces: readonly AssetInterfaceEvidence[],
  observations: readonly NetworkAddressObservation[],
): ResolvedAddressObservation[] {
  const ownersByMac = new Map<string, Set<string>>();
  for (const iface of interfaces) {
    const mac = normalizeMac(iface.macAddress);
    if (!mac) continue;
    const owners = ownersByMac.get(mac) ?? new Set<string>();
    owners.add(iface.ownerId);
    ownersByMac.set(mac, owners);
  }

  const resolved: ResolvedAddressObservation[] = [];
  const seen = new Set<string>();
  for (const observation of observations) {
    const mac = normalizeMac(observation.macAddress);
    if (!mac) continue;
    const owners = ownersByMac.get(mac);
    if (!owners || owners.size !== 1) continue;
    const ownerId = owners.values().next().value as string;
    const key = `${ownerId}|${observation.address}|${observation.networkId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push({ ...observation, ownerId });
  }
  return resolved;
}
