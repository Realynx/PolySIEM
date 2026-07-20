"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Client hook for GET /api/bandwidth — live firewall bandwidth annotations on
 * the topology maps. Fetches after the map paints and refreshes every 60s
 * unless the map supplies a live cadence; failures are silent (annotations
 * simply stay hidden). The raw payload is
 * identity-compared between refreshes so an unchanged poll doesn't churn
 * downstream memos (and, on the access map, doesn't rebuild the layout).
 */

export type BandwidthWindow = "1h" | "6h" | "24h";

export interface RuleBw {
  externalId: string;
  totalBytes: number;
  avgBps: number;
  series: { t: number; bps: number | null }[];
}

export interface InterfaceBw {
  key: string;
  name: string | null;
  totalIn: number;
  totalOut: number;
  inBps: number;
  outBps: number;
  series: { t: number; inBps: number | null; outBps: number | null }[];
}

export interface BandwidthStatus {
  enabled: boolean;
  lastPollAt: string | null;
  skipped?: { feature: string; missingPrivilege: string }[];
  errors?: string[];
}

interface BandwidthPayload {
  window: BandwidthWindow;
  rules: RuleBw[];
  interfaces: InterfaceBw[];
  status: BandwidthStatus;
}

export interface BandwidthData extends BandwidthPayload {
  /** rule externalId -> avg bits/sec over the window. */
  ruleRates: Map<string, number>;
  ruleById: Map<string, RuleBw>;
  interfaceByKey: Map<string, InterfaceBw>;
  interfaceByName: Map<string, InterfaceBw>;
}

export interface LiveBandwidthRate {
  sampledAt: string;
  inBps: number;
  outBps: number;
}

const DEFAULT_REFRESH_MS = 60_000;

export function useBandwidth(
  window: BandwidthWindow,
  enabled = true,
  refreshMs = DEFAULT_REFRESH_MS,
  integrationId?: string,
): BandwidthData | null {
  const [payload, setPayload] = useState<BandwidthPayload | null>(null);
  const lastRaw = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    lastRaw.current = null;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const query = new URLSearchParams({ window });
        if (integrationId) query.set("integrationId", integrationId);
        const res = await fetch(`/api/bandwidth?${query}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { data: BandwidthPayload };
        const raw = JSON.stringify(body.data);
        if (raw !== lastRaw.current) {
          lastRaw.current = raw;
          setPayload(body.data);
        }
      } catch {
        /* polling off / offline — annotations stay hidden */
      }
      if (!controller.signal.aborted) timer = setTimeout(load, refreshMs);
    };
    void load();

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [window, enabled, refreshMs, integrationId]);

  return useMemo(() => {
    if (!payload) return null;
    return {
      ...payload,
      ruleRates: new Map(payload.rules.map((r) => [r.externalId, r.avgBps])),
      ruleById: new Map(payload.rules.map((r) => [r.externalId, r])),
      interfaceByKey: new Map(payload.interfaces.map((i) => [i.key, i])),
      interfaceByName: new Map(
        payload.interfaces.filter((i) => i.name).map((i) => [i.name as string, i]),
      ),
    };
  }, [payload]);
}

/**
 * Read transient cumulative interface counters and calculate the rate in the
 * browser. These samples deliberately stay out of the historical database.
 */
export function useLiveBandwidthRate(
  integrationId: string | undefined,
  enabled: boolean,
  refreshMs: number,
): LiveBandwidthRate | null {
  const [rate, setRate] = useState<LiveBandwidthRate | null>(null);
  const previous = useRef<{ sampledAt: number; bytesIn: bigint; bytesOut: bigint } | null>(null);

  useEffect(() => {
    if (!enabled || !integrationId) {
      previous.current = null;
      setRate(null);
      return;
    }
    previous.current = null;
    setRate(null);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const query = new URLSearchParams({ integrationId });
        const res = await fetch(`/api/bandwidth/live?${query}`, { signal: controller.signal, cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { data: { sampledAt: string; bytesIn: string; bytesOut: string } };
        const current = {
          sampledAt: new Date(body.data.sampledAt).getTime(),
          bytesIn: BigInt(body.data.bytesIn),
          bytesOut: BigInt(body.data.bytesOut),
        };
        const prior = previous.current;
        if (prior) {
          const seconds = (current.sampledAt - prior.sampledAt) / 1000;
          const inDelta = current.bytesIn - prior.bytesIn;
          const outDelta = current.bytesOut - prior.bytesOut;
          if (seconds > 0 && inDelta >= BigInt(0) && outDelta >= BigInt(0)) {
            setRate({
              sampledAt: body.data.sampledAt,
              inBps: (Number(inDelta) * 8) / seconds,
              outBps: (Number(outDelta) * 8) / seconds,
            });
          }
        }
        previous.current = current;
      } catch {
        /* provider unavailable — retain the last good live rate */
      }
      if (!controller.signal.aborted) timer = setTimeout(load, refreshMs);
    };
    void load();

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, integrationId, refreshMs]);

  return rate;
}
