import { X509Certificate, createPrivateKey } from "crypto";

/** Client-safe description of the served web certificate (no key material). */
export interface WebCertificateInfo {
  /** Subject common name (falls back to the full subject line). */
  commonName: string;
  subject: string;
  issuer: string;
  selfSigned: boolean;
  altNames: string[];
  notBefore: string;
  notAfter: string;
  fingerprint256: string;
}

const CERT_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/** All certificate PEM blocks in a string (leaf first for a server chain). */
export function splitPemCertificates(pem: string): string[] {
  return pem.match(CERT_BLOCK) ?? [];
}

function subjectLine(raw: string): string {
  // X509Certificate renders one attribute per line ("CN=x\nO=y").
  return raw.split("\n").filter(Boolean).join(", ");
}

function commonNameOf(raw: string): string | null {
  const line = raw.split("\n").find((l) => l.startsWith("CN="));
  return line ? line.slice(3) : null;
}

function parseAltNames(subjectAltName: string | undefined): string[] {
  if (!subjectAltName) return [];
  return subjectAltName
    .split(",")
    .map((entry) => entry.trim().replace(/^(DNS|IP Address|URI|email):/, ""))
    .filter(Boolean);
}

/**
 * Describe the leaf certificate of a PEM (single cert or chain).
 * Throws a plain Error with a user-presentable message on unparsable input.
 */
export function parseWebCertificate(certPem: string): WebCertificateInfo {
  const blocks = splitPemCertificates(certPem);
  if (blocks.length === 0) {
    throw new Error("No CERTIFICATE block found — expected a PEM-encoded certificate.");
  }
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(blocks[0]);
  } catch {
    throw new Error("The certificate could not be parsed — is it valid PEM?");
  }
  const subject = subjectLine(cert.subject);
  return {
    commonName: commonNameOf(cert.subject) ?? subject,
    subject,
    issuer: subjectLine(cert.issuer),
    selfSigned: cert.subject === cert.issuer,
    altNames: parseAltNames(cert.subjectAltName),
    notBefore: new Date(cert.validFrom).toISOString(),
    notAfter: new Date(cert.validTo).toISOString(),
    fingerprint256: cert.fingerprint256,
  };
}

/**
 * Validate an uploaded certificate + private key pair for serving HTTPS.
 * Returns the parsed leaf info; throws a plain Error (message is shown to the
 * admin) when the pair cannot be served.
 */
export function validateCertificatePair(certPem: string, keyPem: string): WebCertificateInfo {
  const info = parseWebCertificate(certPem);

  let keyObject;
  try {
    keyObject = createPrivateKey(keyPem);
  } catch {
    throw new Error(
      "The private key could not be parsed. It must be an unencrypted PEM key " +
        "(passphrase-protected keys are not supported).",
    );
  }

  const leaf = new X509Certificate(splitPemCertificates(certPem)[0]);
  if (!leaf.checkPrivateKey(keyObject)) {
    throw new Error("The private key does not match the certificate.");
  }

  if (new Date(info.notAfter).getTime() < Date.now()) {
    throw new Error(`The certificate expired on ${info.notAfter.slice(0, 10)}.`);
  }

  return info;
}
