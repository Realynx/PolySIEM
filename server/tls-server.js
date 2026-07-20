/**
 * PolySIEM HTTPS entrypoint for the Next.js standalone bundle.
 *
 * Replaces `node server.js` in production. On one port it:
 *   - serves the app over HTTPS (self-signed certificate generated on first
 *     boot; replaceable from Settings → Web certificate),
 *   - answers plain-HTTP requests with a redirect to HTTPS, by peeking at the
 *     first byte of each connection (0x16 = TLS handshake),
 *   - hot-swaps the certificate when the files under the cert directory
 *     change (the settings UI writes them), with no restart.
 *
 * Next.js refuses HTTPS in production `startServer` (error E128), so this uses
 * the same `getRequestHandlers` initializer the generated server.js uses under
 * the hood and attaches the handlers to our own https.Server. The standalone
 * config comes from .next/required-server-files.json — the identical object
 * `next build` bakes into the generated server.js.
 *
 * Environment:
 *   PORT / HOSTNAME        as before (default 3000 / 0.0.0.0)
 *   POLYSIEM_TLS=off       serve plain HTTP via the stock server.js instead
 *                          (for reverse-proxy setups that terminate TLS)
 *   POLYSIEM_CERT_DIR      certificate directory (default: <bundle>/data/certs)
 *   KEEP_ALIVE_TIMEOUT     as before
 */
"use strict";

if (/^(0|off|false|no)$/i.test(process.env.POLYSIEM_TLS || "")) {
  console.log("[polysiem-tls] POLYSIEM_TLS is off — serving plain HTTP");
  require("./server.js");
  return;
}

const fs = require("fs");
const http = require("http");
const https = require("https");
const net = require("net");
const path = require("path");
const tls = require("tls");

const certUtils = require("./cert-utils.js");

const dir = __dirname;
process.env.NODE_ENV = "production";
process.chdir(__dirname);

const port = parseInt(process.env.PORT, 10) || 3000;
const hostname = process.env.HOSTNAME || "0.0.0.0";

let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10);
if (
  Number.isNaN(keepAliveTimeout) ||
  !Number.isFinite(keepAliveTimeout) ||
  keepAliveTimeout < 0
) {
  keepAliveTimeout = undefined;
}

const { config: nextConfig } = require("./.next/required-server-files.json");
nextConfig.distDir = "./.next";
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);

require("next");
const { getRequestHandlers } = require("next/dist/server/lib/start-server");

/* ----------------------------- certificate ------------------------------- */

const certDir = certUtils.resolveCertDir(dir);
const certPath = path.join(certDir, certUtils.CERT_FILENAME);
const keyPath = path.join(certDir, certUtils.KEY_FILENAME);

function readCertPair() {
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

function ensureUsableCert() {
  try {
    // Throws when either file is missing, unparsable, or a mismatched pair.
    tls.createSecureContext(readCertPair());
    return;
  } catch (err) {
    if (fs.existsSync(certPath) || fs.existsSync(keyPath)) {
      console.error(
        `[polysiem-tls] existing certificate in ${certDir} is unusable (${err.message}) — ` +
          "falling back to a fresh self-signed certificate (old files kept as *.bad)",
      );
      for (const p of [certPath, keyPath]) {
        try {
          fs.renameSync(p, `${p}.bad`);
        } catch {
          /* missing file */
        }
      }
    }
    const generated = certUtils.generateSelfSignedCert();
    certUtils.writeCertFiles(certDir, generated);
    console.log(
      `[polysiem-tls] generated self-signed certificate for: ${generated.altNames.join(", ")}`,
    );
  }
}

ensureUsableCert();

/* ------------------------- request handler shims -------------------------- */
// Same deferred-handler pattern as next/dist/server/lib/start-server: accept
// connections immediately, park requests until Next.js finishes initializing.

let handlersReady = () => {};
let handlersError = () => {};
let handlersPromise = new Promise((resolve, reject) => {
  handlersReady = resolve;
  handlersError = reject;
});
let requestHandler = async (req, res) => {
  if (handlersPromise) {
    await handlersPromise;
    return requestHandler(req, res);
  }
  throw new Error("Invariant: request handler was not set up");
};
let upgradeHandler = async (req, socket, head) => {
  if (handlersPromise) {
    await handlersPromise;
    return upgradeHandler(req, socket, head);
  }
  throw new Error("Invariant: upgrade handler was not set up");
};

async function requestListener(req, res) {
  try {
    if (handlersPromise) {
      await handlersPromise;
      handlersPromise = undefined;
    }
    await requestHandler(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.end("Internal Server Error");
    console.error(`[polysiem-tls] failed to handle request for ${req.url}`);
    console.error(err);
  }
}

const httpsServer = https.createServer(readCertPair(), requestListener);
if (keepAliveTimeout) httpsServer.keepAliveTimeout = keepAliveTimeout;
httpsServer.on("upgrade", async (req, socket, head) => {
  try {
    await upgradeHandler(req, socket, head);
  } catch (err) {
    socket.destroy();
    console.error(`[polysiem-tls] failed to handle upgrade for ${req.url}`);
    console.error(err);
  }
});

// Endpoints that keep answering over plain HTTP instead of redirecting:
// updaters installed by OLDER releases (update.sh/update.ps1/auto-update.sh)
// and container healthchecks probe these via http:// and must keep seeing the
// app's REAL status — a redirect would read as "healthy" (or as a certificate
// error) even when the app is down, breaking their rollback logic.
const HTTP_PASSTHROUGH_PATHS = new Set(["/api/health", "/api/internal/auto-update"]);

// Plain-HTTP connections: serve health/updater endpoints and reverse-proxied
// traffic directly, redirect everything else so http:// bookmarks keep working.
const redirectServer = http.createServer((req, res) => {
  const pathname = (req.url || "/").split("?")[0];
  // x-forwarded-proto means a reverse proxy (which already terminated TLS or
  // deliberately chose HTTP) is in front — redirecting would loop it.
  if (HTTP_PASSTHROUGH_PATHS.has(pathname) || req.headers["x-forwarded-proto"]) {
    void requestListener(req, res);
    return;
  }
  const host = (req.headers.host || "localhost").replace(/:\d+$/, "");
  const location = `https://${host}${port === 443 ? "" : `:${port}`}${req.url}`;
  res.statusCode = 308;
  res.setHeader("Location", location);
  res.setHeader("Connection", "close");
  res.end(`Redirecting to ${location}\n`);
});

/* -------------- single-port front: TLS or HTTP by first byte -------------- */

const frontend = net.createServer((socket) => {
  socket.on("error", () => {
    // Pre-handoff connection resets are routine; never crash on them.
  });
  // Drop connections that never send a byte.
  socket.setTimeout(30_000, () => socket.destroy());
  socket.once("data", (firstByte) => {
    socket.setTimeout(0);
    socket.pause();
    socket.unshift(firstByte);
    const target = firstByte[0] === 0x16 ? httpsServer : redirectServer;
    target.emit("connection", socket);
    process.nextTick(() => socket.resume());
  });
});

frontend.on("error", (err) => {
  console.error("[polysiem-tls] failed to start server");
  console.error(err);
  process.exit(1);
});

/* ----------------------- certificate hot reloading ------------------------ */

let reloadTimer = null;
function scheduleCertReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    try {
      httpsServer.setSecureContext(readCertPair());
      console.log(`[polysiem-tls] reloaded web certificate from ${certDir}`);
    } catch (err) {
      console.error(
        `[polysiem-tls] certificate reload failed — keeping the previous certificate: ${err.message}`,
      );
    }
  }, 500);
}
for (const p of [certPath, keyPath]) {
  fs.watchFile(p, { interval: 2000 }, scheduleCertReload);
}

/* --------------------------------- boot ----------------------------------- */

let cleanupStarted = false;
function cleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  frontend.close(() => {
    process.exit(0);
  });
  httpsServer.close();
  redirectServer.close();
  // Match the stock server's behavior of not waiting on long-lived requests.
  setTimeout(() => process.exit(0), 5000).unref();
}
if (!process.env.NEXT_MANUAL_SIG_HANDLE) {
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

frontend.listen(port, hostname, async () => {
  const displayHost = !hostname || hostname === "0.0.0.0" ? "localhost" : hostname;
  const appUrl = `https://${displayHost}:${port}`;
  process.env.PORT = String(port);
  process.env.__NEXT_PRIVATE_ORIGIN = appUrl;

  console.log(`[polysiem-tls] serving HTTPS on ${appUrl} (certificates: ${certDir})`);
  try {
    const initResult = await getRequestHandlers({
      dir,
      port,
      isDev: false,
      server: httpsServer,
      hostname,
      keepAliveTimeout,
      experimentalHttpsServer: true,
      quiet: false,
    });
    requestHandler = initResult.requestHandler;
    upgradeHandler = initResult.upgradeHandler;
    handlersReady();
    console.log("[polysiem-tls] ready");
  } catch (err) {
    handlersError();
    console.error(err);
    process.exit(1);
  }
});
