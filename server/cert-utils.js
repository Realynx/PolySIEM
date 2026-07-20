/**
 * Self-signed web-certificate generation and cert-file conventions, shared by
 * the standalone TLS entrypoint (server/tls-server.js) and the app
 * (src/lib/tls). Plain CommonJS on purpose: tls-server.js runs straight from
 * `node` inside the standalone bundle, before any Next.js code is loaded.
 *
 * node-forge is listed in `serverExternalPackages` (next.config.ts) so the
 * standalone output ships it as a real package in node_modules — tls-server.js
 * requires it outside the compiled app bundle.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const forge = require("node-forge");

/** File names inside the certificate directory. */
const CERT_FILENAME = "tls.crt";
const KEY_FILENAME = "tls.key";

/**
 * Directory holding the served certificate pair. POLYSIEM_CERT_DIR overrides;
 * the default lives under the runtime directory so the standalone bundle and
 * the app (which chdir/cwd there) agree on the location.
 */
function resolveCertDir(baseDir) {
  return process.env.POLYSIEM_CERT_DIR || path.join(baseDir, "data", "certs");
}

/** Hostnames + addresses this machine is reachable as, for default SANs. */
function defaultAltNames() {
  const names = new Set(["localhost", "127.0.0.1"]);
  const host = os.hostname();
  if (host) names.add(host.toLowerCase());
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (!addr.internal && addr.family === "IPv4") names.add(addr.address);
    }
  }
  return [...names];
}

/**
 * Generate a self-signed HTTPS server certificate.
 *
 * The RSA key comes from node:crypto (native, fast); node-forge only builds
 * and signs the X.509 structure, which pure-JS handles in milliseconds.
 *
 * @param {{ commonName?: string, altNames?: string[], days?: number }} [opts]
 * @returns {{ certPem: string, keyPem: string, altNames: string[] }}
 */
function generateSelfSignedCert(opts) {
  const options = opts || {};
  const altNames =
    options.altNames && options.altNames.length > 0
      ? [...new Set(options.altNames.map((n) => n.trim()).filter(Boolean))]
      : defaultAltNames();
  const commonName =
    options.commonName || altNames.find((n) => !net.isIP(n)) || "polysiem";
  const days = options.days && options.days > 0 ? options.days : 3650;

  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

  const forgeKey = forge.pki.privateKeyFromPem(keyPem);
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(forgeKey.n, forgeKey.e);
  // Leading 0x01 keeps the DER integer positive.
  cert.serialNumber = "01" + crypto.randomBytes(15).toString("hex");
  // Backdate a day so a skewed client clock doesn't reject a fresh cert.
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const attrs = [
    { name: "commonName", value: commonName },
    { name: "organizationName", value: "PolySIEM self-signed" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
    {
      name: "subjectAltName",
      altNames: altNames.map((value) =>
        net.isIP(value) ? { type: 7, ip: value } : { type: 2, value },
      ),
    },
  ]);
  cert.sign(forgeKey, forge.md.sha256.create());

  return { certPem: forge.pki.certificateToPem(cert), keyPem, altNames };
}

/**
 * Write a certificate pair into `certDir` (created if needed). The key is
 * written first and with owner-only permissions, so a concurrent reader never
 * sees a new cert next to the old key.
 */
function writeCertFiles(certDir, pair) {
  fs.mkdirSync(certDir, { recursive: true });
  fs.writeFileSync(path.join(certDir, KEY_FILENAME), pair.keyPem, { mode: 0o600 });
  fs.writeFileSync(path.join(certDir, CERT_FILENAME), pair.certPem, { mode: 0o644 });
}

module.exports = {
  CERT_FILENAME,
  KEY_FILENAME,
  resolveCertDir,
  defaultAltNames,
  generateSelfSignedCert,
  writeCertFiles,
};
