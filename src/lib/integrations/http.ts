import { Agent } from "undici";
import type { DriverConfig } from "./types";

/** HTTP error carrying the response status so callers can fall back on 404 etc. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

let insecureAgent: Agent | undefined;

/** Lazily-created undici agent that skips TLS certificate verification. */
function getInsecureAgent(): Agent {
  insecureAgent ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureAgent;
}

export interface JsonFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Per-request timeout; defaults to 10 seconds. */
  timeoutMs?: number;
}

function errorCause(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof Error)) return null;
  const cause = (error as Error & { cause?: unknown }).cause;
  return cause !== null && typeof cause === "object"
    ? (cause as Record<string, unknown>)
    : null;
}

const TLS_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

/** Turn Node's terse `fetch failed` transport errors into safe, actionable UI text. */
export function integrationFetchErrorMessage(url: string, error: unknown): string {
  const endpoint = (() => {
    try {
      const parsed = new URL(url);
      return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    } catch {
      return "the integration endpoint";
    }
  })();
  const cause = errorCause(error);
  const code = typeof cause?.code === "string" ? cause.code : "";
  const detail = typeof cause?.message === "string"
    ? cause.message
    : error instanceof Error
      ? error.message
      : String(error);

  if (TLS_ERROR_CODES.has(code)) {
    return `TLS certificate verification failed for ${endpoint}. If this appliance uses its default self-signed certificate, edit the integration and turn off “Verify TLS certificate”.`;
  }
  if (code === "ECONNREFUSED") {
    return `Connection to ${endpoint} was refused. Check the address, port, and whether the service is running.`;
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return `PolySIEM could not resolve ${endpoint}. Check the hostname and container DNS settings.`;
  }
  if (code === "EACCES") {
    return `PolySIEM is not allowed to connect to ${endpoint}. Check the host or container network and firewall rules.`;
  }
  if (code === "UND_ERR_CONNECT_TIMEOUT" || error instanceof DOMException && error.name === "TimeoutError") {
    return `Connection to ${endpoint} timed out. Check routing and firewall access from the PolySIEM host.`;
  }
  return `Could not connect to ${endpoint}: ${detail}`;
}

/**
 * Fetch JSON from an integration endpoint. Honors `verifyTls: false` by
 * routing the request through an undici Agent with certificate checks off
 * (common for self-signed homelab appliances).
 */
export async function fetchJson<T>(
  cfg: Pick<DriverConfig, "verifyTls">,
  url: string,
  opts: JsonFetchOptions = {},
): Promise<T> {
  const method = opts.method ?? "GET";
  const init: RequestInit & { dispatcher?: Agent } = {
    method,
    headers: {
      Accept: "application/json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...opts.headers,
    },
    body: opts.body,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    cache: "no-store",
  };
  if (cfg.verifyTls === false) init.dispatcher = getInsecureAgent();
  let res: Response;
  try {
    res = await fetch(url, init as RequestInit);
  } catch (error) {
    throw new Error(integrationFetchErrorMessage(url, error));
  }
  if (!res.ok) {
    throw new HttpError(res.status, `${method} ${url} failed with HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}
