"use client";

import { useEffect, useRef, useState } from "react";
import type { ComputeMetricsPayload } from "@/lib/compute/metrics";

/** Rate used where the caller doesn't choose one (the Compute inventory strip). */
export const DEFAULT_COMPUTE_REFRESH_MS = 15_000;

/**
 * Poll lightweight Proxmox resource metrics without triggering an inventory
 * sync. `refreshMs` is the gap between a response and the next request, so a
 * slow endpoint stretches the loop instead of queueing overlapping fetches.
 * Changing it restarts the loop, which makes a new rate take effect at once.
 */
export function useComputeMetrics(
  enabled = true,
  refreshMs: number = DEFAULT_COMPUTE_REFRESH_MS,
): ComputeMetricsPayload | null {
  const [payload, setPayload] = useState<ComputeMetricsPayload | null>(null);
  const lastRaw = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const response = await fetch("/api/compute/metrics", { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { data: ComputeMetricsPayload };
        const raw = JSON.stringify(body.data);
        if (raw !== lastRaw.current) {
          lastRaw.current = raw;
          setPayload(body.data);
        }
      } catch {
        // Keep the last good sample; capacity/inventory remains available.
      }
      if (!controller.signal.aborted) timer = setTimeout(load, refreshMs);
    };
    void load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, refreshMs]);

  return payload;
}
