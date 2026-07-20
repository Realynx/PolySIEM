/**
 * Next.js instrumentation hook — starts the background sync scheduler once
 * per Node.js server process. The scheduler module is imported dynamically
 * inside the NEXT_RUNTIME check so it is dead-code-eliminated from the edge
 * bundle (it pulls in Prisma and node:crypto).
 *
 * In development it also warms up the main routes shortly after boot so the
 * first sidebar click doesn't pay the cold Turbopack compile cost.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrapPublicDemo } = await import("@/lib/demo/bootstrap");
    await bootstrapPublicDemo();

    const { isLockedDemoMode } = await import("@/lib/demo/mode");
    if (isLockedDemoMode()) {
      // The fixture set was synced once by bootstrap. Disable every background
      // writer so a public demo remains stable and deterministic while online.
      console.log("[public-demo] read-only lock active; background schedulers disabled");
      return;
    }

    const { startSyncScheduler } = await import("@/lib/integrations/scheduler");
    startSyncScheduler();
    const { startAiScanScheduler } = await import("@/lib/ai/scan/scheduler");
    startAiScanScheduler();
    const { startWorkflowScheduler } = await import("@/lib/workflows/scheduler");
    startWorkflowScheduler();
    const { startBackupScheduler } = await import("@/lib/backup/scheduler");
    startBackupScheduler();
    const { startElasticsearchDiscoveryScheduler } = await import(
      "@/lib/integrations/elasticsearch/discovery-scheduler"
    );
    startElasticsearchDiscoveryScheduler();

    // Recover background investigations left "running" by a previous process:
    // re-queue them so a mid-run restart doesn't wedge a ticket forever.
    const { requeueStragglers } = await import("@/lib/ai/agent/worker");
    void requeueStragglers().catch((err) => console.error("[investigation-worker] straggler sweep failed:", err));

    if (process.env.NODE_ENV === "development") {
      // Give the dev server a moment to finish booting before hitting it.
      setTimeout(() => {
        void warmupDevRoutes();
      }, 3_000);
    }
  }
}

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
async function warmupDevRoutes(): Promise<void> {
  try {
    const base = `http://localhost:${process.env.PORT ?? "3000"}`;
    const started = Date.now();

    const loginRes = await fetch(`${base}/api/auth/login`, {
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
