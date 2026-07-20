import "server-only";
import { HttpError, fetchJson } from "@/lib/integrations/http";
import type { DriverConfig, TestResult } from "@/lib/integrations/types";
import { censysCredentialsSchema, censysSettingsSchema } from "@/lib/validators/integrations";

const HOST_ACCEPT = "application/vnd.censys.api.v3.host.v1+json";

export interface CensysProviderCreditBalance {
  remaining: number | null;
  limit: number | null;
  used: number | null;
  expiresAt: string | null;
  scope: "user" | "organization";
}

function endpoint(cfg: DriverConfig, path: string): string {
  return `${cfg.baseUrl.replace(/\/$/, "")}${path}`;
}

function headers(cfg: DriverConfig, accept = "application/json"): Record<string, string> {
  const { accessToken } = censysCredentialsSchema.parse(cfg.credentials);
  const { organizationId } = censysSettingsSchema.parse(cfg.settings);
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: accept,
    ...(organizationId ? { "X-Organization-ID": organizationId } : {}),
  };
}

function friendlyError(error: unknown): Error {
  if (!(error instanceof HttpError)) return error instanceof Error ? error : new Error(String(error));
  if (error.status === 401) return new Error("Censys rejected the personal access token (HTTP 401). Create or rotate a Platform API PAT and try again.");
  if (error.status === 403) return new Error("The Censys token cannot access that account or organization (HTTP 403).");
  if (error.status === 404) return new Error("Censys has no host record for that IP address.");
  if (error.status === 429) return new Error("Censys rate-limited this request. Try again after the provider limit resets.");
  return error;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function firstNumber(source: unknown, keys: string[], depth = 0): number | null {
  if (depth > 5 || !source || typeof source !== "object") return null;
  if (Array.isArray(source)) {
    for (const child of source) {
      const value = firstNumber(child, keys, depth + 1);
      if (value !== null) return value;
    }
    return null;
  }
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = finiteNumber(record[key]);
    if (value !== null) return value;
  }
  for (const child of Object.values(record)) {
    const value = firstNumber(child, keys, depth + 1);
    if (value !== null) return value;
  }
  return null;
}

function firstString(source: unknown, keys: string[], depth = 0): string | null {
  if (depth > 5 || !source || typeof source !== "object") return null;
  if (Array.isArray(source)) {
    for (const child of source) {
      const value = firstString(child, keys, depth + 1);
      if (value) return value;
    }
    return null;
  }
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  for (const child of Object.values(record)) {
    const value = firstString(child, keys, depth + 1);
    if (value) return value;
  }
  return null;
}

export function normalizeCensysCreditBalance(
  response: unknown,
  scope: CensysProviderCreditBalance["scope"],
): CensysProviderCreditBalance {
  const envelope = object(response);
  const result = object(envelope.result ?? envelope);
  const remaining = firstNumber(result, ["remaining", "credits_remaining", "credit_balance", "balance", "available_credits", "available"]);
  const limit = firstNumber(result, ["limit", "credit_limit", "credits_total", "total_credits", "monthly_limit", "allocated", "allocation"]);
  const explicitUsed = firstNumber(result, ["used", "credits_used", "credits_consumed", "consumed", "usage"]);
  return {
    remaining,
    limit,
    used: explicitUsed ?? (remaining !== null && limit !== null ? Math.max(0, limit - remaining) : null),
    expiresAt: firstString(result, ["expires_at", "expiration", "expiresAt", "reset_at", "renews_at"]),
    scope,
  };
}

/** Reading the personal or organization credit balance does not consume credits. */
export async function fetchCensysCreditBalance(cfg: DriverConfig): Promise<CensysProviderCreditBalance> {
  const { organizationId } = censysSettingsSchema.parse(cfg.settings);
  const scope = organizationId ? "organization" : "user";
  const path = organizationId
    ? `/accounts/organizations/${encodeURIComponent(organizationId)}/credits`
    : "/accounts/users/credits";
  try {
    const response = await fetchJson<unknown>(cfg, endpoint(cfg, path), {
      headers: headers(cfg),
      timeoutMs: 12_000,
    });
    return normalizeCensysCreditBalance(response, scope);
  } catch (error) {
    throw friendlyError(error);
  }
}

export async function fetchCensysHost(cfg: DriverConfig, ip: string): Promise<unknown> {
  try {
    return await fetchJson<unknown>(cfg, endpoint(cfg, `/global/asset/host/${encodeURIComponent(ip)}`), {
      headers: headers(cfg, HOST_ACCEPT),
      timeoutMs: 20_000,
    });
  } catch (error) {
    throw friendlyError(error);
  }
}

/** Account-credit reads do not consume Censys Platform credits. */
export async function testCensysConnection(cfg: DriverConfig): Promise<TestResult> {
  try {
    const balance = await fetchCensysCreditBalance(cfg);
    return {
      ok: true,
      detail: balance.remaining === null
        ? "Connected to Censys Platform. The token and account scope are valid."
        : `Connected to Censys Platform. ${balance.remaining.toLocaleString()} credits remain.`,
    };
  } catch (error) {
    return { ok: false, detail: friendlyError(error).message };
  }
}
