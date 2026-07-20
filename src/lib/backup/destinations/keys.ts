/**
 * Pure object-key helpers shared by the S3 and Azure destinations. Kept free
 * of any I/O so they are trivially unit-testable (see keys.test.ts).
 */

/** Strip control characters and normalise back-slashes to forward-slashes. */
export function sanitizeKeySegment(segment: string): string {
  let out = "";
  for (const ch of segment) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue; // drop control characters
    out += ch === "\\" ? "/" : ch;
  }
  return out;
}

/**
 * Join a (possibly empty) prefix with a filename into a single object key.
 * Leading slashes are dropped (object stores have no root), a trailing slash on
 * the prefix is normalised, and path separators collapse so `polysiem/backups/`
 * + `f.gz` and `polysiem/backups` + `f.gz` both yield `polysiem/backups/f.gz`.
 */
export function joinKey(prefix: string | undefined | null, filename: string): string {
  const p = sanitizeKeySegment(prefix ?? "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const f = sanitizeKeySegment(filename).replace(/^\/+/, "");
  return p ? `${p}/${f}` : f;
}
