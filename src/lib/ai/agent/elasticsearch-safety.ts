import { redactValue } from "@/lib/ai/agent/redact";

const MAX_DOCUMENT_FIELDS = 48;
const MAX_VALUE_LENGTH = 400;

export const SENSITIVE_ELASTIC_FIELD_RE =
  /(?:^|\.)(?:authorization|proxy-authorization|auth|bearer|cookie|set-cookie|password|passwd|secret|token|api[_-]?key|apikey|credential|credentials|private[_ -]?key|encrypted)(?:\.|$)/i;

export const ELASTIC_SOURCE_EXCLUDES = [
  "authorization", "*.authorization", "proxy-authorization", "*.proxy-authorization",
  "cookie", "*.cookie", "set-cookie", "*.set-cookie", "password", "*.password",
  "passwd", "*.passwd", "secret", "*.secret", "token", "*.token", "api_key", "*.api_key",
  "apikey", "*.apikey", "credential", "*.credential", "credentials", "*.credentials",
  "headers", "*.headers", "body", "*.body", "payload", "*.payload",
] as const;

function cappedString(value: string): string {
  return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
}

function safeLeaf(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return cappedString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => safeLeaf(item, secrets));
  try {
    return cappedString(JSON.stringify(redactValue(value, secrets)));
  } catch {
    return "[unserializable]";
  }
}

/** Flatten nested logs into a bounded, secret-safe field map for AI use. */
export function flattenSafeDocument(
  source: Record<string, unknown>,
  secrets: readonly string[] = [],
): { fields: Record<string, unknown>; truncated: boolean } {
  const flattened: Record<string, unknown> = {};
  let seen = 0;
  let truncated = false;

  const visit = (value: unknown, path: string, depth: number) => {
    if (seen >= MAX_DOCUMENT_FIELDS) {
      truncated = true;
      return;
    }
    if (SENSITIVE_ELASTIC_FIELD_RE.test(path)) {
      flattened[path] = "[REDACTED]";
      seen += 1;
      return;
    }
    if (value && typeof value === "object" && !Array.isArray(value) && depth < 6) {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        visit(child, path ? `${path}.${key}` : key, depth + 1);
        if (seen >= MAX_DOCUMENT_FIELDS) break;
      }
      return;
    }
    if (!path) return;
    flattened[path] = redactValue(safeLeaf(value, secrets), secrets);
    seen += 1;
  };
  visit(source, "", 0);
  return { fields: flattened, truncated };
}
