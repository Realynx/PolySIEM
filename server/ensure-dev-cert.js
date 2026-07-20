/**
 * Dev helper for `npm run dev:https`: make sure a certificate pair exists
 * under data/certs before `next dev --experimental-https` boots (Next reads
 * the files once at startup, before the app's boot reconcile could create
 * them). Uses the same generator and file locations as production, so the
 * browser exception you grant in dev matches `next start`/standalone runs.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const tls = require("tls");
const certUtils = require("./cert-utils.js");

const certDir = certUtils.resolveCertDir(process.cwd());
const certPath = path.join(certDir, certUtils.CERT_FILENAME);
const keyPath = path.join(certDir, certUtils.KEY_FILENAME);

try {
  tls.createSecureContext({
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  });
  console.log(`[dev-https] using existing certificate in ${certDir}`);
} catch {
  const generated = certUtils.generateSelfSignedCert();
  certUtils.writeCertFiles(certDir, generated);
  console.log(
    `[dev-https] generated self-signed certificate for: ${generated.altNames.join(", ")}`,
  );
}
