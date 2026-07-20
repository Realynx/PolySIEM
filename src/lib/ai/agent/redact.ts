/**
 * Secret redaction for agent tool output and investigation reports.
 *
 * Pure (no server-only imports) so it is unit-testable. Everything a tool
 * returns is passed through here before it can land in a `resultPreview`, a
 * streamed token, or the persisted InvestigationReport. The goal is defence in
 * depth: tools are already written not to surface credentials, but a stray
 * `Authorization` header or an API key echoed back in an error string must
 * never reach the model, the UI, or the database.
 */

export const REDACTED = "[REDACTED]";

/** Object keys whose values are always sensitive, matched case-insensitively. */
const SECRET_KEY_RE =
  /^(?:.*[_-])?(?:password|passwd|secret|token|api[\s_-]?key|apikey|credential|credentials|authorization|auth|bearer|private[\s_-]?key|encrypted\w*|otxkey|cookie|set[\s_-]?cookie)$/i;

/**
 * Elasticsearch/ECS documents frequently use flattened dotted keys such as
 * `http.request.headers.authorization`. Other producers serialize the same
 * path with bracket notation (`headers[authorization]`). Check the terminal
 * path segment as well as the complete key so those values receive the same
 * protection as a normally nested `{ headers: { authorization: ... } }`
 * object. Exact segment matching avoids treating ordinary fields such as
 * `authorization_status` or `token_count` as credentials.
 */
function isSensitiveKey(key: string): boolean {
  if (SECRET_KEY_RE.test(key)) return true;

  const leaf = key
    .trim()
    .replace(/\]\s*$/, "")
    .split(/[.[]/)
    .at(-1)
    ?.trim()
    .replace(/^["']|["']$/g, "");

  return Boolean(leaf && SECRET_KEY_RE.test(leaf));
}

/**
 * Inline "key: value" / "key=value" credential patterns inside free text
 * (error messages, log lines). Keeps the label, redacts the value.
 */
const INLINE_SECRET_RE =
  /\b(api[_-]?key|apikey|token|password|passwd|secret|x-api-key|abuseipdb[_-]?key)\b(\s*[:=]\s*|\s+)("?)([^\s"',}]+)\3/gi;

/** Authorization scheme prefixes carrying an opaque credential. */
const AUTH_SCHEME_RE = /\b(Bearer|ApiKey|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/g;

/**
 * Redact secrets from a plain string: any caller-supplied literal secret first
 * (exact match), then well-known inline credential shapes.
 */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      out = out.split(secret).join(REDACTED);
    }
  }
  // Auth schemes first so an opaque token (e.g. a JWT) is not left behind by
  // the inline "label: value" rule.
  out = out.replace(AUTH_SCHEME_RE, (_m, scheme: string) => `${scheme} ${REDACTED}`);
  out = out.replace(INLINE_SECRET_RE, (_m, label: string, sep: string) => {
    const cleanSep = sep.includes("=") ? "=" : sep.includes(":") ? ": " : " ";
    return `${label}${cleanSep}${REDACTED}`;
  });
  return out;
}

/**
 * Recursively redact a JSON-safe value: string leaves run through
 * {@link redactSecrets}; object properties whose key looks sensitive are
 * replaced wholesale. Returns a new structure — the input is not mutated.
 */
export function redactValue<T>(value: T, secrets: readonly string[] = []): T {
  if (typeof value === "string") {
    return redactSecrets(value, secrets) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, secrets)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactValue(v, secrets);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Serialize an arbitrary tool result to a compact, redacted JSON string capped
 * at `maxLen` characters, suitable for AgentToolCall.resultPreview.
 */
export function toResultPreview(value: unknown, maxLen = 600, secrets: readonly string[] = []): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(redactValue(value, secrets));
  } catch {
    text = String(value);
  }
  const redacted = typeof value === "string" ? redactSecrets(text, secrets) : text;
  return redacted.length > maxLen ? `${redacted.slice(0, maxLen)}…` : redacted;
}
