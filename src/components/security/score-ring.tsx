"use client";

import { cn } from "@/lib/utils";
import { scoreGrade, type ScoreGrade } from "@/lib/security/score";

const GRADE_COLOR: Record<ScoreGrade, string> = {
  excellent: "text-success",
  good: "text-success",
  fair: "text-warning",
  "at-risk": "text-destructive",
};

/** Big SVG gauge ring for the 0-100 security score, colored by grade. */
export function ScoreRing({ score, size = 176 }: { score: number; size?: number }) {
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference * (1 - clamped / 100);
  const grade = scoreGrade(clamped);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Security score ${clamped} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn("stroke-current transition-[stroke-dashoffset] duration-700 ease-out", GRADE_COLOR[grade])}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-5xl font-semibold tabular-nums tracking-tight", GRADE_COLOR[grade])}>
          {clamped}
        </span>
        <span className="text-xs text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}
