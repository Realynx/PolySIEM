"use client";

import { BarList } from "@/components/logs/insights/bar-rows";
import { customGraphicDefinitionShape, customGraphicPoints, type CustomGraphicPoint, type CustomGraphicSpec } from "./custom-specs";
import { defineNetworkInsightWidget, type NetworkInsightWidgetDefinition } from "./types";

const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

function MetricGraphic({ points }: { points: CustomGraphicPoint[] }) {
  const point = points[0];
  return point ? (
    <div className="rounded-xl border bg-gradient-to-br from-primary/10 via-card to-card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{point.label}</p>
      <p className="mt-3 text-4xl font-semibold tabular-nums">{point.value.toLocaleString()}</p>
    </div>
  ) : <p className="text-xs italic text-muted-foreground">No data in this range.</p>;
}

function DonutGraphic({ points }: { points: CustomGraphicPoint[] }) {
  const total = points.reduce((sum, point) => sum + point.value, 0);
  if (total <= 0) return <p className="text-xs italic text-muted-foreground">No data in this range.</p>;
  let cursor = 0;
  const segments = points.map((point, index) => {
    const start = cursor;
    cursor += (point.value / total) * 100;
    return `${CHART_COLORS[index % CHART_COLORS.length]} ${start}% ${cursor}%`;
  });
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div
        className="grid size-40 shrink-0 place-items-center rounded-full"
        style={{ background: `conic-gradient(${segments.join(", ")})` }}
        role="img"
        aria-label={`${total.toLocaleString()} total events across ${points.length} segments`}
      >
        <div className="grid size-24 place-items-center rounded-full bg-card shadow-inner">
          <span className="text-xl font-semibold tabular-nums">{total.toLocaleString()}</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-2 text-xs">
        {points.map((point, index) => (
          <li key={point.label} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
            <span className="min-w-0 flex-1 truncate" title={point.label}>{point.label}</span>
            <span className="tabular-nums text-muted-foreground">{point.value.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Compile a safe persisted spec into the same definition contract as built-ins. */
export function customGraphicDefinition(spec: CustomGraphicSpec): NetworkInsightWidgetDefinition {
  return defineNetworkInsightWidget({
    ...customGraphicDefinitionShape(spec),
    render: ({ data }) => {
      const points = customGraphicPoints(spec, data);
      if (spec.visualization === "metric") return <MetricGraphic points={points} />;
      if (spec.visualization === "donut") return <DonutGraphic points={points} />;
      return points.length > 0 ? (
        <BarList rows={points.map((point) => ({ label: point.label, count: point.value }))} />
      ) : (
        <p className="text-xs italic text-muted-foreground">No data in this range.</p>
      );
    },
  });
}
