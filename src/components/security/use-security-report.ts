"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/components/shared/api-client";
import {
  type SecurityFinding,
  type SecurityReport,
  type SecuritySeverity,
} from "@/lib/security/types";

type FindingAction = "dismiss" | "undismiss";

export function useSecurityReport() {
  const queryClient = useQueryClient();
  const reportQuery = useQuery({
    queryKey: ["security-report"],
    queryFn: () => apiFetch<SecurityReport>("/api/security"),
  });
  const dismissMutation = useMutation({
    mutationFn: (input: { action: FindingAction; findingId: string }) =>
      apiFetch<SecurityReport>("/api/security", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (report, input) => {
      queryClient.setQueryData(["security-report"], report);
      toast.success(input.action === "dismiss" ? "Finding dismissed." : "Finding restored.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const findingsBySeverity = useMemo(() => {
    const groups = new Map<SecuritySeverity, SecurityFinding[]>();
    for (const finding of reportQuery.data?.findings ?? []) {
      const findings = groups.get(finding.severity) ?? [];
      findings.push(finding);
      groups.set(finding.severity, findings);
    }
    return groups;
  }, [reportQuery.data?.findings]);

  return { reportQuery, dismissMutation, findingsBySeverity };
}
