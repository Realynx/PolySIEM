"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, EyeOff, RefreshCw, ShieldCheck, Undo2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { affectedHref } from "@/components/security/finding-card";
import { useSecurityReport } from "@/components/security/use-security-report";

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

function categoryScoreTone(score: number): string {
  if (score >= 90) return "text-success";
  if (score >= 60) return "text-warning";
  return "text-destructive";
}

function findingCountLabel(count: number): string {
  if (count === 0) return "No findings";
  return `${count} finding${count === 1 ? "" : "s"}`;
}

function deductionLabel(deducted: number, ceiling: number): string {
  if (deducted === 0) return "";
  return ` — ${deducted} of ${ceiling} deduction points`;
}

function selectedFinding(report: SecurityReport | undefined, id: string | null): SecurityFinding | null {
  if (!id || !report) return null;
  return report.findings.find((finding) => finding.id === id)
    ?? report.dismissed.find((finding) => finding.id === id)
    ?? null;
}

function isDismissed(report: SecurityReport | undefined, finding: SecurityFinding | null): boolean {
  if (!report || !finding) return false;
  return report.dismissed.some((candidate) => candidate.id === finding.id);
}

function SeverityBadges({ report }: { report: SecurityReport }) {
  const badges = SECURITY_SEVERITIES.flatMap((severity) => {
    const count = report.bySeverity[severity];
    return count > 0
      ? [<FindingSeverityBadge key={severity} severity={severity} count={count} className="text-[0.65rem]" />]
      : [];
  });
  if (badges.length > 0) return badges;
  return <span className="text-xs text-muted-foreground">No open findings.</span>;
}

function SelectedFindingContent({
  finding,
  dismissed,
  isAdmin,
  pending,
  onToggle,
}: {
  finding: SecurityFinding;
  dismissed: boolean;
  isAdmin: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="space-y-4 pb-2">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <FindingSeverityBadge severity={finding.severity} />
          <span className="text-xs text-muted-foreground">{CATEGORY_LABELS.get(finding.category) ?? finding.category}</span>
        </div>
        <h3 className="text-[15px] leading-snug font-semibold">{finding.title}</h3>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{finding.detail}</p>
      <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
        <Wrench className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-muted-foreground"><span className="font-medium text-foreground">How to fix: </span>{finding.remediation}</p>
      </div>
      {finding.affected.length > 0 && (
        <div className="space-y-1.5">
          <p className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Affected · {finding.affected.length}</p>
          <div className="flex flex-wrap gap-1.5">
            {finding.affected.map((entity, index) => <AffectedChip key={`${entity.kind}:${entity.id ?? entity.name}:${index}`} entity={entity} />)}
          </div>
        </div>
      )}
      {isAdmin && (
        <Button variant="outline" className="w-full" disabled={pending} onClick={onToggle}>
          {dismissed ? <><Undo2 className="size-4" /> Restore finding</> : <><EyeOff className="size-4" /> Dismiss finding</>}
        </Button>
      )}
    </div>
  );
}

/** Phone security-advisor page: score hero, category subscores, findings with dismissals. */
export function MobileSecurityScore({ isAdmin }: { isAdmin: boolean }) {
  const [showDismissed, setShowDismissed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { reportQuery, dismissMutation, findingsBySeverity } = useSecurityReport();

  const report = reportQuery.data;
  const grade = report ? scoreGrade(report.score) : null;

  // The sheet target can live in the open or the dismissed list.
  const selected = selectedFinding(report, selectedId);
  const selectedDismissed = isDismissed(report, selected);

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
                  {deductionLabel(report.deducted, report.ceiling)}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-1.5"><SeverityBadges report={report} /></div>
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
                          categoryScoreTone(cat.score),
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
                      {findingCountLabel(cat.findingCount)}
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
        {selected && <SelectedFindingContent
          finding={selected}
          dismissed={selectedDismissed}
          isAdmin={isAdmin}
          pending={dismissMutation.isPending}
          onToggle={() => dismissMutation.mutate(
            { action: selectedDismissed ? "undismiss" : "dismiss", findingId: selected.id },
            { onSuccess: () => setSelectedId(null) },
          )}
        />}
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
