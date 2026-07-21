import type { ResolvedAddressObservation } from "@/lib/topology/address-evidence";
import {
  containingPveNetwork,
  derivePveAccess,
  type PveAccessView,
  type PveGroupRuleInput,
  type PveIpsetInput,
  type PveGuestInput,
  type PveNetworkInput,
} from "@/lib/topology/pve-access";

interface GuestOwnerInput {
  id: string;
  externalId: string | null;
  name: string;
  metadata: unknown;
}

interface GuestInterfaceInput {
  ip: { address: string; networkId: string | null } | null;
  vm: GuestOwnerInput | null;
  container: GuestOwnerInput | null;
}

interface PveRuleInput {
  action: string;
  direction: string | null;
  protocol: string | null;
  sourceSpec: string | null;
  destPort: string | null;
  descriptionText: string | null;
  enabled: boolean;
  metadata: unknown;
}

interface GuestMeta {
  firewall?: { enabled?: boolean; groups?: string[] };
}

export interface AccessMapPveData {
  pve: PveAccessView | null;
  homeNetworkId: string | null;
  groupRuleCount: number;
}

/** Assemble Proxmox guest identities and policy rules into the access view. */
export function buildAccessMapPveData(
  guestInterfaces: readonly GuestInterfaceInput[],
  observations: readonly ResolvedAddressObservation[],
  rules: readonly PveRuleInput[],
  addressSets: PveIpsetInput[],
  networks: PveNetworkInput[],
): AccessMapPveData {
  const observedIpsByOwner = new Map<string, string[]>();
  for (const observation of observations) {
    const list = observedIpsByOwner.get(observation.ownerId) ?? [];
    if (!list.includes(observation.address)) list.push(observation.address);
    observedIpsByOwner.set(observation.ownerId, list);
  }

  const guestInputs = new Map<string, PveGuestInput>();
  const guestIdByExternalId = new Map<string, string>();
  for (const iface of guestInterfaces) {
    const owner = iface.container ?? iface.vm;
    if (!owner) continue;
    const kind = iface.container ? ("container" as const) : ("vm" as const);
    const meta = (owner.metadata ?? {}) as GuestMeta;
    const existing = guestInputs.get(owner.id);
    if (existing) {
      if (
        iface.ip?.address &&
        !existing.ips.includes(iface.ip.address)
      ) {
        existing.ips.push(iface.ip.address);
      }
      continue;
    }
    if (owner.externalId) guestIdByExternalId.set(owner.externalId, owner.id);
    guestInputs.set(owner.id, {
      id: owner.id,
      name: owner.name,
      kind,
      ips: [
        iface.ip?.address,
        ...(observedIpsByOwner.get(owner.id) ?? []),
      ].filter((address): address is string => Boolean(address)),
      firewallEnabled: meta.firewall?.enabled === true,
      groups: meta.firewall?.groups ?? [],
    });
  }
  const guests = [...guestInputs.values()];

  const groupRules: PveGroupRuleInput[] = [];
  for (const rule of rules) {
    const meta = (rule.metadata ?? {}) as {
      scope?: string;
      group?: string;
      groupComment?: string;
      guestExternalId?: string;
    };
    let group: string;
    let groupLabel: string | undefined;
    let scope: "group" | "guest";
    let groupComment = meta.groupComment ?? null;
    if (meta.scope === "group" && meta.group) {
      group = meta.group;
      scope = "group";
    } else if (meta.scope === "guest" && meta.guestExternalId) {
      const guestId = guestIdByExternalId.get(meta.guestExternalId);
      const guest = guestId ? guestInputs.get(guestId) : undefined;
      if (!guest) continue;
      group = `guest-local:${guest.id}`;
      groupLabel = `${guest.name} · local rules`;
      groupComment = "Rules defined directly on this Proxmox guest";
      scope = "guest";
      if (!guest.groups.includes(group)) guest.groups.push(group);
    } else {
      continue;
    }
    groupRules.push({
      group,
      groupLabel,
      scope,
      groupComment,
      direction: rule.direction,
      action: rule.action,
      sourceSpec: rule.sourceSpec,
      protocol: rule.protocol,
      destPort: rule.destPort,
      enabled: rule.enabled,
      comment: rule.descriptionText,
    });
  }

  const homeVotes = new Map<string, number>();
  for (const guest of guests) {
    if (!guest.firewallEnabled) continue;
    for (const ip of guest.ips) {
      const network = containingPveNetwork(ip, networks);
      if (network) {
        homeVotes.set(network.id, (homeVotes.get(network.id) ?? 0) + 1);
      }
    }
  }
  const homeNetworkId =
    [...homeVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    pve:
      groupRules.length > 0
        ? derivePveAccess(
            guests,
            groupRules,
            addressSets,
            networks,
            homeNetworkId ?? undefined,
          )
        : null,
    homeNetworkId,
    groupRuleCount: groupRules.length,
  };
}
