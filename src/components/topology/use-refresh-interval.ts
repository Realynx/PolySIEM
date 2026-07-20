"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export const REFRESH_STORAGE_KEY = "polysiem:labmap:refresh:v1";
export const FOOTPRINT_REFRESH_STORAGE_KEY =
  "polysiem:footprint:refresh:v1";

/**
 * Selectable poll rates for the lab map's live metrics. 1s is the floor on
 * purpose: `computeMetricsReport` coalesces to roughly one Proxmox call per
 * second, so anything faster would spend requests on cached samples.
 */
export const REFRESH_OPTIONS = [
  { ms: 1_000, label: "1s" },
  { ms: 2_000, label: "2s" },
  { ms: 5_000, label: "5s" },
  { ms: 10_000, label: "10s" },
  { ms: 30_000, label: "30s" },
  { ms: 60_000, label: "1m" },
] as const;

export const DEFAULT_REFRESH_MS = 2_000;

/**
 * Accept only a rate we actually offer. A value left by an older build — or
 * typed into devtools — falls back to the default rather than driving the
 * poll loop with something unbounded.
 */
export function parseRefreshMs(raw: string | null): number {
  const value = Number(raw);
  return REFRESH_OPTIONS.some((option) => option.ms === value)
    ? value
    : DEFAULT_REFRESH_MS;
}

// localStorage must not be read during render: the server renders the default
// rate, so a storage-seeded first client render would diverge and trip React's
// hydration check. See use-saved-positions.ts for the same constraint.
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Remember the lab map's live-metrics poll rate per browser. Returns the
 * current rate in milliseconds and a setter that persists the choice.
 */
export function useRefreshInterval(
  storageKey = REFRESH_STORAGE_KEY,
): readonly [number, (ms: number) => void] {
  const [refreshMs, setRefreshMs] = useState<number>(DEFAULT_REFRESH_MS);

  useClientLayoutEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(storageKey);
    } catch {
      // private mode — the session still polls at the default rate
    }
    setRefreshMs(parseRefreshMs(stored));
  }, [storageKey]);

  const update = useCallback((ms: number) => {
    setRefreshMs(parseRefreshMs(String(ms)));
    try {
      window.localStorage.setItem(storageKey, String(ms));
    } catch {
      // storage full / privacy mode — the choice still applies this session
    }
  }, [storageKey]);

  return [refreshMs, update] as const;
}
