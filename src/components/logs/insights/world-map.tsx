"use client";

import { useMemo } from "react";
import type { OriginPoint } from "@/lib/types";
import { formatCount } from "@/lib/format";
import {
  WORLD_LAND_PATH,
  WORLD_MAP_HEIGHT,
  WORLD_MAP_WIDTH,
  projectPoint,
} from "./world-map-data";

const MIN_RADIUS = 3;
const MAX_RADIUS = 14;

const SERIES_META: Record<OriginPoint["series"], { label: string; color: string }> = {
  ids: { label: "IDS event sources", color: "var(--color-chart-1)" },
  visitors: { label: "Cloudflared visitors", color: "var(--color-chart-2)" },
};

/**
 * The Kibana "Global IDS Events" map, PolySIEM-native: Mercator world
 * landmass with one dot per aggregated geohash cell, area ∝ event count.
 * Pure SVG — the land path is pre-projected at build time.
 */
export function WorldMap({ points }: { points: OriginPoint[] }) {
  const dots = useMemo(() => {
    if (points.length === 0) return [];
    const max = Math.max(...points.map((p) => p.count));
    return (
      points
        .map((point) => {
          const { x, y } = projectPoint(point.lat, point.lon);
          const radius = MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(point.count / max);
          return { ...point, x, y, radius };
        })
        // Big dots first so small ones stay hoverable on top of them.
        .sort((a, b) => b.radius - a.radius)
    );
  }, [points]);

  return (
    <div className="space-y-1.5">
      <svg
        viewBox={`0 0 ${WORLD_MAP_WIDTH} ${WORLD_MAP_HEIGHT}`}
        className="w-full rounded-md border border-border/60 bg-muted/20"
        role="img"
        aria-label="World map of traffic origins"
      >
        <path d={WORLD_LAND_PATH} className="fill-muted stroke-border" strokeWidth={0.5} />
        {dots.map((dot, i) => (
          <circle
            key={i}
            cx={dot.x}
            cy={dot.y}
            r={dot.radius}
            fill={SERIES_META[dot.series].color}
            fillOpacity={0.45}
            stroke={SERIES_META[dot.series].color}
            strokeWidth={1}
          >
            <title>
              {`${formatCount(dot.count)} ${SERIES_META[dot.series].label.toLowerCase()} · ${dot.lat.toFixed(1)}, ${dot.lon.toFixed(1)}`}
            </title>
          </circle>
        ))}
      </svg>
      {/* Series legend lives on the country bars below — only the size hint here. */}
      <p className="px-0.5 text-right text-[11px] text-muted-foreground/70">dot area ∝ events</p>
    </div>
  );
}
