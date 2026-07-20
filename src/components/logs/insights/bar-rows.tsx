"use client";

import type { CountryOriginRow } from "@/lib/types";

/**
 * Hand-rolled horizontal bars (no chart lib): every row carries its label and
 * count in text tokens, the bar itself is proportional decoration only. A
 * single hue per series via the theme chart tokens.
 */

/** One-series bar rows (top IPs, event types, …). */
export function BarList({ rows }: { rows: { label: string; count: number }[] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li key={row.label} className="space-y-0.5">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate font-mono" title={row.label}>
              {row.label}
            </span>
            <span className="text-muted-foreground tabular-nums">{row.count.toLocaleString()}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className="h-full rounded-full [background:var(--color-chart-1)]"
              style={{ width: `${Math.max((row.count / max) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The map replacement: per-country rows with a two-segment bar — IDS event
 * sources vs Cloudflared visitors. Counts are always printed, so color never
 * carries meaning alone.
 */
export function CountryBars({ rows }: { rows: CountryOriginRow[] }) {
  const max = Math.max(...rows.map((r) => r.ids + r.visitors), 1);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.7rem] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-[3px] [background:var(--color-chart-1)]" aria-hidden />
          IDS event sources
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-[3px] [background:var(--color-chart-2)]" aria-hidden />
          Cloudflared visitors
        </span>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.country} className="space-y-0.5">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate" title={row.country}>
                {row.country}
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {row.ids.toLocaleString()} IDS · {row.visitors.toLocaleString()} visitors
              </span>
            </div>
            <div className="flex h-1.5 gap-0.5" aria-hidden>
              {row.ids > 0 && (
                <div
                  className="h-full rounded-full [background:var(--color-chart-1)]"
                  style={{ width: `${Math.max((row.ids / max) * 100, 1)}%` }}
                />
              )}
              {row.visitors > 0 && (
                <div
                  className="h-full rounded-full [background:var(--color-chart-2)]"
                  style={{ width: `${Math.max((row.visitors / max) * 100, 1)}%` }}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
