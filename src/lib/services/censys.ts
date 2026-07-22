import "server-only";
import { isIP } from "node:net";
import { Prisma, type IntegrationConfig } from "@prisma/client";
import { ApiError } from "@/lib/api";
import { sha256Hex } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { toDriverConfig } from "@/lib/integrations";
import { fetchCensysCreditBalance, fetchCensysHost } from "@/lib/integrations/censys/client";
import { censysSettingsSchema } from "@/lib/validators/integrations";

export const CENSYS_CACHE_TTL_MS = 4 * 24 * 60 * 60 * 1_000;
export type CensysLookupSource = "ai" | "mcp" | "workflow" | "manual";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown, limit = 100): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, limit)
    : [];
}

function normalizeCensysService(raw: unknown) {
  const service = object(raw);
  const software = Array.isArray(service.software) ? service.software.map(object) : [];
  return {
    port: service.port ?? null,
    transport: service.transport_protocol ?? service.transport ?? null,
    protocol: service.service_name ?? service.extended_service_name ?? null,
    observedAt: service.observed_at ?? null,
    software: software.slice(0, 10).map((item) => ({
      vendor: item.vendor ?? null,
      product: item.product ?? null,
      version: item.version ?? null,
    })),
  };
}

function isPrivateIpv4(first: number, second: number): boolean {
  return first === 10 || first === 127 || first === 0 || first >= 224 ||
    (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) || (first === 100 && second >= 64 && second <= 127);
}

function isPrivateIpv6(ip: string): boolean {
  return ip === "::1" || ip === "::" || ip.startsWith("fc") || ip.startsWith("fd") || /^fe[89ab]/.test(ip);
}

function censysOwnership(
  autonomousSystem: Record<string, unknown>,
  network: Record<string, unknown>,
  location: Record<string, unknown>,
) {
  return {
    organization: autonomousSystem.name ?? network.name ?? network.organization ?? null,
    asn: autonomousSystem.asn ?? null,
    description: autonomousSystem.description ?? null,
    country: autonomousSystem.country_code ?? location.country_code ?? null,
    network: network.cidr ?? network.prefix ?? null,
  };
}

function censysLocation(location: Record<string, unknown>) {
  return {
    city: location.city ?? null,
    region: location.province ?? location.region ?? null,
    country: location.country ?? location.country_code ?? null,
  };
}

/** Keep tool responses compact; the complete provider response remains in the cache. */
export function normalizeCensysHost(response: unknown) {
  const envelope = object(response);
  const result = object(envelope.result);
  const host = object(result.resource ?? result);
  const as = object(host.autonomous_system);
  const whois = object(host.whois);
  const network = object(whois.network);
  const location = object(host.location);
  const dns = object(host.dns);
  const services = Array.isArray(host.services) ? host.services : [];

  return {
    ip: String(host.ip ?? result.ip ?? ""),
    ownership: censysOwnership(as, network, location),
    location: censysLocation(location),
    dnsNames: strings(dns.names ?? host.names, 100),
    serviceCount: typeof host.service_count === "number" ? host.service_count : services.length,
    services: services.slice(0, 100).map(normalizeCensysService),
  };
}

function assertPublicIp(raw: string): string {
  const ip = raw.trim().toLowerCase();
  const version = isIP(ip);
  if (!version) throw new ApiError(400, "invalid_ip", "Enter a valid IPv4 or IPv6 address.");
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (isPrivateIpv4(a, b)) {
      throw new ApiError(400, "private_ip", "Censys host lookup is only available for public IP addresses.");
    }
  } else if (isPrivateIpv6(ip)) {
    throw new ApiError(400, "private_ip", "Censys host lookup is only available for public IP addresses.");
  }
  return ip;
}

async function integrationRow(integrationId?: string): Promise<IntegrationConfig> {
  const row = integrationId
    ? await prisma.integrationConfig.findFirst({ where: { id: integrationId, type: "CENSYS", enabled: true } })
    : await prisma.integrationConfig.findFirst({ where: { type: "CENSYS", enabled: true }, orderBy: { createdAt: "asc" } });
  if (!row) throw new ApiError(404, "no_censys_source", "No enabled Censys integration is configured.");
  return row;
}

export interface CensysLookupOptions {
  integrationId?: string;
  source: CensysLookupSource;
  /** Ignore a valid cached response. Intended for explicit workflow refreshes only. */
  forceRefresh?: boolean;
}

/** Physical expiry sweep; invoked by the background scheduler. */
export async function cleanupCensysData(now = new Date()): Promise<{ cacheRows: number; usageRows: number }> {
  const [cache, usage] = await prisma.$transaction([
    prisma.censysLookupCache.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.censysApiUsage.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000) } },
    }),
  ]);
  return { cacheRows: cache.count, usageRows: usage.count };
}

export async function lookupCensysHost(rawIp: string, options: CensysLookupOptions) {
  const ip = assertPublicIp(rawIp);
  const integration = await integrationRow(options.integrationId);
  const settings = censysSettingsSchema.parse(integration.settings ?? {});
  const cfg = toDriverConfig(integration);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    // Serialize identical lookups across AI, MCP and workflows. This is what
    // prevents two simultaneous cache misses from spending two credits.
    // PostgreSQL returns the pseudo-type `void` from advisory-lock functions.
    // Cast it so Prisma can deserialize the otherwise intentionally empty row.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`censys:${integration.id}:${ip}`}))::text AS lock_result`;

    const cached = await tx.censysLookupCache.findUnique({
      where: { integrationId_lookupKind_cacheKey: { integrationId: integration.id, lookupKind: "host", cacheKey: ip } },
    });
    if (!options.forceRefresh && cached && cached.expiresAt > now) {
      await Promise.all([
        tx.censysLookupCache.update({ where: { id: cached.id }, data: { hitCount: { increment: 1 }, lastAccessedAt: now } }),
        tx.censysApiUsage.create({ data: { integrationId: integration.id, source: options.source, operation: "host.lookup", cacheKey: ip, cacheHit: true } }),
      ]);
      return {
        integration: { id: integration.id, name: integration.name },
        host: normalizeCensysHost(cached.response),
        cached: true,
        estimatedProviderCredits: 0,
        changed: cached.changed,
        fetchedAt: cached.fetchedAt.toISOString(),
        expiresAt: cached.expiresAt.toISOString(),
        usage: await usageSummary(tx, integration.id, settings.aiDailyCallLimit, now),
      };
    }

    if (options.source === "ai" || options.source === "mcp") {
      const used = await liveAiUsage(tx, integration.id, now);
      if (used >= settings.aiDailyCallLimit) {
        throw new ApiError(
          429,
          "censys_ai_limit_reached",
          `The Censys AI/MCP limit of ${settings.aiDailyCallLimit} live lookups per rolling 24 hours has been reached. Cached results remain available.`,
        );
      }
    }

    const response = await fetchCensysHost(cfg, ip);
    const serialized = JSON.stringify(response);
    if (serialized.length > 4_000_000) throw new ApiError(502, "censys_response_too_large", "Censys returned an unexpectedly large host record.");
    const responseHash = sha256Hex(serialized);
    const changed = Boolean(cached && cached.responseHash !== responseHash);
    const expiresAt = new Date(now.getTime() + CENSYS_CACHE_TTL_MS);
    const json = JSON.parse(serialized) as Prisma.InputJsonValue;

    await tx.censysLookupCache.upsert({
      where: { integrationId_lookupKind_cacheKey: { integrationId: integration.id, lookupKind: "host", cacheKey: ip } },
      create: {
        integrationId: integration.id, lookupKind: "host", cacheKey: ip,
        response: json, responseHash, fetchedBy: options.source, fetchedAt: now, expiresAt,
      },
      update: {
        response: json, previousResponseHash: cached?.responseHash ?? null, responseHash,
        changed, fetchedBy: options.source, fetchedAt: now, expiresAt, lastAccessedAt: now,
      },
    });
    await tx.censysApiUsage.create({
      data: { integrationId: integration.id, source: options.source, operation: "host.lookup", cacheKey: ip, cacheHit: false },
    });

    return {
      integration: { id: integration.id, name: integration.name },
      host: normalizeCensysHost(response),
      cached: false,
      // Censys currently prices the standard single-asset Get Host endpoint
      // at one provider credit. This is separate from PolySIEM's AI/MCP cap.
      estimatedProviderCredits: 1,
      changed,
      fetchedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      usage: await usageSummary(tx, integration.id, settings.aiDailyCallLimit, now),
    };
  }, { timeout: 30_000 });
}

type Transaction = Prisma.TransactionClient;

async function liveAiUsage(tx: Transaction, integrationId: string, now: Date): Promise<number> {
  return tx.censysApiUsage.count({
    where: {
      integrationId, cacheHit: false, source: { in: ["ai", "mcp"] },
      createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1_000) },
    },
  });
}

async function usageSummary(tx: Transaction, integrationId: string, limit: number, now: Date) {
  const used = await liveAiUsage(tx, integrationId, now);
  return { window: "rolling_24_hours" as const, limit, used, remaining: Math.max(0, limit - used) };
}

/** Credit-free provider balance plus the calls PolySIEM can account for locally. */
export async function getCensysCreditStatus(integrationId: string) {
  const integration = await integrationRow(integrationId);
  const settings = censysSettingsSchema.parse(integration.settings ?? {});
  const [provider, liveLookups24h, liveLookups30d, cacheHits30d, ai] = await Promise.all([
    fetchCensysCreditBalance(toDriverConfig(integration)),
    prisma.censysApiUsage.count({
      where: { integrationId, cacheHit: false, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1_000) } },
    }),
    prisma.censysApiUsage.count({
      where: { integrationId, cacheHit: false, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000) } },
    }),
    prisma.censysApiUsage.count({
      where: { integrationId, cacheHit: true, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000) } },
    }),
    prisma.$transaction((tx) => usageSummary(tx, integrationId, settings.aiDailyCallLimit, new Date())),
  ]);

  return {
    provider,
    polysiem: { liveLookups24h, liveLookups30d, cacheHits30d },
    ai,
    checkedAt: new Date().toISOString(),
  };
}
