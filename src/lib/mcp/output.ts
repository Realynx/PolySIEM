/**
 * Output shaping for every MCP tool/resource (pure; unit-tested).
 *
 * Defence in depth: the tool layer already selects explicit, secret-free
 * columns, but every result still passes through here so a credential can
 * never leave the server by accident (a stray Proxmox `cipassword` inside a
 * metadata blob, a UniFi passphrase, an Authorization header echoed in an
 * error, a PEM block pasted into a doc).
 */
import { redactSecrets, redactValue, REDACTED } from "@/lib/ai/agent/redact";
import { anonymizeDeep, scrubText } from "@/lib/privacy/anonymize";
import { toJsonSafe } from "@/lib/serialize";

/** Keys dropped outright (substring match): stored secrets and their hashes. */
const DROP_KEY_RE =
  /(password|passwd|passphrase|secret|credential|private_?key|privatekey|api_?key|tokenhash|encrypted|authorizedkey$|rawconfig|cookie)/i;
const DROP_EXACT = new Set(["token", "psk", "x_passphrase", "wpa_psk", "x_password", "cipassword"]);

const PEM_PRIVATE_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const PS_TOKEN_RE = /\bps_[A-Za-z0-9_-]{16,}\b/g;

/** Hard cap on one tool result, so a single call cannot flood the context window. */
export const MAX_RESULT_CHARS = 60_000;

function isDroppedKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (DROP_EXACT.has(lower)) return true;
  // Public keys and their fingerprints are documentation, not secrets.
  if (/public_?key|fingerprint/.test(lower)) return false;
  return DROP_KEY_RE.test(lower);
}

function scrubString(value: string): string {
  return redactSecrets(value.replace(PEM_PRIVATE_RE, REDACTED).replace(PS_TOKEN_RE, REDACTED));
}

function dropSecretKeys(value: unknown): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map(dropSecretKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isDroppedKey(key)) continue;
      out[key] = dropSecretKeys(child);
    }
    return out;
  }
  return value;
}

export interface OutputOptions {
  /** The token owner has PolySIEM's anonymous mode on: pseudonymize names/IPs/MACs. */
  anonymize?: boolean;
  /** Skip secret scrubbing (only the explicitly audited credential tool uses this). */
  allowSecrets?: boolean;
}

/** JSON-safe, secret-free (and optionally anonymized) copy of a tool result. */
export function sanitizeOutput(value: unknown, opts: OutputOptions = {}): unknown {
  let out = toJsonSafe(value);
  if (!opts.allowSecrets) out = redactValue(dropSecretKeys(out));
  if (opts.anonymize) out = anonymizeDeep(out);
  return out;
}

/** Secret-free (and optionally anonymized) text, for markdown outputs. */
export function sanitizeText(text: string, opts: OutputOptions = {}): string {
  const scrubbed = opts.allowSecrets ? text : scrubString(text);
  return opts.anonymize ? scrubText(scrubbed) : scrubbed;
}

/** Compact JSON (no indentation: it costs tokens and models do not need it), capped. */
export function formatJson(value: unknown): string {
  const text = JSON.stringify(value) ?? "null";
  return capText(text);
}

export function capText(text: string, max = MAX_RESULT_CHARS): string {
  if (text.length <= max) return text;
  return (
    `${text.slice(0, max)}\n…[output truncated at ${max} characters: narrow the query, ` +
    "lower `limit`, use `detail: \"summary\"`, or page with `cursor`]"
  );
}
