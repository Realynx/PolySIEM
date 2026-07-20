/**
 * Lightweight client-side preview parse for pasted authorized_keys text.
 * Format hints only — the server does the authoritative parse (wire-format
 * validation, fingerprints) in src/lib/ssh/keys.ts, which needs node:crypto.
 */

const KEY_TYPES = new Set([
  "ssh-ed25519",
  "ssh-rsa",
  "ssh-dss",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "sk-ssh-ed25519@openssh.com",
  "sk-ecdsa-sha2-nistp256@openssh.com",
]);

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export type PreviewLine =
  | { ok: true; lineNumber: number; keyType: string; comment: string | null }
  | { ok: false; lineNumber: number; isPrivateKey: boolean; error: string };

export function previewAuthorizedKeys(text: string): PreviewLine[] {
  const results: PreviewLine[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const lineNumber = i + 1;
    if (line.toUpperCase().includes("PRIVATE KEY")) {
      results.push({
        ok: false,
        lineNumber,
        isPrivateKey: true,
        error: "This is a PRIVATE key — never paste private keys anywhere.",
      });
      continue;
    }
    const tokens = line.split(/\s+/);
    const typeIndex = tokens.findIndex((t) => KEY_TYPES.has(t));
    const blob = typeIndex === -1 ? undefined : tokens[typeIndex + 1];
    if (typeIndex === -1) {
      results.push({ ok: false, lineNumber, isPrivateKey: false, error: "No recognized key type on this line" });
    } else if (!blob || !BASE64_RE.test(blob) || blob.length < 16) {
      results.push({ ok: false, lineNumber, isPrivateKey: false, error: "Key data is not valid base64" });
    } else {
      results.push({
        ok: true,
        lineNumber,
        keyType: tokens[typeIndex],
        comment: tokens.slice(typeIndex + 2).join(" ") || null,
      });
    }
  }
  return results;
}
