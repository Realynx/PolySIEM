/**
 * Pure scoring: turn a list of findings into a 0-100 rating plus per-category
 * subscores. Each finding deducts its `weight` (or the default for its
 * severity). The overall score is deductions against a fixed ~250-point pool
 * (SCORE_CEILING), so the number is granular; each category subscore is its
 * own deductions against that category's ceiling. Both floor at 0.
 */

import {
  SCORE_CEILING,
  SECURITY_CATEGORIES,
  SECURITY_SEVERITIES,
  SEVERITY_DEDUCTION,
  type SecurityCategoryReport,
  type SecurityFinding,
  type SecuritySeverity,
} from "./types";

export interface ScoreResult {
  score: number;
  deducted: number;
  /** The deduction pool the score is measured against (SCORE_CEILING). */
  ceiling: number;
  categories: SecurityCategoryReport[];
  bySeverity: Record<SecuritySeverity, number>;
}

/** Points a finding deducts: explicit weight, else the severity default. */
export function findingWeight(finding: SecurityFinding): number {
  const w = finding.weight ?? SEVERITY_DEDUCTION[finding.severity] ?? 0;
  return Math.max(0, w);
}

/** Map a deduction against a pool to a 0-100 remaining score. */
function remaining(deducted: number, pool: number): number {
  if (pool <= 0) return 100;
  return Math.max(0, Math.round(100 - (100 * deducted) / pool));
}

export function computeScore(findings: SecurityFinding[]): ScoreResult {
  const bySeverity = Object.fromEntries(SECURITY_SEVERITIES.map((s) => [s, 0])) as Record<
    SecuritySeverity,
    number
  >;
  const deductedByCategory = new Map<string, number>();
  const countByCategory = new Map<string, number>();
  let deducted = 0;

  for (const finding of findings) {
    const points = findingWeight(finding);
    deducted += points;
    bySeverity[finding.severity] += 1;
    deductedByCategory.set(finding.category, (deductedByCategory.get(finding.category) ?? 0) + points);
    countByCategory.set(finding.category, (countByCategory.get(finding.category) ?? 0) + 1);
  }

  const categories: SecurityCategoryReport[] = SECURITY_CATEGORIES.map((cat) => {
    const catDeducted = deductedByCategory.get(cat.id) ?? 0;
    return {
      id: cat.id,
      label: cat.label,
      blurb: cat.blurb,
      score: remaining(catDeducted, cat.ceiling),
      deducted: catDeducted,
      findingCount: countByCategory.get(cat.id) ?? 0,
    };
  });

  return {
    score: remaining(deducted, SCORE_CEILING),
    deducted,
    ceiling: SCORE_CEILING,
    categories,
    bySeverity,
  };
}

export type ScoreGrade = "excellent" | "good" | "fair" | "at-risk";

/** Human bucket for a score — drives the gauge color and headline. */
export function scoreGrade(score: number): ScoreGrade {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 50) return "fair";
  return "at-risk";
}

/** Sort findings worst-first (severity rank, then category, then id) for stable display. */
export function sortFindings(findings: SecurityFinding[]): SecurityFinding[] {
  const rank = new Map(SECURITY_SEVERITIES.map((s, i) => [s, i]));
  return [...findings].sort((a, b) => {
    const bySev = (rank.get(a.severity) ?? 99) - (rank.get(b.severity) ?? 99);
    if (bySev !== 0) return bySev;
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
