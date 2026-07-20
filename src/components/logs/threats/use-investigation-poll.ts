"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/components/shared/api-client";
import type {
  InvestigationProgress,
  InvestigationReport,
  InvestigationStatus,
} from "@/lib/ai/agent/contract";
import type { SecurityTicketDto } from "@/lib/types";
import { isInvestigationActive } from "./investigation-state";

/** How often to poll a live (queued/running) investigation. */
export const INVESTIGATION_POLL_MS = 2000;

/** The persisted background-investigation state the panel renders. */
export interface InvestigationState {
  status: InvestigationStatus | null;
  progress: InvestigationProgress | null;
  report: InvestigationReport | null;
  investigatedAt: string | null;
}

/** Seed the poll state from a ticket DTO (its persisted background fields). */
function ticketState(ticket: SecurityTicketDto): InvestigationState {
  return {
    status: ticket.investigationStatus,
    progress: ticket.investigationProgress,
    report: ticket.investigation,
    investigatedAt: ticket.investigatedAt,
  };
}

export interface UseInvestigationPoll {
  /** The current (seeded, then polled) investigation state. */
  state: InvestigationState;
  /** True while the enqueue POST is in flight. */
  isEnqueuing: boolean;
  /** Enqueue failed (e.g. not admin, or the route isn't live yet). */
  enqueueError: string | null;
  /** The status poll is failing (endpoint unreachable) — surface subtly. */
  pollError: boolean;
  /** Enqueue (or re-enqueue) a background investigation and start polling. */
  investigate: () => void;
}

/**
 * Drives a ticket's BACKGROUND investigation as a poll-and-render view.
 *
 * - Seeds from the ticket's persisted `investigationStatus`/`Progress`/report,
 *   so reopening the panel mid-run resumes without a flash.
 * - Polls `GET /api/ai/investigate?ticketId=` every {@link INVESTIGATION_POLL_MS}
 *   while queued/running, and stops the instant it's terminal — or if the route
 *   is unreachable (never hammers an endpoint that isn't deployed yet).
 * - `investigate()` POSTs to enqueue (idempotent server-side), flips the UI to
 *   "queued" optimistically, then hands off to polling.
 * - Fires `onInvestigated` + refreshes the ticket list once, on the success edge.
 */
export function useInvestigationPoll(
  ticket: SecurityTicketDto,
  onInvestigated?: (report: InvestigationReport) => void,
): UseInvestigationPoll {
  const queryClient = useQueryClient();
  const ticketId = ticket.id;
  const seeded = ticketState(ticket);

  // "Engaged" once we're actively tracking a run: either the ticket was already
  // queued/running when the panel mounted (resume on reopen), or the user just
  // kicked one off. Gates the query so idle tickets never touch the network.
  const [engaged, setEngaged] = useState(() => isInvestigationActive(ticket.investigationStatus));

  // A different ticket re-seeds tracking from that ticket's persisted state.
  useEffect(() => {
    setEngaged(isInvestigationActive(ticket.investigationStatus));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  const query = useQuery({
    queryKey: ["investigation", ticketId],
    queryFn: () =>
      apiFetch<InvestigationState>(`/api/ai/investigate?ticketId=${encodeURIComponent(ticketId)}`),
    enabled: engaged,
    initialData: seeded,
    // Poll while queued/running; stop when terminal, or when the endpoint is
    // unreachable so we don't hammer a route that isn't live yet.
    refetchInterval: (q) => {
      if (q.state.status === "error") return false;
      return isInvestigationActive(q.state.data?.status) ? INVESTIGATION_POLL_MS : false;
    },
    refetchOnWindowFocus: false,
  });

  // Prefer polled data once engaged; otherwise mirror the live ticket prop
  // (which the background list poll keeps fresh) so idle/terminal state stays
  // in sync without a second request.
  const state = engaged ? query.data ?? seeded : seeded;

  // Fire the completion callback + refresh the list once, on the success edge.
  const prevStatus = useRef<InvestigationStatus | null>(state.status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = state.status;
    if (prev !== "success" && state.status === "success" && state.report) {
      toast.success("Investigation complete");
      onInvestigated?.(state.report);
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const enqueue = useMutation({
    mutationFn: () =>
      apiFetch<{ status: InvestigationStatus }>("/api/ai/investigate", {
        method: "POST",
        body: JSON.stringify({ ticketId }),
      }),
    onSuccess: ({ status }) => {
      // Reflect the enqueue immediately, then let polling take over.
      queryClient.setQueryData<InvestigationState>(["investigation", ticketId], (prev) => ({
        status,
        progress: prev?.progress ?? null,
        report: null,
        investigatedAt: null,
      }));
      setEngaged(true);
      void query.refetch();
    },
  });

  return {
    state,
    isEnqueuing: enqueue.isPending,
    enqueueError: enqueue.isError ? enqueue.error.message : null,
    pollError: engaged && query.isError,
    investigate: () => enqueue.mutate(),
  };
}
