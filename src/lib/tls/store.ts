import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { SETTING_KEYS, getSetting, setSetting } from "@/lib/settings";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  CERT_FILENAME,
  KEY_FILENAME,
  defaultAltNames,
  generateSelfSignedCert,
  resolveCertDir,
  writeCertFiles,
} from "../../../server/cert-utils";
import { parseWebCertificate, type WebCertificateInfo } from "./inspect";

export type WebCertificateSource = "self-signed" | "uploaded";

/**
 * The stored web certificate (AppSetting `web_certificate`). The database is
 * the source of truth; the PEM files under the cert directory are a
 * materialized copy that the TLS entrypoint (server/tls-server.js) watches and
 * hot-swaps without a restart. `reconcileWebCertificate` keeps the two in sync
 * at boot, so certificates survive container/bundle replacement via the DB.
 */
export interface WebCertificateSetting {
  source: WebCertificateSource;
  certPem: string;
  /** encryptSecret ciphertext — never serialized to clients. */
  keyPemEncrypted: string;
  updatedAt: string;
}

/** Client-safe view for the settings page. */
export interface WebCertificateView {
  source: WebCertificateSource | null;
  updatedAt: string | null;
  info: WebCertificateInfo | null;
  /** Hostnames/IPs of this machine, prefilled in the generate form. */
  suggestedAltNames: string[];
}

function certDir(): string {
  return resolveCertDir(process.cwd());
}

async function readFileOrNull(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

export async function getStoredWebCertificate(): Promise<WebCertificateSetting | null> {
  return getSetting<WebCertificateSetting | null>(SETTING_KEYS.webCertificate, null);
}

export async function getWebCertificateView(): Promise<WebCertificateView> {
  const stored = await getStoredWebCertificate();
  let certPem = stored?.certPem ?? null;
  // Before the first reconcile (or in dev) the DB may be empty while the TLS
  // entrypoint already generated files — show those instead of nothing.
  if (!certPem) certPem = await readFileOrNull(path.join(certDir(), CERT_FILENAME));

  let info: WebCertificateInfo | null = null;
  if (certPem) {
    try {
      info = parseWebCertificate(certPem);
    } catch {
      info = null;
    }
  }
  return {
    source: stored?.source ?? (info ? "self-signed" : null),
    updatedAt: stored?.updatedAt ?? null,
    info,
    suggestedAltNames: info?.altNames?.length ? info.altNames : defaultAltNames(),
  };
}

/**
 * Persist a certificate pair and materialize it for the running TLS server.
 * Returns whether the files were written (false = DB-only; the certificate
 * still applies on the next boot via reconcile).
 */
export async function saveWebCertificate(
  source: WebCertificateSource,
  certPem: string,
  keyPem: string,
): Promise<{ applied: boolean }> {
  const record: WebCertificateSetting = {
    source,
    certPem,
    keyPemEncrypted: encryptSecret(keyPem),
    updatedAt: new Date().toISOString(),
  };
  await setSetting(SETTING_KEYS.webCertificate, record);
  try {
    writeCertFiles(certDir(), { certPem, keyPem });
    return { applied: true };
  } catch (err) {
    console.error(
      `[web-certificate] could not write certificate files to ${certDir()} — ` +
        `the certificate is saved and applies on the next restart:`,
      err,
    );
    return { applied: false };
  }
}

/** Generate and persist a fresh self-signed certificate. */
export async function generateWebCertificate(opts: {
  commonName?: string;
  altNames?: string[];
  days?: number;
}): Promise<{ applied: boolean; altNames: string[] }> {
  const generated = generateSelfSignedCert(opts);
  const { applied } = await saveWebCertificate("self-signed", generated.certPem, generated.keyPem);
  return { applied, altNames: generated.altNames };
}

/**
 * Boot-time sync between the stored certificate and the on-disk files.
 * - DB has a certificate → ensure the files match it (bundle replacement or a
 *   fresh container regenerates throwaway files; the stored cert wins).
 * - DB is empty but files exist → import the entrypoint's first-boot
 *   self-signed certificate so it survives redeploys.
 * Never throws: HTTPS keeps serving whatever is on disk if this fails.
 */
export async function reconcileWebCertificate(): Promise<void> {
  try {
    const dir = certDir();
    const certFile = path.join(dir, CERT_FILENAME);
    const keyFile = path.join(dir, KEY_FILENAME);
    const stored = await getStoredWebCertificate();

    if (stored) {
      let keyPem: string;
      try {
        keyPem = decryptSecret(stored.keyPemEncrypted);
      } catch {
        console.error(
          "[web-certificate] stored private key cannot be decrypted (APP_SECRET changed?) — " +
            "keeping the certificate currently on disk",
        );
        return;
      }
      const diskCert = await readFileOrNull(certFile);
      const diskKey = await readFileOrNull(keyFile);
      if (diskCert !== stored.certPem || diskKey !== keyPem) {
        writeCertFiles(dir, { certPem: stored.certPem, keyPem });
        console.log(`[web-certificate] restored stored certificate to ${dir}`);
      }
      return;
    }

    const diskCert = await readFileOrNull(certFile);
    const diskKey = await readFileOrNull(keyFile);
    if (diskCert && diskKey) {
      await setSetting(SETTING_KEYS.webCertificate, {
        source: "self-signed",
        certPem: diskCert,
        keyPemEncrypted: encryptSecret(diskKey),
        updatedAt: new Date().toISOString(),
      } satisfies WebCertificateSetting);
      console.log("[web-certificate] imported the first-boot self-signed certificate");
    }
  } catch (err) {
    console.error("[web-certificate] reconcile failed:", err);
  }
}
