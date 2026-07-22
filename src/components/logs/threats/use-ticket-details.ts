"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/components/shared/api-client";
import type { SecurityTicketDto } from "@/lib/types";

export function useTicketDetails(ticket: SecurityTicketDto | null, onUpdated: (ticket: SecurityTicketDto) => void) {
  const queryClient = useQueryClient();
  const [resolution, setResolution] = useState("");
  useEffect(() => setResolution(""), [ticket?.id]);
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch<SecurityTicketDto>(`/api/logs/tickets/${ticket!.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (updated: SecurityTicketDto) => {
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
      onUpdated(updated);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const refGroups = ticket ? [
    { label: "Source IPs", kind: "ip", values: ticket.refs?.srcIps ?? [] },
    { label: "Destination IPs", kind: "ip", values: ticket.refs?.destIps ?? [] },
    { label: "Signatures", kind: "signature", values: ticket.refs?.signatures ?? [] },
    { label: "Hosts", kind: "host", values: ticket.refs?.hosts ?? [] },
  ].filter((group) => group.values.length > 0) : [];
  const close = () => patch.mutate({ status: "CLOSED", resolution: resolution.trim() }, { onSuccess: () => toast.success("Ticket closed") });
  const reopen = () => patch.mutate({ status: "OPEN" }, { onSuccess: () => toast.success("Ticket reopened") });
  return { resolution, setResolution, patch, refGroups, close, reopen };
}

export type TicketRefGroup = ReturnType<typeof useTicketDetails>["refGroups"][number];
