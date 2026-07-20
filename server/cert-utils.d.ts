/** Typings for the plain-CJS cert generator shared with server/tls-server.js. */

export const CERT_FILENAME: string;
export const KEY_FILENAME: string;

export function resolveCertDir(baseDir: string): string;

export function defaultAltNames(): string[];

export interface GeneratedCert {
  certPem: string;
  keyPem: string;
  altNames: string[];
}

export function generateSelfSignedCert(opts?: {
  commonName?: string;
  altNames?: string[];
  days?: number;
}): GeneratedCert;

export function writeCertFiles(
  certDir: string,
  pair: { certPem: string; keyPem: string },
): void;
