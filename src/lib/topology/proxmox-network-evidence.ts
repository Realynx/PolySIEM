import { cidrContains, parseCidr } from "./access";

export interface ProxmoxNicEvidence {
  ownerId: string;
  integrationId: string;
  bridge: string | null;
  vlanTag: number | null;
  address: string | null;
  networkId: string | null;
}

export interface KnownNetworkEvidence {
  id: string;
  name: string;
  vlanId: number | null;
  cidr: string | null;
  externalId: string | null;
}

export interface ProxmoxAddressScope {
  name: string;
  entries: string[];
}

export interface InferredProxmoxNetwork extends KnownNetworkEvidence {
  purpose: string;
}

export interface ProxmoxNetworkEvidence {
  inferredNetworks: InferredProxmoxNetwork[];
  networkHintsByOwner: Map<string, string[]>;
}

function normalizedName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function usableScopeCidrs(scopes: readonly ProxmoxAddressScope[]): { name: string; cidr: string }[] {
  return scopes.flatMap((scope) =>
    scope.entries.flatMap((entry) => {
      const trimmed = entry.trim();
      const parsed = parseCidr(trimmed);
      return parsed && trimmed.includes("/") && parsed.prefix < 32
        ? [{ name: scope.name, cidr: trimmed }]
        : [];
    }),
  );
}

function scopeCidr(
  vlanTag: number | null,
  bridge: string,
  addresses: string[],
  scopes: readonly { name: string; cidr: string }[],
): string | null {
  if (vlanTag !== null) {
    const expected = new Set([`vlan${vlanTag}`, `${normalizedName(bridge)}${vlanTag}`]);
    const named = scopes.find((scope) => expected.has(normalizedName(scope.name)));
    if (named) return named.cidr;
  }
  const containing = scopes.filter(
    (scope) => addresses.length > 0 && addresses.every((address) => cidrContains(scope.cidr, address)),
  );
  return containing.length === 1 ? containing[0].cidr : null;
}

const groupKey = (iface: ProxmoxNicEvidence, bridge: string) =>
  `${iface.integrationId}|${bridge}|${iface.vlanTag ?? "untagged"}`;

function groupUnassignedInterfaces(interfaces: readonly ProxmoxNicEvidence[]) {
  const groups = new Map<string, ProxmoxNicEvidence[]>();
  for (const iface of interfaces) {
    if (iface.networkId) continue;
    const bridge = iface.bridge?.trim();
    if (!bridge) continue;
    const key = groupKey(iface, bridge);
    const rows = groups.get(key) ?? [];
    rows.push(iface);
    groups.set(key, rows);
  }
  return groups;
}

function matchingKnownNetwork(
  first: ProxmoxNicEvidence, bridge: string, addresses: string[],
  knownNetworks: readonly KnownNetworkEvidence[],
) {
  const candidates = first.vlanTag !== null
    ? knownNetworks.filter((network) => network.vlanId === first.vlanTag)
    : knownNetworks.filter((network) =>
        [network.externalId, network.name].some((value) => value?.toLowerCase() === bridge.toLowerCase()));
  return candidates.find((network) => network.cidr &&
    addresses.some((address) => cidrContains(network.cidr!, address))) ?? candidates[0];
}

function inferredNetwork(
  first: ProxmoxNicEvidence, bridge: string, addresses: string[],
  scopes: readonly { name: string; cidr: string }[],
): InferredProxmoxNetwork {
  const tagLabel = first.vlanTag === null ? "untagged" : `vlan-${first.vlanTag}`;
  const isWan = bridge.toLowerCase() === "wan";
  return {
    id: `pve-network:${encodeURIComponent(first.integrationId)}:${encodeURIComponent(bridge)}:${tagLabel}`,
    name: first.vlanTag === null
      ? isWan ? "WAN · untagged" : `${bridge} · untagged`
      : `VLAN ${first.vlanTag} · ${bridge}`,
    vlanId: first.vlanTag,
    cidr: scopeCidr(first.vlanTag, bridge, addresses, scopes),
    externalId: bridge,
    purpose: isWan ? "Proxmox WAN bridge" : "Inferred from Proxmox guest NICs",
  };
}

function ownerNetworkHints(
  interfaces: readonly ProxmoxNicEvidence[], inferredIdByGroup: ReadonlyMap<string, string>,
) {
  const hintsByOwner = new Map<string, string[]>();
  for (const iface of interfaces) {
    const bridge = iface.bridge?.trim();
    const networkId = iface.networkId ?? (bridge ? inferredIdByGroup.get(groupKey(iface, bridge)) : undefined);
    if (!networkId) continue;
    const hints = hintsByOwner.get(iface.ownerId) ?? [];
    if (!hints.includes(networkId)) hints.push(networkId);
    hintsByOwner.set(iface.ownerId, hints);
  }
  return hintsByOwner;
}

/**
 * Resolve Proxmox bridge/tag evidence into existing network identities where
 * possible, otherwise produce graph-only lanes. Inventory ownership remains
 * with the router/network integration; these inferred rows are never stored.
 */
export function deriveProxmoxNetworkEvidence(
  interfaces: readonly ProxmoxNicEvidence[],
  knownNetworks: readonly KnownNetworkEvidence[],
  addressScopes: readonly ProxmoxAddressScope[] = [],
): ProxmoxNetworkEvidence {
  const scopes = usableScopeCidrs(addressScopes);
  const groups = groupUnassignedInterfaces(interfaces);

  const inferredNetworks: InferredProxmoxNetwork[] = [];
  const inferredIdByGroup = new Map<string, string>();
  for (const [key, rows] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const first = rows[0];
    const bridge = first.bridge!.trim();
    const addresses = rows.flatMap((row) => (row.address ? [row.address] : []));
    const existing = matchingKnownNetwork(first, bridge, addresses, knownNetworks);
    if (existing) {
      inferredIdByGroup.set(key, existing.id);
      continue;
    }

    const inferred = inferredNetwork(first, bridge, addresses, scopes);
    inferredNetworks.push(inferred);
    inferredIdByGroup.set(key, inferred.id);
  }
  return { inferredNetworks, networkHintsByOwner: ownerNetworkHints(interfaces, inferredIdByGroup) };
}
