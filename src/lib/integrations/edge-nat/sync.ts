import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { edgeNatSettingsSchema, type EdgeNatSnapshot } from "@/lib/validators/integrations";
import { newCounts, type SyncStats } from "../sync-helpers";

export async function applyEdgeNatSnapshot(
  integrationId: string,
  snapshot: EdgeNatSnapshot,
  runStart: Date,
): Promise<SyncStats> {
  const stats: SyncStats = { devices: newCounts(), edgeNatServers: newCounts() };
  const externalId = "edge-nat-server";
  const existing = await prisma.device.findUnique({
    where: { integrationId_externalId: { integrationId, externalId } },
    select: { id: true },
  });
  const data = {
    name: snapshot.hostname,
    kind: "edge-nat",
    source: "EDGE_NAT_SERVER" as const,
    status: "ACTIVE" as const,
    missCount: 0,
    lastSeenAt: runStart,
    osName: snapshot.kernel,
    description: "Restricted SSH-managed Edge NAT gateway",
    metadata: { edgeNat: snapshot } as Prisma.InputJsonValue,
  };
  if (existing) {
    await prisma.device.update({ where: { id: existing.id }, data });
    stats.devices.updated++;
  } else {
    await prisma.device.create({ data: { ...data, integrationId, externalId } });
    stats.devices.created++;
  }
  stats.edgeNatServers.updated++;

  const row = await prisma.integrationConfig.findUniqueOrThrow({ where: { id: integrationId }, select: { settings: true } });
  const settings = edgeNatSettingsSchema.parse({
    ...(row.settings && typeof row.settings === "object" ? row.settings : {}),
    syncedSnapshot: snapshot,
  });
  await prisma.integrationConfig.update({
    where: { id: integrationId },
    data: { settings: settings as unknown as Prisma.InputJsonValue },
  });
  return stats;
}
