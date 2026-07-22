"use client";

import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/components/shared/api-client";
import type { IocMatchReport, ThreatIntelFeedResponse, ThreatIntelPulseView } from "@/lib/types";
import { useThreatIntelRead } from "./use-threat-intel-read";

export const THREAT_INTEL_PAGE_SIZE = 20;
export interface ThreatIntelSource { id: string; name: string }

export function useThreatIntelDashboard(sources: ThreatIntelSource[]) {
  const queryClient = useQueryClient();
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [page, setPage] = useState(1);
  const [hours, setHours] = useState(24);
  const [selected, setSelected] = useState<ThreatIntelPulseView | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const readState = useThreatIntelRead(sourceId);
  const feedQuery = useQuery({
    queryKey: ["threat-intel", sourceId, page],
    queryFn: () => apiFetch<ThreatIntelFeedResponse>(`/api/logs/threat-intel?integrationId=${encodeURIComponent(sourceId)}&page=${page}&limit=${THREAT_INTEL_PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
  const matchesQuery = useQuery({
    queryKey: ["threat-intel-matches", sourceId, hours],
    queryFn: () => apiFetch<IocMatchReport>(`/api/logs/threat-intel/matches?integrationId=${encodeURIComponent(sourceId)}&hours=${hours}`),
    placeholderData: keepPreviousData,
  });
  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["threat-intel"] });
    void queryClient.invalidateQueries({ queryKey: ["threat-intel-matches"] });
  };
  const feed = feedQuery.data;
  return {
    sourceId, setSourceId, page, setPage, hours, setHours, selected, setSelected,
    exportOpen, setExportOpen, readState, feedQuery, matchesQuery, refreshAll, feed,
    matches: matchesQuery.data?.matches ?? [],
    totalPages: Math.max(1, Math.ceil((feed?.cachedCount ?? 0) / THREAT_INTEL_PAGE_SIZE)),
  };
}
