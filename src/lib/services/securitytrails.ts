import "server-only";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { Prisma, type IntegrationConfig } from "@prisma/client";
import { ApiError } from "@/lib/api";
import { sha256Hex } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { toDriverConfig } from "@/lib/integrations";
import { fetchSecurityTrails, type SecurityTrailsLookupKind } from "@/lib/integrations/securitytrails/client";
import { securityTrailsSettingsSchema } from "@/lib/validators/integrations";

export const SECURITYTRAILS_CACHE_TTL_MS = 4 * 24 * 60 * 60 * 1_000;
export type { SecurityTrailsLookupKind };
export type SecurityTrailsLookupSource = "ai" | "mcp" | "workflow" | "manual";

export interface SecurityTrailsLookupOptions {
  integrationId?: string;
  source: SecurityTrailsLookupSource;
  forceRefresh?: boolean;
}

export interface SecurityTrailsSubjectLookupOptions extends SecurityTrailsLookupOptions {
  subjectType: "ip" | "domain";
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown, limit = 200): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, limit)
    : [];
}

function scalar(value: unknown): string | number | boolean | null {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
}

function scalarEntries(value: unknown, limit = 50): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(object(value)).slice(0, limit).map(([key, item]) => [key, scalar(item)]),
  );
}

function dnsValues(value: unknown) {
  const section = object(value);
  const values = Array.isArray(section.values) ? section.values : [];
  return values.slice(0, 200).map((raw) => {
    if (typeof raw === "string") return { value: raw };
    const row = object(raw);
    return {
      value: scalar(row.ip ?? row.hostname ?? row.value),
      priority: scalar(row.priority),
      firstSeen: scalar(row.first_seen),
      lastSeen: scalar(row.last_seen),
      organizations: strings(row.organizations, 20),
    };
  });
}

export function normalizeSecurityTrailsDomain(response: unknown, query: string) {
  const root = object(response);
  const currentDns = object(root.current_dns);
  const records = Object.fromEntries(
    Object.entries(currentDns).slice(0, 20).map(([type, value]) => [type.toUpperCase(), dnsValues(value)]),
  );
  return {
    kind: "domain" as const,
    domain: String(root.hostname ?? query),
    apexDomain: scalar(root.apex_domain),
    records,
    statistics: scalarEntries(root.computed),
  };
}

export function normalizeSecurityTrailsSubdomains(response: unknown, query: string) {
  const root = object(response);
  const labels = strings(root.subdomains, 1_000);
  return {
    kind: "subdomains" as const,
    domain: query,
    count: typeof root.subdomain_count === "number" ? root.subdomain_count : labels.length,
    subdomains: labels.map((label) => label.endsWith(`.${query}`) ? label : `${label}.${query}`),
  };
}

function normalizeWhoisRecord(response: unknown) {
  const root = object(response);
  const current = object(root.current ?? root);
  const registrar = object(current.registrar);
  return {
    registrar: scalar(registrar.name ?? current.registrar_name ?? current.registrar),
    createdAt: scalar(current.createdDate ?? current.created_date),
    updatedAt: scalar(current.updatedDate ?? current.updated_date),
    expiresAt: scalar(current.expiresDate ?? current.expires_date),
    nameservers: strings(current.nameServers ?? current.name_servers, 100),
    status: strings(current.status, 100),
    organization: scalar(current.organization ?? current.registrant_organization),
    country: scalar(current.country ?? current.registrant_country),
  };
}

export function normalizeSecurityTrailsDomainWhois(response: unknown, query: string) {
  return { kind: "domain_whois" as const, domain: query, whois: normalizeWhoisRecord(response) };
}

export function normalizeSecurityTrailsIpWhois(response: unknown, query: string) {
  const root = object(response);
  const current = object(root.current ?? root);
  return {
    kind: "ip_whois" as const,
    ip: query,
    organization: scalar(current.organization ?? current.org ?? current.netname),
    asn: scalar(current.asn),
    network: scalar(current.cidr ?? current.range ?? current.network),
    country: scalar(current.country ?? current.country_code),
    description: scalar(current.description),
  };
}

export function normalizeSecurityTrails(kind: SecurityTrailsLookupKind, response: unknown, query: string) {
  if (kind === "domain") return normalizeSecurityTrailsDomain(response, query);
  if (kind === "subdomains") return normalizeSecurityTrailsSubdomains(response, query);
  if (kind === "domain_whois") return normalizeSecurityTrailsDomainWhois(response, query);
  return normalizeSecurityTrailsIpWhois(response, query);
}

function normalizeDomain(raw: string): string {
  const input = raw.trim().toLowerCase().replace(/\.$/, "");
  const domain = domainToASCII(input);
  if (!domain || domain.length > 253 || !domain.includes(".") ||
    !domain.split(".").every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))) {
    throw new ApiError(400, "invalid_domain", "Enter a valid domain name.");
  }
  return domain;
}

function normalizePublicIpv4(raw: string): string {
  const ip = raw.trim();
  if (isIP(ip) !== 4) throw new ApiError(400, "invalid_ip", "SecurityTrails IP WHOIS requires an IPv4 address.");
  const [a, b] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) {
    throw new ApiError(400, "private_ip", "SecurityTrails IP WHOIS is limited to public IPv4 addresses.");
  }
  return ip;
}

function normalizedQuery(kind: SecurityTrailsLookupKind, raw: string): string {
  return kind === "ip_whois" ? normalizePublicIpv4(raw) : normalizeDomain(raw);
}

async function integrationRow(integrationId?: string): Promise<IntegrationConfig> {
  const row = integrationId
    ? await prisma.integrationConfig.findFirst({ where: { id: integrationId, type: "SECURITYTRAILS", enabled: true } })
    : await prisma.integrationConfig.findFirst({ where: { type: "SECURITYTRAILS", enabled: true }, orderBy: { createdAt: "asc" } });
  if (!row) throw new ApiError(404, "no_securitytrails_source", "No enabled SecurityTrails integration is configured.");
  return row;
}

type Transaction = Prisma.TransactionClient;

async function liveAiUsage(tx: Transaction, integrationId: string, now: Date): Promise<number> {
  return tx.securityTrailsApiUsage.count({
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

export async function cleanupSecurityTrailsData(now = new Date()): Promise<{ cacheRows: number; usageRows: number }> {
  const [cache, usage] = await prisma.$transaction([
    prisma.securityTrailsLookupCache.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.securityTrailsApiUsage.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000) } },
    }),
  ]);
  return { cacheRows: cache.count, usageRows: usage.count };
}

export async function lookupSecurityTrailsOperation(
  kind: SecurityTrailsLookupKind,
  rawQuery: string,
  options: SecurityTrailsLookupOptions,
) {
  const query = normalizedQuery(kind, rawQuery);
  const integration = await integrationRow(options.integrationId);
  const settings = securityTrailsSettingsSchema.parse(integration.settings ?? {});
  const cfg = toDriverConfig(integration);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`securitytrails:${integration.id}:${kind}:${query}`}))::text AS lock_result`;
    const cached = await tx.securityTrailsLookupCache.findUnique({
      where: { integrationId_lookupKind_cacheKey: { integrationId: integration.id, lookupKind: kind, cacheKey: query } },
    });
    if (!options.forceRefresh && cached && cached.expiresAt > now) {
      await Promise.all([
        tx.securityTrailsLookupCache.update({ where: { id: cached.id }, data: { hitCount: { increment: 1 }, lastAccessedAt: now } }),
        tx.securityTrailsApiUsage.create({ data: { integrationId: integration.id, source: options.source, operation: `${kind}.lookup`, cacheKey: query, cacheHit: true } }),
      ]);
      return {
        integration: { id: integration.id, name: integration.name }, kind, query,
        data: normalizeSecurityTrails(kind, cached.response, query), cached: true, changed: cached.changed,
        fetchedAt: cached.fetchedAt.toISOString(), expiresAt: cached.expiresAt.toISOString(),
        usage: await usageSummary(tx, integration.id, settings.aiDailyCallLimit, now),
      };
    }

    if (options.source === "ai" || options.source === "mcp") {
      // One integration-wide lock makes the rolling limit exact even when two
      // different subjects miss the cache concurrently.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`securitytrails-budget:${integration.id}`}))::text AS lock_result`;
      const used = await liveAiUsage(tx, integration.id, now);
      if (used >= settings.aiDailyCallLimit) {
        throw new ApiError(
          429, "securitytrails_ai_limit_reached",
          `The SecurityTrails AI/MCP limit of ${settings.aiDailyCallLimit} live requests per rolling 24 hours has been reached. Cached results remain available.`,
        );
      }
    }

    const response = await fetchSecurityTrails(cfg, kind, query);
    const serialized = JSON.stringify(response);
    if (serialized.length > 4_000_000) {
      throw new ApiError(502, "securitytrails_response_too_large", "SecurityTrails returned an unexpectedly large response.");
    }
    const responseHash = sha256Hex(serialized);
    const changed = Boolean(cached && cached.responseHash !== responseHash);
    const expiresAt = new Date(now.getTime() + SECURITYTRAILS_CACHE_TTL_MS);
    const json = JSON.parse(serialized) as Prisma.InputJsonValue;
    await tx.securityTrailsLookupCache.upsert({
      where: { integrationId_lookupKind_cacheKey: { integrationId: integration.id, lookupKind: kind, cacheKey: query } },
      create: {
        integrationId: integration.id, lookupKind: kind, cacheKey: query,
        response: json, responseHash, fetchedBy: options.source, fetchedAt: now, expiresAt,
      },
      update: {
        response: json, previousResponseHash: cached?.responseHash ?? null, responseHash,
        changed, fetchedBy: options.source, fetchedAt: now, expiresAt, lastAccessedAt: now,
      },
    });
    await tx.securityTrailsApiUsage.create({
      data: { integrationId: integration.id, source: options.source, operation: `${kind}.lookup`, cacheKey: query, cacheHit: false },
    });
    return {
      integration: { id: integration.id, name: integration.name }, kind, query,
      data: normalizeSecurityTrails(kind, response, query), cached: false, changed,
      fetchedAt: now.toISOString(), expiresAt: expiresAt.toISOString(),
      usage: await usageSummary(tx, integration.id, settings.aiDailyCallLimit, now),
    };
  }, { timeout: 30_000 });
}

export function lookupSecurityTrails(subject: string, options: SecurityTrailsSubjectLookupOptions) {
  return lookupSecurityTrailsOperation(options.subjectType === "ip" ? "ip_whois" : "domain", subject, options);
}

export const lookupSecurityTrailsDomain = (domain: string, options: SecurityTrailsLookupOptions) =>
  lookupSecurityTrailsOperation("domain", domain, options);
export const lookupSecurityTrailsSubdomains = (domain: string, options: SecurityTrailsLookupOptions) =>
  lookupSecurityTrailsOperation("subdomains", domain, options);
export const lookupSecurityTrailsDomainWhois = (domain: string, options: SecurityTrailsLookupOptions) =>
  lookupSecurityTrailsOperation("domain_whois", domain, options);
export const lookupSecurityTrailsIpWhois = (ip: string, options: SecurityTrailsLookupOptions) =>
  lookupSecurityTrailsOperation("ip_whois", ip, options);

export async function getSecurityTrailsUsageSummary(integrationId?: string) {
  const integration = await integrationRow(integrationId);
  const settings = securityTrailsSettingsSchema.parse(integration.settings ?? {});
  return prisma.$transaction((tx) => usageSummary(tx, integration.id, settings.aiDailyCallLimit, new Date()));
}
