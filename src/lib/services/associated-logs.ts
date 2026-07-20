import "server-only";

import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { isMock } from "@/lib/integrations/types";
import {
  fetchAssociatedLogs,
  type AssetLogIdentity,
} from "@/lib/integrations/elasticsearch/associated-logs";
import { withElasticsearchUpstream } from "@/lib/services/elasticsearch-upstream";
import { resolveLogSource } from "@/lib/services/logs";
import { focusedTunnelTraceIdentity } from "@/lib/topology/log-trace-identity";
import type { AssociatedLogsResponse, AssociatedLogRow } from "@/lib/types";

export type LogAssetType = "hosts" | "containers" | "vms";

function cleanIp(value: string): string {
  return value
    .trim()
    .replace(/^\[|\]$/g, "")
    .split("/")[0]
    .split("%")[0];
}

function hostname(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    return (
      new URL(
        value.includes("://") ? value : `http://${value}`,
      ).hostname.toLowerCase() || null
    );
  } catch {
    return null;
  }
}

function metadataNames(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return [];
  const record = metadata as Record<string, unknown>;
  return ["hostname", "host", "fqdn", "nodeName"]
    .map((key) => record[key])
    .filter(
      (value): value is string =>
        typeof value === "string" && Boolean(value.trim()),
    );
}

export function normalizeAssetIdentity(
  input: AssetLogIdentity,
): AssetLogIdentity {
  const unique = (values: string[]) => [
    ...new Set(
      values.map((value) => value.trim().toLowerCase()).filter(Boolean),
    ),
  ];
  return {
    names: unique(input.names),
    ips: unique(input.ips.map(cleanIp)),
    domains: unique(input.domains.map((value) => hostname(value) ?? value)),
  };
}

async function identityFor(
  type: LogAssetType,
  id: string,
): Promise<AssetLogIdentity> {
  const [entity, tunnels] = await Promise.all([
    type === "hosts"
      ? prisma.device.findUnique({
          where: { id },
          select: {
            name: true,
            metadata: true,
            interfaces: { select: { ip: { select: { address: true } } } },
            services: { select: { url: true } },
          },
        })
      : type === "containers"
        ? prisma.container.findUnique({
            where: { id },
            select: {
              name: true,
              metadata: true,
              interfaces: { select: { ip: { select: { address: true } } } },
              services: { select: { url: true } },
            },
          })
        : prisma.virtualMachine.findUnique({
            where: { id },
            select: {
              name: true,
              metadata: true,
              interfaces: { select: { ip: { select: { address: true } } } },
              services: { select: { url: true } },
            },
          }),
    prisma.tunnel.findMany({
      select: {
        id: true,
        name: true,
        originIp: true,
        ingressHostnames: true,
        deviceId: true,
        vmId: true,
        containerId: true,
        hostnames: { select: { hostname: true, metadata: true } },
      },
    }),
  ]);
  if (!entity)
    throw new ApiError(404, "not_found", "Inventory asset not found");

  const entityIps = entity.interfaces.flatMap((iface) =>
    iface.ip?.address ? [iface.ip.address] : [],
  );
  const trace = focusedTunnelTraceIdentity(
    { type, id, ips: entityIps },
    tunnels,
  );

  return normalizeAssetIdentity({
    names: [
      entity.name,
      ...metadataNames(entity.metadata),
      ...trace.names,
    ],
    ips: [...entityIps, ...trace.ips],
    domains: [
      ...entity.services.flatMap((service) =>
        service.url ? [service.url] : [],
      ),
      ...trace.domains,
    ],
  });
}

function mockRows(identity: AssetLogIdentity): AssociatedLogRow[] {
  const now = Date.now();
  const host = identity.names[0] ?? "inventory-asset";
  const domain = identity.domains[0] ?? `${host}.example.test`;
  return [
    {
      id: "mock-associated-http",
      index: "cloudflared-demo",
      timestamp: new Date(now - 90_000).toISOString(),
      kind: "http",
      host,
      message: "Cloudflare tunnel request",
      error: null,
      url: `https://${domain}/api/health`,
      domain,
      path: "/api/health",
      sourceIp: "203.0.113.42",
      destinationIp: identity.ips[0] ?? null,
      method: "GET",
      statusCode: "200",
      userAgent: "Mozilla/5.0 (demo)",
      city: "Ashburn",
      region: "Virginia",
      country: "United States",
    },
  ];
}

export async function getAssociatedLogs(input: {
  type: LogAssetType;
  id: string;
  integrationId?: string;
  hours: number;
}): Promise<AssociatedLogsResponse> {
  const [identity, cfg] = await Promise.all([
    identityFor(input.type, input.id),
    resolveLogSource(input.integrationId),
  ]);
  return withElasticsearchUpstream(async () => {
    const result = isMock(cfg)
      ? { rows: mockRows(identity), total: 1 }
      : await fetchAssociatedLogs(cfg, identity, input.hours);
    return {
      ...result,
      source: { id: cfg.id, name: cfg.name },
      matchedBy: identity,
    };
  });
}
