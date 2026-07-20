import "server-only";
import { HttpError, fetchJson } from "@/lib/integrations/http";
import type { DriverConfig, TestResult } from "@/lib/integrations/types";
import { securityTrailsCredentialsSchema } from "@/lib/validators/integrations";

export type SecurityTrailsLookupKind = "domain" | "subdomains" | "domain_whois" | "ip_whois";

function endpoint(cfg: DriverConfig, path: string): string {
  return `${cfg.baseUrl.replace(/\/$/, "")}${path}`;
}

function headers(cfg: DriverConfig): Record<string, string> {
  const { apiKey } = securityTrailsCredentialsSchema.parse(cfg.credentials);
  return { APIKEY: apiKey, Accept: "application/json" };
}

function friendlyError(error: unknown): Error {
  if (!(error instanceof HttpError)) return error instanceof Error ? error : new Error(String(error));
  if (error.status === 400) return new Error("SecurityTrails rejected the lookup value (HTTP 400). Check the domain or IPv4 address.");
  if (error.status === 401) return new Error("SecurityTrails rejected the API key (HTTP 401). Copy a current key from the SecurityTrails control panel.");
  if (error.status === 403) return new Error("The SecurityTrails API key or subscription cannot access this endpoint (HTTP 403).");
  if (error.status === 404) return new Error("SecurityTrails has no record for that lookup value.");
  if (error.status === 429) return new Error("SecurityTrails rate-limited the request or the account quota is exhausted (HTTP 429).");
  return error;
}

export function securityTrailsLookupPath(kind: SecurityTrailsLookupKind, query: string): string {
  const value = encodeURIComponent(query);
  if (kind === "domain") return `/domain/${value}`;
  if (kind === "subdomains") return `/domain/${value}/subdomains`;
  if (kind === "domain_whois") return `/domain/${value}/whois`;
  return `/ips/${value}/whois`;
}

export async function fetchSecurityTrails(
  cfg: DriverConfig,
  kind: SecurityTrailsLookupKind,
  query: string,
): Promise<unknown> {
  try {
    return await fetchJson<unknown>(cfg, endpoint(cfg, securityTrailsLookupPath(kind, query)), {
      headers: headers(cfg), timeoutMs: 20_000,
    });
  } catch (error) {
    throw friendlyError(error);
  }
}

/** GET /v1/ping is the official, read-only authentication probe. */
export async function testSecurityTrailsConnection(cfg: DriverConfig): Promise<TestResult> {
  try {
    await fetchJson<unknown>(cfg, endpoint(cfg, "/ping"), { headers: headers(cfg), timeoutMs: 12_000 });
    return { ok: true, detail: "Connected to SecurityTrails. The API key is valid for the read-only API." };
  } catch (error) {
    return { ok: false, detail: friendlyError(error).message };
  }
}
