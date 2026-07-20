import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isMock, type DriverConfig } from "../types";
import { pickNetworkForIp } from "../net";
import {
  loadNetworkRefs,
  newCounts,
  syncInterfaces,
  type SyncStats,
} from "../sync-helpers";

// ---------- normalized snapshot ----------

export interface UnifiSite {
  id: string;
  internalReference: string | null;
  name: string;
}

export interface UnifiWlan {
  /** Stable UniFi WiFi broadcast / wlanconf id, scoped to the selected site. */
  externalId: string;
  /** SSID. */
  name: string;
  enabled: boolean;
  /** Normalized: open | wpa-psk | wpa-enterprise (raw value passed through when unknown). */
  security: string | null;
  /** wpa2 | wpa3 | wpa3-transition. */
  wpaMode: string | null;
  /** both | 2g | 5g | 6e. */
  band: string | null;
  hidden: boolean;
  isGuest: boolean;
  /** VLAN clients land on, resolved from the linked network. */
  vlanId: number | null;
  /** Stable id of the linked normalized UniFi network. */
  networkExternalId: string | null;
  /** Broadcasting device count, when the controller reports an explicit device list. */
  apCount: number | null;
}

export interface UnifiManagedDevice {
  externalId: string;
  siteId: string;
  name: string;
  model: string | null;
  mac: string | null;
  ip: string | null;
  state: string;
  version: string | null;
  features: string[];
  interfaces: string[];
  isAccessPoint: boolean;
  kind: "firewall" | "switch" | "device";
}

export interface UnifiApDevice {
  externalId: string;
  name: string;
  model: string | null;
  /** Uppercased. */
  mac: string | null;
  ip: string | null;
  adopted: boolean;
  /** online | offline | pending. */
  state: string | null;
  /** AP firmware version (kept in metadata). */
  version: string | null;
}

export interface UnifiNetwork {
  externalId: string;
  siteId: string;
  name: string;
  vlanId: number | null;
  cidr: string | null;
  gateway: string | null;
  enabled: boolean;
  management: string | null;
}

export interface UnifiClient {
  externalId: string;
  siteId: string;
  name: string | null;
  mac: string | null;
  ip: string | null;
  type: string | null;
  connectedAt: string | null;
  accessType: string | null;
  authorized: boolean | null;
}

export interface UnifiSnapshot {
  schemaVersion: 2;
  apiMode: "official" | "api-key-compat" | "legacy" | "mock";
  capturedAt: string;
  controllerVersion: string | null;
  sites: UnifiSite[];
  wlans: UnifiWlan[];
  aps: UnifiApDevice[];
  networks: UnifiNetwork[];
  devices: UnifiManagedDevice[];
  clients: UnifiClient[];
  /** Partial-fetch failures — a non-empty list yields a PARTIAL run. */
  errors: string[];
  /** Families unavailable on this API version must not age out. */
  skippedFamilies: string[];
}

/** Fetch a normalized snapshot: demo fixtures for mock:// configs, live controller otherwise. */
export async function fetchUnifiSnapshot(cfg: DriverConfig): Promise<UnifiSnapshot> {
  if (isMock(cfg)) {
    const { generateDemoScenarioFromUrl } = await import("@/lib/demo/scenario");
    return generateDemoScenarioFromUrl(cfg.baseUrl).unifi;
  }
  const { fetchUnifiSnapshotFromApi } = await import("./client");
  return fetchUnifiSnapshotFromApi(cfg);
}

// ---------- database mapping ----------

export interface VlanNetworkRef {
  id: string;
  vlanId: number | null;
}

/** Link a WLAN to a synced Network row by VLAN id when source identity is unavailable. */
export function pickNetworkIdForWlan(vlanId: number | null, networks: VlanNetworkRef[]): string | null {
  if (vlanId === null) return null;
  return networks.find((n) => n.vlanId === vlanId)?.id ?? null;
}

function infrastructureKind(device: UnifiManagedDevice): "firewall" | "switch" | "device" {
  return device.kind;
}

/**
 * Materialize source-owned UniFi evidence. Adopted infrastructure becomes
 * Device + NetworkInterface inventory; connected clients remain observations,
 * and WiFi broadcasts/APs retain their dedicated presentation models.
 */
export async function applyUnifiSnapshot(
  integrationId: string,
  snapshot: UnifiSnapshot,
  runStart: Date,
  complete: boolean,
): Promise<SyncStats> {
  const stats: SyncStats = {
    devices: newCounts(),
    networks: newCounts(),
    interfaces: newCounts(),
    neighbors: newCounts(),
    wirelessNetworks: newCounts(),
    wirelessAps: newCounts(),
  };
  const seen = { status: "ACTIVE" as const, missCount: 0, lastSeenAt: runStart };

  // -- Networks/VLANs --
  const networkDbIds = new Map<string, string>();
  {
    const existing = await prisma.network.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.flatMap((row) => row.externalId ? [[row.externalId, row.id] as const] : []));
    await prisma.$transaction(async (tx) => {
      for (const network of snapshot.networks) {
        const data = {
          name: network.name,
          vlanId: network.vlanId,
          cidr: network.cidr,
          gateway: network.gateway,
          source: "UNIFI" as const,
          ...seen,
          metadata: {
            siteId: network.siteId,
            enabled: network.enabled,
            management: network.management,
            evidence: "unifi-network-api",
            apiMode: snapshot.apiMode,
            capturedAt: snapshot.capturedAt,
          } as Prisma.InputJsonValue,
        };
        const id = byExt.get(network.externalId);
        if (id) {
          await tx.network.update({ where: { id }, data });
          networkDbIds.set(network.externalId, id);
          stats.networks.updated++;
        } else {
          const created = await tx.network.create({
            data: { ...data, integrationId, externalId: network.externalId },
            select: { id: true },
          });
          networkDbIds.set(network.externalId, created.id);
          stats.networks.created++;
        }
      }
    }, { timeout: 30_000 });
  }

  // -- Adopted gateways, switches and APs --
  const deviceDbIds = new Map<string, string>();
  {
    const existing = await prisma.device.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.flatMap((row) => row.externalId ? [[row.externalId, row.id] as const] : []));
    await prisma.$transaction(async (tx) => {
      for (const device of snapshot.devices) {
        const data = {
          name: device.name,
          kind: infrastructureKind(device),
          source: "UNIFI" as const,
          manufacturer: "Ubiquiti",
          model: device.model,
          ...seen,
          metadata: {
            siteId: device.siteId,
            state: device.state,
            firmwareVersion: device.version,
            features: device.features,
            interfaces: device.interfaces,
            isAccessPoint: device.isAccessPoint,
            controllerVersion: snapshot.controllerVersion,
            evidence: "unifi-network-api",
            apiMode: snapshot.apiMode,
            capturedAt: snapshot.capturedAt,
          } as Prisma.InputJsonValue,
        };
        const id = byExt.get(device.externalId);
        if (id) {
          await tx.device.update({ where: { id }, data });
          deviceDbIds.set(device.externalId, id);
          stats.devices.updated++;
        } else {
          const created = await tx.device.create({
            data: { ...data, integrationId, externalId: device.externalId },
            select: { id: true },
          });
          deviceDbIds.set(device.externalId, created.id);
          stats.devices.created++;
        }
      }
    }, { timeout: 30_000 });
  }

  const addressedNetworks = await loadNetworkRefs();
  stats.interfaces = await syncInterfaces(
    integrationId,
    "UNIFI",
    snapshot.devices.map((device) => ({
      externalId: `device/${device.externalId}`,
      name: "management",
      macAddress: device.mac,
      deviceId: deviceDbIds.get(device.externalId) ?? null,
      ip: device.ip,
      metadata: {
        siteId: device.siteId,
        state: device.state,
        evidence: "unifi-adopted-device",
      },
    })),
    runStart,
    addressedNetworks,
    complete,
  );

  // -- Connected clients are observations, never asset ownership --
  {
    const existing = await prisma.networkNeighbor.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.flatMap((row) => row.externalId ? [[row.externalId, row.id] as const] : []));
    await prisma.$transaction(async (tx) => {
      for (const client of snapshot.clients) {
        if (!client.ip) continue;
        const data = {
          ipAddress: client.ip,
          macAddress: client.mac,
          hostname: client.name,
          manufacturer: null,
          interfaceKey: client.type ? `unifi:${client.type.toLowerCase()}` : "unifi:client",
          permanent: false,
          networkId: pickNetworkForIp(client.ip, addressedNetworks),
          ...seen,
        };
        const id = byExt.get(client.externalId);
        if (id) {
          await tx.networkNeighbor.update({ where: { id }, data });
          stats.neighbors.updated++;
        } else {
          await tx.networkNeighbor.create({ data: { ...data, integrationId, externalId: client.externalId } });
          stats.neighbors.created++;
        }
      }
    }, { timeout: 30_000 });
  }

  const allVlanNetworks: VlanNetworkRef[] = await prisma.network.findMany({
    where: { status: { not: "REMOVED" } },
    select: { id: true, vlanId: true },
  });

  // -- Wireless networks (SSIDs) --
  {
    const existing = await prisma.wirelessNetwork.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.flatMap((row) => row.externalId ? [[row.externalId, row.id] as const] : []));
    await prisma.$transaction(async (tx) => {
      for (const wlan of snapshot.wlans) {
        const data = {
          name: wlan.name,
          enabled: wlan.enabled,
          security: wlan.security,
          wpaMode: wlan.wpaMode,
          band: wlan.band,
          hidden: wlan.hidden,
          isGuest: wlan.isGuest,
          vlanId: wlan.vlanId,
          networkId:
            (wlan.networkExternalId ? networkDbIds.get(wlan.networkExternalId) : undefined) ??
            pickNetworkIdForWlan(wlan.vlanId, allVlanNetworks),
          apCount: wlan.apCount,
          source: "UNIFI" as const,
          ...seen,
          metadata: {
            networkId: wlan.networkExternalId,
            evidence: "unifi-wifi-broadcast",
            apiMode: snapshot.apiMode,
            capturedAt: snapshot.capturedAt,
          } as Prisma.InputJsonValue,
        };
        const id = byExt.get(wlan.externalId);
        if (id) {
          await tx.wirelessNetwork.update({ where: { id }, data });
          stats.wirelessNetworks.updated++;
        } else {
          await tx.wirelessNetwork.create({ data: { ...data, integrationId, externalId: wlan.externalId } });
          stats.wirelessNetworks.created++;
        }
      }
    }, { timeout: 30_000 });
  }

  // -- Access points --
  {
    const existing = await prisma.wirelessAp.findMany({
      where: { integrationId },
      select: { id: true, externalId: true },
    });
    const byExt = new Map(existing.flatMap((row) => row.externalId ? [[row.externalId, row.id] as const] : []));
    await prisma.$transaction(async (tx) => {
      for (const ap of snapshot.aps) {
        const data = {
          name: ap.name,
          model: ap.model,
          mac: ap.mac,
          ipAddress: ap.ip,
          adopted: ap.adopted,
          state: ap.state,
          deviceId: deviceDbIds.get(ap.externalId) ?? null,
          source: "UNIFI" as const,
          ...seen,
          metadata: {
            firmwareVersion: ap.version,
            controllerVersion: snapshot.controllerVersion,
            evidence: "unifi-adopted-device",
            apiMode: snapshot.apiMode,
            capturedAt: snapshot.capturedAt,
          } as Prisma.InputJsonValue,
        };
        const id = byExt.get(ap.externalId);
        if (id) {
          await tx.wirelessAp.update({ where: { id }, data });
          stats.wirelessAps.updated++;
        } else {
          await tx.wirelessAp.create({ data: { ...data, integrationId, externalId: ap.externalId } });
          stats.wirelessAps.created++;
        }
      }
    }, { timeout: 30_000 });
  }

  return stats;
}
