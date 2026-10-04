/**
 * Origin validation for the MCP endpoint (pure; unit-tested).
 *
 * The MCP spec asks Streamable HTTP servers to validate `Origin` to stop DNS
 * rebinding: a malicious web page whose hostname is re-pointed at the lab
 * could otherwise make the victim's browser POST to /api/mcp. Only browsers
 * attach `Origin` to such requests, so the policy is:
 *
 *   - No Origin header: a non-browser client (Claude Code, the MCP Inspector
 *     CLI, curl, mcp-remote). Allowed; the Bearer token is still mandatory.
 *   - Origin "null" or unparseable: rejected (sandboxed iframes, file://).
 *   - Loopback origins (localhost, 127.0.0.0/8, ::1): allowed. A rebinding
 *     attacker's page always carries the attacker's own hostname, never a
 *     loopback one, and local tools such as the Inspector UI live there.
 *   - The configured public URL (APP_URL) or an explicit allow-list entry
 *     (POLYSIEM_MCP_ALLOWED_ORIGINS, comma separated, "*" = any): allowed.
 *   - Origin equal to the Host header when that host is an IP literal: allowed
 *     (an IP literal cannot be DNS-rebound).
 *   - Everything else, including a same-host DNS name that is not configured
 *     (exactly the shape of a rebinding attack): rejected.
 */

export interface OriginPolicy {
  /** The instance's own public URL (APP_URL), if configured. */
  appUrl?: string | null;
  /** Extra allowed browser origins, e.g. "https://inspector.example". */
  allowedOrigins?: readonly string[];
}

export type OriginDecision =
  | { ok: true; reason: "no_origin" | "loopback" | "allow_listed" | "same_ip_host" }
  | { ok: false; origin: string; message: string };

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

export function isLoopbackHost(hostname: string): boolean {
  const host = stripBrackets(hostname.toLowerCase());
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function isIpLiteral(hostname: string): boolean {
  const host = stripBrackets(hostname);
  return IPV4_RE.test(host) || host.includes(":");
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Parse POLYSIEM_MCP_ALLOWED_ORIGINS ("a, b" or "*"). */
export function parseAllowedOrigins(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function rejection(origin: string): OriginDecision {
  return {
    ok: false,
    origin,
    message:
      `Browser Origin "${origin}" is not allowed to call the PolySIEM MCP endpoint (DNS-rebinding protection). ` +
      "CLI clients such as Claude Code should not send an Origin header. To allow a browser-based MCP client, " +
      "add its origin to POLYSIEM_MCP_ALLOWED_ORIGINS or set APP_URL to the URL you open PolySIEM on.",
  };
}

function isAllowListed(origin: string, policy: OriginPolicy): boolean {
  const entries = [...(policy.allowedOrigins ?? []), ...(policy.appUrl ? [policy.appUrl] : [])];
  if (entries.includes("*")) return true;
  return entries.some((entry) => normalizeOrigin(entry) === origin);
}

export function checkMcpOrigin(headers: Headers, policy: OriginPolicy = {}): OriginDecision {
  const rawOrigin = headers.get("origin");
  if (rawOrigin === null || rawOrigin.trim() === "") return { ok: true, reason: "no_origin" };

  const origin = normalizeOrigin(rawOrigin);
  if (!origin) return rejection(rawOrigin);

  const { hostname, host } = new URL(origin);
  if (isLoopbackHost(hostname)) return { ok: true, reason: "loopback" };

  if (isAllowListed(origin, policy)) return { ok: true, reason: "allow_listed" };

  const requestHost = headers.get("x-forwarded-host") ?? headers.get("host");
  if (requestHost && requestHost.toLowerCase() === host && isIpLiteral(hostname)) {
    return { ok: true, reason: "same_ip_host" };
  }
  return rejection(rawOrigin);
}
