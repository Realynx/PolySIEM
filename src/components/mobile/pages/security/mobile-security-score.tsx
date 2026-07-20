"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, EyeOff, RefreshCw, ShieldCheck, Undo2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";
import { scoreGrade, type ScoreGrade } from "@/lib/security/score";
import {
  SECURITY_CATEGORIES,
  SECURITY_SEVERITIES,
  type AffectedEntity,
  type SecurityFinding,
  type SecurityReport,
  type SecuritySeverity,
} from "@/lib/security/types";
import { ScoreRing } from "@/components/security/score-ring";
import { FindingSeverityBadge } from "@/components/security/severity-badge";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";

const GRADE_HEADLINE: Record<ScoreGrade, string> = {
  excellent: "Excellent posture",
  good: "Good posture",
  fair: "Needs attention",
  "at-risk": "At risk",
};

const SEVERITY_SECTION_TITLES: Record<SecuritySeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Informational",
};

const SEVERITY_DOT: Record<SecuritySeverity, string> = {
  critical: "bg-destructive",
  high: "bg-destructive/60",
  medium: "bg-warning",
  low: "bg-info",
  info: "bg-muted-foreground/40",
};

const CATEGORY_LABELS = new Map(SECURITY_CATEGORIES.map((c) => [c.id, c.label]));

/** Deep link for an affected entity, when PolySIEM has a page for it (mirrors the desktop FindingCard map). */
function affectedHref(entity: AffectedEntity): string | null {
  switch (entity.kind) {
    case "device":
      return entity.id ? `/inventory/hosts/${entity.id}` : "/inventory/hosts";
    case "vm":
      return entity.id ? `/inventory/vms/${entity.id}` : "/inventory/vms";
    case "container":
      return entity.id ? `/inventory/containers/${entity.id}` : "/inventory/containers";
    case "rule":
      return "/firewall/rules";
    case "port-forward":
    case "dyndns":
      return "/firewall";
    case "integration":
      return "/settings/integrations";
    case "user":
      return "/settings/users";
    case "api-token":
      return "/settings/api-tokens";
    case "ssh-key":
      return entity.id ? `/keys/${entity.id}` : "/keys";
    case "wireless":
      return "/network/wifi";
    default:
      return null;
  }
}

/** Phone security-advisor page: score hero, category subscores, findings with dismissals. */
export function MobileSecurityScore({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [showDismissed, setShowDismissed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const findingsBySeverity = useMemo(() => {
    const groups = new Map<SecuritySeverity, SecurityFinding[]>();
    for (const finding of report?.findings ?? []) {
      const list = groups.get(finding.severity) ?? [];
      list.push(finding);
      groups.set(finding.severity, list);
    }
    return groups;
  }, [report?.findings]);

  // The sheet target can live in the open or the dismissed list.
  const selected =
    report?.findings.find((f) => f.id === selectedId) ??
    report?.dismissed.find((f) => f.id === selectedId) ??
    null;
  const selectedDismissed = selected != null && (report?.dismissed.some((f) => f.id === selected.id) ?? false);

  return (
    <>
      <MobilePageHeader
        title="Security score"
        actions={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Re-evaluate"
            disabled={reportQuery.isFetching}
            onClick={() => void reportQuery.refetch()}
          >
            <RefreshCw className={cn("size-4", reportQuery.isFetching && "animate-spin")} />
          </Button>
        }
      />
      <MobilePage>
        {reportQuery.isLoading && (
          <>
            <Skeleton className="h-44 rounded-xl" />
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-40 rounded-xl" />
          </>
        )}

        {reportQuery.isError && (
          <MobileEmpty
            icon={<ShieldCheck />}
            title="Could not compute the security score"
            description={(reportQuery.error as Error)?.message}
            action={
              <Button size="sm" onClick={() => void reportQuery.refetch()}>
                Try again
              </Button>
            }
          />
        )}

        {report && grade && (
          <>
            {/* Hero: ring + grade + severity counts */}
            <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-4 py-5">
              <ScoreRing score={report.score} size={132} />
              <div className="space-y-1 text-center">
                <h2 className="text-[15px] font-semibold tracking-tight">{GRADE_HEADLINE[grade]}</h2>
                <p className="text-[11px] text-muted-foreground">
                  Evaluated {formatRelative(new Date(report.generatedAt))}
                  {report.deducted > 0 ? ` — ${report.deducted} of ${report.ceiling} deduction points` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {SECURITY_SEVERITIES.map((severity) =>
                  report.bySeverity[severity] > 0 ? (
                    <FindingSeverityBadge
                      key={severity}
                      severity={severity}
                      count={report.bySeverity[severity]}
                      className="text-[0.65rem]"
                    />
                  ) : null,
                )}
                {report.findings.length === 0 && (
                  <span className="text-xs text-muted-foreground">No open findings.</span>
                )}
              </div>
            </div>

            {/* Category subscores */}
            <MobileSection title="Categories">
              <div className="grid grid-cols-2 gap-2">
                {report.categories.map((cat) => (
                  <div key={cat.id} className="space-y-1.5 rounded-xl border bg-card px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-medium">{cat.label}</span>
                      <span
                        className={cn(
                          "text-lg leading-tight font-semibold tabular-nums",
                          cat.score >= 90 ? "text-success" : cat.score >= 60 ? "text-warning" : "text-destructive",
                        )}
                      >
                        {cat.score}
                      </span>
                    </div>
                    <Progress
                      value={cat.score}
                      className="h-1"
                      aria-label={`${cat.label} subscore ${cat.score} out of 100`}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {cat.findingCount === 0
                        ? "No findings"
                        : `${cat.findingCount} finding${cat.findingCount === 1 ? "" : "s"}`}
                    </p>
                  </div>
                ))}
              </div>
            </MobileSection>

            {/* Findings, worst first */}
            {report.findings.length === 0 ? (
              <MobileEmpty
                icon={<ShieldCheck />}
                title="All clear"
                description="No misconfigurations detected in the current inventory. New findings appear here as integrations sync."
              />
            ) : (
              SECURITY_SEVERITIES.map((severity) => {
                const group = findingsBySeverity.get(severity);
                if (!group || group.length === 0) return null;
                return (
                  <MobileSection
                    key={severity}
                    title={`${SEVERITY_SECTION_TITLES[severity]} · ${group.length}`}
                  >
                    <MobileList>
                      {group.map((finding) => (
                        <FindingRow key={finding.id} finding={finding} onSelect={() => setSelectedId(finding.id)} />
                      ))}
                    </MobileList>
                  </MobileSection>
                );
              })
            )}

            {/* Dismissed findings */}
            {report.dismissed.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  className="flex min-h-11 items-center gap-2 px-0.5 text-sm text-muted-foreground active:text-foreground"
                  onClick={() => setShowDismissed((v) => !v)}
                >
                  <EyeOff className="size-4" />
                  Dismissed findings ({report.dismissed.length})
                  <ChevronDown className={cn("size-4 transition-transform", showDismissed && "rotate-180")} />
                </button>
                {showDismissed && (
                  <MobileList className="opacity-70">
                    {report.dismissed.map((finding) => (
                      <FindingRow key={finding.id} finding={finding} onSelect={() => setSelectedId(finding.id)} />
                    ))}
                  </MobileList>
                )}
              </div>
            )}
          </>
        )}
      </MobilePage>

      <BottomSheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        title={selected?.title ?? "Finding"}
        hideHeader
      >
        {selected && (
          <div className="space-y-4 pb-2">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <FindingSeverityBadge severity={selected.severity} />
                <span className="text-xs text-muted-foreground">
                  {CATEGORY_LABELS.get(selected.category) ?? selected.category}
                </span>
              </div>
              <h3 className="text-[15px] leading-snug font-semibold">{selected.title}</h3>
            </div>

            <p className="text-sm leading-relaxed text-muted-foreground">{selected.detail}</p>

            <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <Wrench className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">How to fix: </span>
                {selected.remediation}
              </p>
            </div>

            {selected.affected.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                  Affected · {selected.affected.length}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selected.affected.map((entity, i) => (
                    <AffectedChip key={`${entity.kind}:${entity.id ?? entity.name}:${i}`} entity={entity} />
                  ))}
                </div>
              </div>
            )}

            {isAdmin && (
              <Button
                variant="outline"
                className="w-full"
                disabled={dismissMutation.isPending}
                onClick={() =>
                  dismissMutation.mutate(
                    {
                      action: selectedDismissed ? "undismiss" : "dismiss",
                      findingId: selected.id,
                    },
                    { onSuccess: () => setSelectedId(null) },
                  )
                }
              >
                {selectedDismissed ? (
                  <>
                    <Undo2 className="size-4" /> Restore finding
                  </>
                ) : (
                  <>
                    <EyeOff className="size-4" /> Dismiss finding
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </BottomSheet>
    </>
  );
}

function FindingRow({ finding, onSelect }: { finding: SecurityFinding; onSelect: () => void }) {
  return (
    <MobileListRow
      onClick={onSelect}
      leading={<span className={cn("size-2 rounded-full", SEVERITY_DOT[finding.severity])} aria-hidden />}
      title={<span className="min-w-0 truncate">{finding.title}</span>}
      subtitle={CATEGORY_LABELS.get(finding.category) ?? finding.category}
      trailing={finding.affected.length > 0 ? <span>{finding.affected.length}</span> : undefined}
    />
  );
}

function AffectedChip({ entity }: { entity: AffectedEntity }) {
  const href = affectedHref(entity);
  const chip = (
    <span className="inline-flex max-w-56 items-center rounded-md border bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
      <span className="truncate">{entity.name}</span>
    </span>
  );
  return href ? <Link href={href}>{chip}</Link> : chip;
}
