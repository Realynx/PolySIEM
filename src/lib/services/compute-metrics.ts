import "server-only";
import { prisma } from "@/lib/db";
import { toDriverConfig } from "@/lib/integrations/config";
import { fetchProxmoxLiveMetrics } from "@/lib/integrations/proxmox/client";
import {
  summarizeComputeMetrics,
  type ComputeMetricsPayload,
  type ComputeResourceMetric,
} from "@/lib/compute/metrics";

/**
 * Upper bound on how often Proxmox is actually asked. This caps the sample
 * rate the lab map can observe, so it has to stay at or below the fastest
 * interval the map offers (1s) or a fast poll would just re-read a stale
 * sample. Concurrent callers still collapse onto one request via `inFlight`,
 * so extra viewers cost nothing regardless of how fast each one polls.
 */
const CACHE_MS = 1_000;
let cached: { expiresAt: number; value: ComputeMetricsPayload } | null = null;
let inFlight: Promise<ComputeMetricsPayload> | null = null;

async function collectComputeMetrics(): Promise<ComputeMetricsPayload> {
  const integrations = await prisma.integrationConfig.findMany({
    where: { type: "PROXMOX", enabled: true },
    orderBy: { name: "asc" },
  });
  const resources: ComputeResourceMetric[] = [];
  const errors: string[] = [];

  await Promise.all(
    integrations.map(async (integration) => {
      try {
        resources.push(...(await fetchProxmoxLiveMetrics(toDriverConfig(integration))));
      } catch (error) {
        errors.push(`${integration.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );

  resources.sort((a, b) => a.clusterName.localeCompare(b.clusterName) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return {
    capturedAt: new Date().toISOString(),
    summary: summarizeComputeMetrics(resources),
    resources,
    errors,
  };
}

/** Current Proxmox utilization, coalesced briefly across Compute/Lab Map clients. */
export async function computeMetricsReport(): Promise<ComputeMetricsPayload> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  if (inFlight) return inFlight;
  inFlight = collectComputeMetrics().then((value) => {
    cached = { value, expiresAt: Date.now() + CACHE_MS };
    return value;
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
