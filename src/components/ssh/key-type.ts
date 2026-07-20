/** Shorten a SHA256 fingerprint for table display: keeps head and tail. */
export function shortFingerprint(fingerprint: string): string {
  const body = fingerprint.replace(/^SHA256:/, "");
  if (body.length <= 20) return fingerprint;
  return `SHA256:${body.slice(0, 8)}…${body.slice(-8)}`;
}

/** Human label for an SSH key type, e.g. "ED25519" or "RSA 3072". */
export function keyTypeLabel(keyType: string, bits: number | null): string {
  if (keyType.startsWith("sk-")) return "FIDO2";
  if (keyType === "ssh-ed25519") return "ED25519";
  if (keyType === "ssh-rsa") return bits ? `RSA ${bits}` : "RSA";
  if (keyType === "ssh-dss") return "DSA";
  if (keyType.startsWith("ecdsa-")) return bits ? `ECDSA ${bits}` : "ECDSA";
  return keyType;
}
