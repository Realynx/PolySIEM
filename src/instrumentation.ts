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

    // Sync the stored web certificate with the files the TLS entrypoint
    // serves (restores it after container/bundle replacement, or imports the
    // first-boot self-signed one). Best-effort; HTTPS serves regardless.
    const { reconcileWebCertificate } = await import("@/lib/tls/store");
    void reconcileWebCertificate();

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
      // Warmup lives in its own module (it imports undici, which the edge
      // instrumentation bundle must never see). Give the dev server a moment
      // to finish booting before hitting it.
      const { warmupDevRoutes } = await import("@/lib/dev-warmup");
      setTimeout(() => {
        void warmupDevRoutes();
      }, 3_000);
    }
  }
}

