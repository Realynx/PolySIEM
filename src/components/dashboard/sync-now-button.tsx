"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/components/shared/api-client";

interface RunView {
  status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";
  error: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Trigger a sync, poll the run list briefly, then refresh the page data. */
export function SyncNowButton({ integrationId, name }: { integrationId: string; name: string }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  async function run() {
    setSyncing(true);
    try {
      await apiFetch(`/api/integrations/${integrationId}/sync`, { method: "POST" });
      // Poll briefly for the run to settle.
      for (let attempt = 0; attempt < 8; attempt++) {
        await sleep(1500);
        try {
          const runs = await apiFetch<RunView[]>(`/api/integrations/${integrationId}/runs`);
          const latest = Array.isArray(runs) ? runs[0] : undefined;
          if (latest && latest.status !== "RUNNING") {
            if (latest.status === "FAILED") {
              toast.error(`Sync of ${name} failed${latest.error ? `: ${latest.error}` : ""}`);
            } else {
              toast.success(`Synced ${name}`);
            }
            break;
          }
        } catch {
          break; // runs endpoint unavailable — refresh anyway
        }
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Could not sync ${name}`);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Button variant="outline" size="sm" disabled={syncing} onClick={run}>
      <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
      {syncing ? "Syncing…" : "Sync now"}
    </Button>
  );
}
