/**
 * Dev-only route warmup. Lives outside instrumentation.ts so the edge bundle
 * of the instrumentation hook never sees the undici import below — webpack
 * cannot bundle undici's node:-scheme internals for the edge runtime. Only
 * the NEXT_RUNTIME === "nodejs" branch dynamically imports this module, and
 * that branch is dead-code-eliminated from the edge build.
 */

/**
 * Main app routes to pre-compile in dev. Hardcoded on purpose — nav.ts pulls
 * in lucide-react and must stay out of the instrumentation bundle.
 */
const WARMUP_ROUTES = [
  "/",
  "/inventory/hosts",
  "/inventory/vms",
  "/inventory/containers",
  "/inventory/services",
  "/inventory/storage",
  "/inventory/map",
  "/network",
  "/network/access-map",
  "/network/switches",
  "/network/wifi",
  "/network/ips",
  "/network/dhcp",
  "/workflows",
  "/workflows/runs",
  "/security",
  "/firewall",
  "/firewall/rules",
  "/firewall/aliases",
  "/keys",
  "/logs",
  "/logs/insights",
  "/logs/threats",
  "/credentials",
  "/docs",
  "/tags",
  "/settings/integrations",
  "/settings/backup",
] as const;

/**
 * Dev-only: log in with the dev seed credentials and request each main route
 * once so Turbopack compiles them ahead of the first real click. Fails
 * silently (e.g. when the database isn't the dev seed).
 */
export async function warmupDevRoutes(): Promise<void> {
  try {
    // `npm run dev:https` serves TLS with a self-signed cert; Next marks that
    // mode with __NEXT_EXPERIMENTAL_HTTPS. Match the protocol and skip cert
    // verification for these loopback-only requests via an undici dispatcher.
    const https = process.env.__NEXT_EXPERIMENTAL_HTTPS === "1";
    const base = `${https ? "https" : "http"}://localhost:${process.env.PORT ?? "3000"}`;
    const extra: RequestInit = https
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ dispatcher: new (await import("undici")).Agent({ connect: { rejectUnauthorized: false } }) } as any)
      : {};
    const started = Date.now();

    const loginRes = await fetch(`${base}/api/auth/login`, {
      ...extra,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    if (!loginRes.ok) return;

    const setCookies =
      typeof loginRes.headers.getSetCookie === "function"
        ? loginRes.headers.getSetCookie()
        : [loginRes.headers.get("set-cookie") ?? ""];
    const cookie = setCookies
      .filter(Boolean)
      .map((c) => c.split(";")[0])
      .join("; ");
    if (!cookie) return;

    let compiled = 0;
    for (const route of WARMUP_ROUTES) {
      try {
        await fetch(`${base}${route}`, {
          ...extra,
          headers: { cookie },
          redirect: "manual",
        });
        compiled++;
      } catch {
        // Ignore individual route failures — keep warming the rest.
      }
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[dev-warmup] compiled ${compiled} routes in ${seconds}s`);
  } catch {
    // Silent by design — warmup is best-effort and dev-only.
  }
}
