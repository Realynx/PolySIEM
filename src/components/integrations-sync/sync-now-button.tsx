"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RunView {
  status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";
  error: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toastRun(run: RunView, name: string): void {
  if (run.status === "FAILED") toast.error(`Sync of ${name} failed${run.error ? `: ${run.error}` : ""}`);
  else if (run.status === "PARTIAL") toast.warning(`Synced ${name} with warnings`);
  else toast.success(`Synced ${name}`);
}

async function waitForRun(integrationId: string): Promise<RunView | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(1500);
    try {
      const response = await fetch(`/api/integrations/${integrationId}/runs`);
      const body = await response.json().catch(() => null);
      const latest: RunView | undefined = body?.data?.[0];
      if (latest && latest.status !== "RUNNING") return latest;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Admin action: trigger a manual sync, poll the run until it settles, and toast
 * the real outcome. A 200 from the sync endpoint only means the run started —
 * it can still finish FAILED — so success must be read from the run status.
 */
export function SyncNowButton({ integrationId, name }: { integrationId: string; name: string }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  async function run() {
    setSyncing(true);
    try {
      const res = await fetch(`/api/integrations/${integrationId}/sync`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? `Sync failed (HTTP ${res.status})`);

      const latest = await waitForRun(integrationId);
      if (latest) toastRun(latest, name);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Could not sync ${name}`);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={syncing}>
      <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
      {syncing ? "Syncing…" : "Sync now"}
    </Button>
  );
}
