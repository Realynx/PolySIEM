import type { OutputSpec } from "./types";
import { stringifyTemplateValue } from "./template-resolution";

export const REDACTED = "[redacted]";

export function redactOutput(
  output: Record<string, unknown>,
  specs: OutputSpec[],
): Record<string, unknown> {
  const secretKeys = new Set(specs.filter((spec) => spec.secret).map((spec) => spec.key));
  if (secretKeys.size === 0) return output;
  return Object.fromEntries(
    Object.entries(output).map(([key, value]) => [key, secretKeys.has(key) ? REDACTED : value]),
  );
}

export function collectSecrets(
  output: Record<string, unknown>,
  specs: OutputSpec[],
): Record<string, string> | null {
  const entries = specs
    .filter((spec) => spec.secret && output[spec.key] !== undefined)
    .map((spec) => [spec.key, stringifyTemplateValue(output[spec.key])] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}
