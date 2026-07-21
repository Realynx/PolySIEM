"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  Clock3,
  EyeOff,
  Gauge,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { OperationsOverview } from "@/components/shared/operations-overview";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";
import { scoreGrade, type ScoreGrade } from "@/lib/security/score";
import {
  SECURITY_SEVERITIES,
  type SecurityFinding,
  type SecurityReport,
  type SecuritySeverity,
} from "@/lib/security/types";
import { FindingCard } from "./finding-card";
import { ScoreRing } from "./score-ring";

const GRADE_HEADLINE: Record<ScoreGrade, string> = {
  excellent: "Excellent posture",
  good: "Good posture",
  fair: "Needs attention",
  "at-risk": "At risk",
};

const GRADE_TEXT: Record<ScoreGrade, string> = {
  excellent: "Your lab is in great shape. Keep the remaining suggestions on your radar.",
  good: "Solid foundation with a few things worth tightening up.",
  fair: "Several findings deserve a look — start with the highest severity.",
  "at-risk": "Serious gaps detected. Work through the critical and high findings first.",
};

const SEVERITY_SECTION_TITLES: Record<SecuritySeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Informational",
};

/** The security advisor dashboard: score gauge, category subscores, findings. */
export function SecurityPanel({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [showDismissed, setShowDismissed] = useState(false);

  const reportQuery = useQuery({
    queryKey: ["security-report"],
    queryFn: () => apiFetch<SecurityReport>("/api/security"),
  });

  const dismissMutation = useMutation({
    mutationFn: (input: { action: "dismiss" | "undismiss"; findingId: string }) =>
      apiFetch<SecurityReport>("/api/security", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (report, input) => {
      queryClient.setQueryData(["security-report"], report);
      toast.success(input.action === "dismiss" ? "Finding dismissed." : "Finding restored.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const report = reportQuery.data;
  const grade = report ? scoreGrade(report.score) : null;
  const urgentFindings = report
    ? report.bySeverity.critical + report.bySeverity.high
    : 0;

  const findingsBySeverity = useMemo(() => {
    const groups = new Map<SecuritySeverity, SecurityFinding[]>();
    for (const finding of report?.findings ?? []) {
      const list = groups.get(finding.severity) ?? [];
      list.push(finding);
      groups.set(finding.severity, list);
    }
    return groups;
  }, [report?.findings]);

  const dismiss = (findingId: string) => dismissMutation.mutate({ action: "dismiss", findingId });
  const restore = (findingId: string) => dismissMutation.mutate({ action: "undismiss", findingId });

  return (
    <>
      <PageHeader
        title="Security score"
        description="A cloud-style advisor over everything PolySIEM knows about your lab — scored, explained, and fixable."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={reportQuery.isFetching}
            onClick={() => void reportQuery.refetch()}
          >
            <RefreshCw className={cn("size-4", reportQuery.isFetching && "animate-spin")} />
            Re-evaluate
          </Button>
        }
      />

      {reportQuery.isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-56 rounded-xl" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-40 rounded-xl" />
        </div>
      )}

      {reportQuery.isError && (
        <EmptyState
          icon={ShieldCheck}
          title="Could not compute the security score"
          description={(reportQuery.error as Error)?.message}
          action={<Button onClick={() => void reportQuery.refetch()}>Try again</Button>}
        />
      )}

      {report && grade && (
        <div className="space-y-6">
          <OperationsOverview
            icon={<ShieldCheck className="size-5" aria-hidden />}
            title="Security posture"
            description={GRADE_TEXT[grade]}
            status={
              <>
                {urgentFindings > 0 ? (
                  <ShieldAlert className="size-3.5" aria-hidden />
                ) : (
                  <ShieldCheck className="size-3.5" aria-hidden />
                )}
                {GRADE_HEADLINE[grade]}
              </>
            }
            statusTone={
              grade === "at-risk"
                ? "destructive"
                : grade === "fair"
                  ? "warning"
                  : "success"
            }
            metrics={[
              {
                icon: <Gauge />,
                label: "Overall score",
                value: <ScoreRing score={report.score} size={112} />,
                detail: `${report.score} out of 100`,
                tone:
                  grade === "at-risk"
                    ? "destructive"
                    : grade === "fair"
                      ? "warning"
                      : "success",
              },
              {
                icon: <ShieldAlert />,
                label: "Open findings",
                value: report.findings.length.toLocaleString(),
                detail: urgentFindings > 0
                  ? `${urgentFindings} critical or high priority`
                  : "No critical or high findings",
                tone: urgentFindings > 0 ? "destructive" : "success",
              },
              {
                icon: <AlertTriangle />,
                label: "Deduction points",
                value: report.deducted.toLocaleString(),
                detail: `${report.ceiling.toLocaleString()} points available`,
                tone: report.deducted > 0 ? "warning" : "success",
              },
              {
                icon: <Clock3 />,
                label: "Last evaluated",
                value: formatRelative(new Date(report.generatedAt)),
                detail: `${report.categories.length} posture categories checked`,
              },
            ]}
          />

          {/* Category subscores */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {report.categories.map((cat) => (
              <Card key={cat.id} className="py-4">
                <CardContent className="space-y-2 px-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-medium">{cat.label}</h3>
                    <span
                      className={cn(
                        "text-2xl font-semibold tabular-nums",
                        cat.score >= 90 ? "text-success" : cat.score >= 60 ? "text-warning" : "text-destructive",
                      )}
                    >
                      {cat.score}
                    </span>
                  </div>
                  <Progress
                    value={cat.score}
                    className="h-1.5"
                    aria-label={`${cat.label} subscore ${cat.score} out of 100`}
                  />
                  <p className="text-xs text-muted-foreground">
                    {cat.findingCount === 0
                      ? "No findings"
                      : `${cat.findingCount} finding${cat.findingCount === 1 ? "" : "s"}`}
                    {" — "}
                    {cat.blurb}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Findings, worst first */}
          {report.findings.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="All clear"
              description="No misconfigurations detected in the current inventory. New findings appear here as integrations sync."
            />
          ) : (
            <div className="space-y-5">
              {SECURITY_SEVERITIES.map((severity) => {
                const group = findingsBySeverity.get(severity);
                if (!group || group.length === 0) return null;
                return (
                  <section key={severity} className="space-y-3">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold">{SEVERITY_SECTION_TITLES[severity]}</h2>
                      <span className="text-xs tabular-nums text-muted-foreground">{group.length}</span>
                    </div>
                    {group.map((finding) => (
                      <FindingCard
                        key={finding.id}
                        finding={finding}
                        isAdmin={isAdmin}
                        pending={dismissMutation.isPending}
                        onDismiss={dismiss}
                        onRestore={restore}
                      />
                    ))}
                  </section>
                );
              })}
            </div>
          )}

          {/* Dismissed findings */}
          {report.dismissed.length > 0 && (
            <div className="space-y-3">
              <Separator />
              <button
                type="button"
                className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setShowDismissed((v) => !v)}
              >
                <EyeOff className="size-4" />
                Dismissed findings ({report.dismissed.length})
                <ChevronDown className={cn("size-4 transition-transform", showDismissed && "rotate-180")} />
              </button>
              {showDismissed &&
                report.dismissed.map((finding) => (
                  <FindingCard
                    key={finding.id}
                    finding={finding}
                    isAdmin={isAdmin}
                    dismissed
                    pending={dismissMutation.isPending}
                    onDismiss={dismiss}
                    onRestore={restore}
                  />
                ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
