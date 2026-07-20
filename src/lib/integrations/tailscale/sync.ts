import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { loadNetworkRefs, newCounts, syncInterfaces, type DesiredInterface, type SyncStats } from "../sync-helpers";
import { tailscaleSettingsSchema, type TailscaleDeviceSnapshot, type TailscaleSnapshot } from "@/lib/validators/integrations";

type AssetRef = { id: string; kind: "device" | "vm" | "container"; name: string };

function identityKeys(device: TailscaleDeviceSnapshot): string[] {
  return [...new Set([device.hostname, device.name, device.dnsName ?? ""]
    .map((value) => value.trim().toLowerCase().replace(/\.$/, "").split(".")[0])
    .filter(Boolean))];
}

async function assetIndex(): Promise<Map<string, AssetRef[]>> {
  const [devices, vms, containers] = await Promise.all([
    prisma.device.findMany({
      where: { status: { not: "REMOVED" }, source: { not: "TAILSCALE" } },
      select: { id: true, name: true },
    }),
    prisma.virtualMachine.findMany({
      where: { status: { not: "REMOVED" } },
      select: { id: true, name: true },
    }),
    prisma.container.findMany({
      where: { status: { not: "REMOVED" } },
      select: { id: true, name: true },
    }),
  ]);
  const index = new Map<string, AssetRef[]>();
  for (const asset of [
    ...devices.map((item) => ({ ...item, kind: "device" as const })),
    ...vms.map((item) => ({ ...item, kind: "vm" as const })),
    ...containers.map((item) => ({ ...item, kind: "container" as const })),
  ]) {
    const key = asset.name.trim().toLowerCase().replace(/\.$/, "").split(".")[0];
    const list = index.get(key) ?? [];
    list.push(asset);
    index.set(key, list);
  }
  return index;
}

function uniqueMatch(device: TailscaleDeviceSnapshot, index: Map<string, AssetRef[]>): AssetRef | null {
  const candidates = new Map<string, AssetRef>();
  for (const key of identityKeys(device)) {
    for (const candidate of index.get(key) ?? []) candidates.set(`${candidate.kind}:${candidate.id}`, candidate);
  }
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}

function deviceKind(os: string | null): string {
  const value = os?.toLowerCase() ?? "";
  if (["ios", "android", "tvos"].includes(value)) return "device";
  return "server";
}

function interfaceOwner(asset: AssetRef): Pick<DesiredInterface, "deviceId" | "vmId" | "containerId"> {
  if (asset.kind === "vm") return { vmId: asset.id };
  if (asset.kind === "container") return { containerId: asset.id };
  return { deviceId: asset.id };
}

export async function applyTailscaleSnapshot(
  integrationId: string,
  snapshot: TailscaleSnapshot,
  runStart: Date,
  complete: boolean,
): Promise<SyncStats> {
  const stats: SyncStats = { devices: newCounts(), tailscaleDevices: newCounts() };
  const index = await assetIndex();
  const existing = await prisma.device.findMany({
    where: { integrationId },
    select: { id: true, externalId: true },
  });
  const byExternalId = new Map(existing.flatMap((item) => item.externalId ? [[item.externalId, item.id] as const] : []));
  const interfaces: DesiredInterface[] = [];

  for (const observed of snapshot.devices) {
    let asset = uniqueMatch(observed, index);
    const existingId = byExternalId.get(observed.id);
    if (!asset && existingId) asset = { id: existingId, kind: "device", name: observed.hostname };
    if (!asset) {
      const data = {
        name: observed.hostname,
        kind: deviceKind(observed.os),
        source: "TAILSCALE" as const,
        status: "ACTIVE" as const,
        missCount: 0,
        lastSeenAt: runStart,
        osName: observed.os,
        osVersion: observed.clientVersion,
        description: `Discovered through Tailscale tailnet ${snapshot.tailnet}`,
        metadata: {
          tailscale: observed,
          tailnet: snapshot.tailnet,
        } as Prisma.InputJsonValue,
      };
      if (existingId) {
        await prisma.device.update({ where: { id: existingId }, data });
        asset = { id: existingId, kind: "device", name: observed.hostname };
        stats.devices.updated++;
      } else {
        const created = await prisma.device.create({
          data: { ...data, integrationId, externalId: observed.id },
        });
        asset = { id: created.id, kind: "device", name: observed.hostname };
        stats.devices.created++;
      }
    }
    stats.tailscaleDevices.updated++;
    for (const [index, address] of observed.addresses.entries()) {
      interfaces.push({
        externalId: `${observed.id}:${index}:${address}`,
        name: "tailscale0",
        ip: address,
        ...interfaceOwner(asset),
        metadata: {
          tailnet: snapshot.tailnet,
          tailscaleDeviceId: observed.id,
          dnsName: observed.dnsName,
          owner: observed.owner,
          online: observed.online,
          tags: observed.tags,
          advertisedRoutes: observed.advertisedRoutes,
          enabledRoutes: observed.enabledRoutes,
          connectivity: observed.connectivity,
          tailnetLockError: observed.tailnetLockError,
        },
      });
    }
  }

  stats.interfaces = await syncInterfaces(
    integrationId,
    "TAILSCALE",
    interfaces,
    runStart,
    await loadNetworkRefs(),
    complete,
  );
  const row = await prisma.integrationConfig.findUniqueOrThrow({
    where: { id: integrationId },
    select: { settings: true },
  });
  const settings = tailscaleSettingsSchema.parse({
    ...(row.settings && typeof row.settings === "object" ? row.settings : {}),
    syncedSnapshot: snapshot,
  });
  await prisma.integrationConfig.update({
    where: { id: integrationId },
    data: { settings: settings as unknown as Prisma.InputJsonValue },
  });
  return stats;
}
