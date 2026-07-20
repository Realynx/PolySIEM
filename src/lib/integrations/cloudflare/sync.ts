import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DriverConfig } from "../types";
import { cloudflareSettingsSchema, cloudflareSnapshotSchema } from "@/lib/validators/integrations";
import { newCounts, type SyncStats } from "../sync-helpers";
import { fetchCloudflareSnapshot } from "./client";
import type { CloudflareAccountSnapshot } from "./types";
import { cloudflareServiceCandidates, serviceEndpoint } from "./service-evidence";

interface ServiceTarget {
  deviceId: string | null;
  vmId: string | null;
  containerId: string | null;
}

function normalizedMachineName(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

/** Resolve a route origin to the strongest inventory identity PolySIEM already knows. */
async function cloudflareOriginTargets(originHosts: string[]): Promise<Map<string, ServiceTarget>> {
  if (originHosts.length === 0) return new Map();
  const [ips, devices, vms, containers] = await Promise.all([
    prisma.ipAddress.findMany({
      where: { address: { in: originHosts } },
      select: { address: true, interface: { select: { deviceId: true, vmId: true, containerId: true } } },
    }),
    prisma.device.findMany({ where: { status: { not: "REMOVED" } }, select: { id: true, name: true } }),
    prisma.virtualMachine.findMany({ where: { status: { not: "REMOVED" } }, select: { id: true, name: true } }),
    prisma.container.findMany({ where: { status: { not: "REMOVED" } }, select: { id: true, name: true } }),
  ]);
  const targets = new Map<string, ServiceTarget>();
  for (const ip of ips) {
    if (!ip.interface) continue;
    targets.set(normalizedMachineName(ip.address), {
      deviceId: ip.interface.deviceId,
      vmId: ip.interface.vmId,
      containerId: ip.interface.containerId,
    });
  }

  const named = new Map<string, ServiceTarget | null>();
  const addName = (name: string, target: ServiceTarget) => {
    const full = normalizedMachineName(name);
    const aliases = new Set([full, full.split(".")[0] ?? full]);
    for (const alias of aliases) named.set(alias, named.has(alias) ? null : target);
  };
  for (const device of devices) addName(device.name, { deviceId: device.id, vmId: null, containerId: null });
  for (const vm of vms) addName(vm.name, { deviceId: null, vmId: vm.id, containerId: null });
  for (const container of containers) addName(container.name, { deviceId: null, vmId: null, containerId: container.id });
  for (const host of originHosts) {
    if (targets.has(host)) continue;
    const full = normalizedMachineName(host);
    const target = named.get(full) ?? named.get(full.split(".")[0] ?? full);
    if (target) targets.set(full, target);
  }
  return targets;
}

/** Materialize Cloudflare route evidence into integration-owned Service rows. */
export async function syncCloudflareServices(
  integrationId: string,
  snapshot: CloudflareAccountSnapshot,
) {
  const candidates = cloudflareServiceCandidates(snapshot);
  const existing = await prisma.service.findMany({
    where: { integrationId, source: "CLOUDFLARE" },
    select: { id: true, externalId: true, status: true },
  });
  const documented = await prisma.service.findMany({
    where: { status: { not: "REMOVED" }, source: { not: "CLOUDFLARE" } },
    select: { url: true },
  });
  const documentedEndpoints = new Set(documented.map((service) => serviceEndpoint(service.url)).filter((value): value is string => Boolean(value)));
  const targets = await cloudflareOriginTargets([...new Set(candidates.map((candidate) => candidate.originHost).filter((value): value is string => Boolean(value)))]);
  const byExternalId = new Map(existing.flatMap((service) => service.externalId ? [[service.externalId, service] as const] : []));
  const materialized = new Set<string>();
  const counts = newCounts();

  for (const candidate of candidates) {
    const publicEndpoint = serviceEndpoint(candidate.url);
    if ((publicEndpoint && documentedEndpoints.has(publicEndpoint)) || (candidate.originEndpoint && documentedEndpoints.has(candidate.originEndpoint))) {
      continue;
    }
    const target = candidate.originHost ? targets.get(normalizedMachineName(candidate.originHost)) : undefined;
    const data = {
      name: candidate.name,
      url: candidate.url,
      port: candidate.port,
      protocol: candidate.protocol,
      deviceId: target?.deviceId ?? null,
      vmId: target?.vmId ?? null,
      containerId: target?.containerId ?? null,
      metadata: candidate.metadata as unknown as Prisma.InputJsonValue,
      status: "ACTIVE" as const,
    };
    const prior = byExternalId.get(candidate.externalId);
    if (prior) {
      await prisma.service.update({ where: { id: prior.id }, data });
      counts.updated++;
    } else {
      await prisma.service.create({
        data: {
          ...data,
          description: candidate.description,
          source: "CLOUDFLARE",
          integrationId,
          externalId: candidate.externalId,
        },
      });
      counts.created++;
    }
    materialized.add(candidate.externalId);
  }

  const missing = existing.filter((service) => service.externalId && !materialized.has(service.externalId) && service.status !== "REMOVED");
  if (missing.length > 0) {
    const removed = await prisma.service.updateMany({
      where: { id: { in: missing.map((service) => service.id) } },
      data: { status: "REMOVED" },
    });
    counts.stale += removed.count;
  }
  return counts;
}

/** Fetch a complete, bounded account snapshot from Cloudflare. */
export async function fetchSnapshot(cfg: DriverConfig): Promise<CloudflareAccountSnapshot> {
  return cloudflareSnapshotSchema.parse(await fetchCloudflareSnapshot(cfg)) as CloudflareAccountSnapshot;
}

/** Persist secret-free Cloudflare evidence alongside the integration config. */
export async function applyCloudflareSnapshot(
  integrationId: string,
  cfg: DriverConfig,
  snapshot: CloudflareAccountSnapshot,
): Promise<SyncStats> {
  const settings = cloudflareSettingsSchema.parse({ ...cfg.settings, syncedSnapshot: snapshot });
  await prisma.integrationConfig.update({
    where: { id: integrationId },
    data: { settings: settings as unknown as Prisma.InputJsonValue },
  });
  const services = await syncCloudflareServices(integrationId, snapshot);
  const family = (updated: number) => ({ ...newCounts(), updated });
  return {
    cloudflareZones: family(snapshot.zones.length),
    cloudflareDnsRecords: family(snapshot.zones.reduce((sum, zone) => sum + zone.dnsRecords.length, 0)),
    cloudflareTunnels: family(snapshot.tunnels.length),
    cloudflareTunnelIngress: family(snapshot.tunnels.reduce((sum, tunnel) => sum + tunnel.ingress.length, 0)),
    cloudflareTunnelConnections: family(snapshot.tunnels.reduce((sum, tunnel) => sum + tunnel.connections.length, 0)),
    cloudflarePrivateRoutes: family(snapshot.privateRoutes.length),
    services,
  };
}
