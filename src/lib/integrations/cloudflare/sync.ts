import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DriverConfig } from "../types";
import { cloudflareSettingsSchema, cloudflareSnapshotSchema } from "@/lib/validators/integrations";
import { newCounts, type SyncStats } from "../sync-helpers";
import { fetchCloudflareSnapshot } from "./client";
import type { CloudflareAccountSnapshot } from "./types";
import { cloudflareServiceCandidates, serviceEndpoint, type CloudflareServiceCandidate } from "./service-evidence";
import { findInventoryByIdentityKeys, normalizedIdentityKey } from "@/lib/inventory/identity-index";
import { assertDatasetBudget } from "@/lib/dataset-budget";

const CLOUDFLARE_SERVICE_BUDGET = 20_000;

interface ServiceTarget {
  deviceId: string | null;
  vmId: string | null;
  containerId: string | null;
}

function normalizedMachineName(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function candidateMatchesDocumentedService(
  candidate: CloudflareServiceCandidate,
  documentedEndpoints: ReadonlySet<string>,
): boolean {
  const publicEndpoint = serviceEndpoint(candidate.url);
  return (publicEndpoint !== null && documentedEndpoints.has(publicEndpoint))
    || (candidate.originEndpoint !== null && documentedEndpoints.has(candidate.originEndpoint));
}

async function markMissingCloudflareServicesRemoved(
  existing: Array<{ id: string; externalId: string | null; status: string }>,
  materialized: ReadonlySet<string>,
): Promise<number> {
  const ids = existing
    .filter((service) => service.externalId && !materialized.has(service.externalId) && service.status !== "REMOVED")
    .map((service) => service.id);
  if (ids.length === 0) return 0;
  const removed = await prisma.service.updateMany({
    where: { id: { in: ids } },
    data: { status: "REMOVED" },
  });
  return removed.count;
}

/** Resolve a route origin to the strongest inventory identity PolySIEM already knows. */
async function cloudflareOriginTargets(originHosts: string[]): Promise<Map<string, ServiceTarget>> {
  if (originHosts.length === 0) return new Map();
  const [ips, assets] = await Promise.all([
    prisma.ipAddress.findMany({
      where: { address: { in: originHosts } },
      select: { address: true, interface: { select: { deviceId: true, vmId: true, containerId: true } } },
    }),
    findInventoryByIdentityKeys(originHosts),
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
  for (const asset of assets) {
    addName(asset.name, {
      deviceId: asset.kind === "device" ? asset.id : null,
      vmId: asset.kind === "vm" ? asset.id : null,
      containerId: asset.kind === "container" ? asset.id : null,
    });
  }
  for (const host of originHosts) {
    const full = normalizedMachineName(host);
    if (targets.has(full)) continue;
    const target = named.get(full) ?? named.get(normalizedIdentityKey(full));
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
  assertDatasetBudget("Cloudflare route service candidates", candidates, CLOUDFLARE_SERVICE_BUDGET);
  const existing = await prisma.service.findMany({
    where: { integrationId, source: "CLOUDFLARE" },
    select: { id: true, externalId: true, status: true },
    take: CLOUDFLARE_SERVICE_BUDGET + 1,
  });
  const documented = await prisma.service.findMany({
    where: { status: { not: "REMOVED" }, source: { not: "CLOUDFLARE" } },
    select: { url: true },
    take: CLOUDFLARE_SERVICE_BUDGET + 1,
  });
  assertDatasetBudget("Cloudflare-managed services", existing, CLOUDFLARE_SERVICE_BUDGET);
  assertDatasetBudget("Documented services used for Cloudflare matching", documented, CLOUDFLARE_SERVICE_BUDGET);
  const documentedEndpoints = new Set(documented.map((service) => serviceEndpoint(service.url)).filter((value): value is string => Boolean(value)));
  const targets = await cloudflareOriginTargets([...new Set(candidates.map((candidate) => candidate.originHost).filter((value): value is string => Boolean(value)))]);
  const byExternalId = new Map(existing.flatMap((service) => service.externalId ? [[service.externalId, service] as const] : []));
  const materialized = new Set<string>();
  const counts = newCounts();

  for (const candidate of candidates) {
    if (candidateMatchesDocumentedService(candidate, documentedEndpoints)) continue;
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

  counts.stale += await markMissingCloudflareServicesRemoved(existing, materialized);
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
