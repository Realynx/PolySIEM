import { createHash } from "node:crypto";
import { scanFindingSchema, type ScanFinding } from "@/lib/validators/scan";

/**
 * Robust extraction of findings from model output. Local models wrapped in
 * format:"json" still occasionally emit code fences, leading prose, a bare
 * array, or a single finding object — accept all of those, reject garbage.
 */
export function parseFindings(text: string): ScanFinding[] {
  const json = extractJson(text);
  if (json === null) return [];

  let candidates: unknown[];
  if (Array.isArray(json)) {
    candidates = json;
  } else if (json && typeof json === "object" && Array.isArray((json as { findings?: unknown }).findings)) {
    candidates = (json as { findings: unknown[] }).findings;
  } else if (json && typeof json === "object") {
    candidates = [json]; // single finding without the wrapper
  } else {
    return [];
  }

  const findings: ScanFinding[] = [];
  for (const candidate of candidates) {
    const parsed = scanFindingSchema.safeParse(candidate);
    if (parsed.success) findings.push(parsed.data);
  }
  return findings;
}

/** Strip code fences / surrounding prose and parse the first JSON value. */
export function extractJson(text: string): unknown {
  let cleaned = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
  if (fence) cleaned = fence[1].trim();

  const start = findJsonStart(cleaned);
  if (start === -1) return null;
  cleaned = cleaned.slice(start);

  try {
    return JSON.parse(cleaned);
  } catch {
    // Trailing prose after the JSON value — walk back to the last closer.
    for (let end = cleaned.length; end > 0; end--) {
      const ch = cleaned[end - 1];
      if (ch !== "}" && ch !== "]") continue;
      try {
        return JSON.parse(cleaned.slice(0, end));
      } catch {
        // keep walking back
      }
    }
    return null;
  }
}

function findJsonStart(text: string): number {
  const obj = text.indexOf("{");
  const arr = text.indexOf("[");
  if (obj === -1) return arr;
  if (arr === -1) return obj;
  return Math.min(obj, arr);
}

/**
 * Stable dedupe key for a finding: normalized model-provided slug scoped by
 * digest scope, hashed so key length/charset never leaks into the DB index.
 */
export function dedupeKeyFor(scope: string, dedupe: string): string {
  const normalized = dedupe
    .toLowerCase()
    .replace(/[^a-z0-9.:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return createHash("sha1").update(`${scope}:${normalized}`).digest("hex").slice(0, 16);
}
