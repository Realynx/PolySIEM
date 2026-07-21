"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/components/shared/api-client";
import type { ThreatIntelFeedResponse } from "@/lib/types";

/** Persist read receipts and update every cached page for this feed immediately. */
export function useThreatIntelRead(sourceId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (pulseIds: string[]) =>
      apiFetch<{ pulseIds: string[]; readAt: string }>("/api/logs/threat-intel/read", {
        method: "POST",
        body: JSON.stringify({ integrationId: sourceId, pulseIds }),
      }),
    onMutate: (pulseIds) => {
      const ids = new Set(pulseIds);
      const readAt = new Date().toISOString();
      queryClient.setQueriesData<ThreatIntelFeedResponse>(
        { queryKey: ["threat-intel", sourceId] },
        (current) => {
          if (!current) return current;
          const newlyRead = current.pulses.filter(
            (pulse) => ids.has(pulse.id) && pulse.readAt === null,
          ).length;
          if (newlyRead === 0) return current;
          return {
            ...current,
            unreadCount: Math.max(0, current.unreadCount - newlyRead),
            pulses: current.pulses.map((pulse) =>
              ids.has(pulse.id) && pulse.readAt === null ? { ...pulse, readAt } : pulse,
            ),
          };
        },
      );
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ["threat-intel", sourceId] });
    },
  });

  return {
    markRead: (pulseIds: string[]) => {
      const uniqueIds = [...new Set(pulseIds)];
      if (sourceId && uniqueIds.length > 0) mutation.mutate(uniqueIds);
    },
    isPending: mutation.isPending,
  };
}
