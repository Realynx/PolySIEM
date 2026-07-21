"use client";

import { memo, useMemo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import {
  alignEndpointLanes,
  deformWaypoints,
  orthogonalPolyline,
  pointAlongPolyline,
  roundedPolylinePath,
  type Pt,
} from "@/lib/topology/edge-routing";

/**
 * Data threaded onto a routed edge by the maps. `waypoints` are dagre's interior
 * routing points (flow coords, computed once at layout time); everything else is
 * optional metadata. The maps also keep their own fields on `data` (e.g. the
 * footprint map's `baseOpacity`/`hoverOnly`), so the shape stays open.
 */
export interface RoutedEdgeData {
  /** Interior dagre routing waypoints; edge endpoints come live from the handles. */
  waypoints?: Pt[];
  /** Dagre's original node-boundary endpoints, for live route deformation. */
  sourceAnchor?: Pt;
  targetAnchor?: Pt;
  /** Deterministic lateral lanes for fan-out/fan-in at shared handles. */
  sourceOffset?: number;
  targetOffset?: number;
  /** Separates the central cross-segment of otherwise identical routes. */
  midpointOffset?: number;
  /** Parallel edges collapsed into this one; >1 renders a small "×N" badge. */
  bundleCount?: number;
  [key: string]: unknown;
}

function escapePoint(
  point: Pt,
  position: Position,
  distance: number,
  lateral: number,
): Pt {
  if (position === Position.Left)
    return { x: point.x - distance, y: point.y + lateral };
  if (position === Position.Right)
    return { x: point.x + distance, y: point.y + lateral };
  if (position === Position.Top)
    return { x: point.x + lateral, y: point.y - distance };
  return { x: point.x + lateral, y: point.y + distance };
}

/** Keep a short endpoint lead from overshooting a nearby routed corridor. */
function escapeDistanceToward(
  point: Pt,
  position: Position,
  routePoint: Pt,
  maximum: number,
): number {
  const available =
    position === Position.Left
      ? point.x - routePoint.x
      : position === Position.Right
        ? routePoint.x - point.x
        : position === Position.Top
          ? point.y - routePoint.y
          : routePoint.y - point.y;
  return Math.max(0, Math.min(maximum, available));
}

function fallbackPoints(
  source: Pt,
  target: Pt,
  sourcePosition: Position,
  targetPosition: Position,
  sourceOffset: number,
  targetOffset: number,
  midpointOffset: number,
): Pt[] {
  const sourceLead = escapePoint(source, sourcePosition, 18, 0);
  const targetLead = escapePoint(target, targetPosition, 18, 0);
  const sourceTrack = escapePoint(source, sourcePosition, 18, sourceOffset);
  const targetTrack = escapePoint(target, targetPosition, 18, targetOffset);
  const sourceHorizontal =
    sourcePosition === Position.Left || sourcePosition === Position.Right;
  const targetHorizontal =
    targetPosition === Position.Left || targetPosition === Position.Right;
  if (sourceHorizontal && targetHorizontal) {
    const midX = (sourceTrack.x + targetTrack.x) / 2 + midpointOffset;
    return [
      source,
      sourceLead,
      sourceTrack,
      { x: midX, y: sourceTrack.y },
      { x: midX, y: targetTrack.y },
      targetTrack,
      targetLead,
      target,
    ];
  }
  if (!sourceHorizontal && !targetHorizontal) {
    const midY = (sourceTrack.y + targetTrack.y) / 2 + midpointOffset;
    return [
      source,
      sourceLead,
      sourceTrack,
      { x: sourceTrack.x, y: midY },
      { x: targetTrack.x, y: midY },
      targetTrack,
      targetLead,
      target,
    ];
  }
  const corner = sourceHorizontal
    ? { x: targetTrack.x, y: sourceTrack.y }
    : { x: sourceTrack.x, y: targetTrack.y };
  return [
    source,
    sourceLead,
    sourceTrack,
    corner,
    targetTrack,
    targetLead,
    target,
  ];
}

export type RoutedEdgeType = Edge<RoutedEdgeData, "routed">;

/**
 * A custom React Flow edge that renders dagre's corridor as a strict Manhattan
 * polyline, deforms it to follow moved nodes, and separates crowded handles.
 *
 * Perf contract (the maps depend on this):
 *  - The path is derived from `data.waypoints` (fixed at layout time) plus the
 *    live endpoints, and is `useMemo`d on the endpoints ONLY. Hover/selection
 *    changes only `style`, so they never rebuild the path — they just restyle.
 *  - The whole component is `React.memo`, so an edge re-renders only when its
 *    own props change (its endpoints move on drag, or its style changes).
 *
 * Edges without waypoints (e.g. anchor/containment lines dagre never laid out)
 * use a compact orthogonal fallback with the same endpoint guarantees.
 */
function RoutedEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerStart,
  markerEnd,
  interactionWidth,
  label,
  labelStyle,
  labelShowBg,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
}: EdgeProps<RoutedEdgeType>) {
  const waypoints = data?.waypoints;

  const sourceSide = sourcePosition ?? Position.Bottom;
  const targetSide = targetPosition ?? Position.Top;
  const sourceOffset = data?.sourceOffset ?? 0;
  const targetOffset = data?.targetOffset ?? 0;
  const midpointOffset = data?.midpointOffset ?? 0;

  const [path, labelX, labelY] = useMemo<[string, number, number]>(() => {
    const sourceHandle = { x: sourceX, y: sourceY };
    const targetHandle = { x: targetX, y: targetY };
    // Offset the visible endpoints themselves instead of joining every trace
    // at the handle center and fanning out a few pixels later. React Flow still
    // owns the semantic handle; the SVG routes now stay distinct to the card.
    const source = escapePoint(sourceHandle, sourceSide, 0, sourceOffset);
    const target = escapePoint(targetHandle, targetSide, 0, targetOffset);
    let full: Pt[];
    if (waypoints && waypoints.length > 0) {
      const warped = deformWaypoints(
        waypoints,
        data?.sourceAnchor,
        data?.targetAnchor,
        sourceHandle,
        targetHandle,
      );
      const aligned = alignEndpointLanes(
        warped,
        source,
        target,
        sourceSide === Position.Left || sourceSide === Position.Right
          ? "horizontal"
          : "vertical",
        targetSide === Position.Left || targetSide === Position.Right
          ? "horizontal"
          : "vertical",
      );
      const sourceLead = escapeDistanceToward(
        source,
        sourceSide,
        aligned[0],
        12,
      );
      const targetLead = escapeDistanceToward(
        target,
        targetSide,
        aligned[aligned.length - 1],
        12,
      );
      full = [
        source,
        escapePoint(source, sourceSide, sourceLead, 0),
        ...aligned,
        escapePoint(target, targetSide, targetLead, 0),
        target,
      ];
    } else {
      full = fallbackPoints(
        source,
        target,
        sourceSide,
        targetSide,
        0,
        0,
        midpointOffset,
      );
    }
    // Deformation may move a waypoint on both axes. Re-orthogonalize only after
    // all live endpoints and fan-out offsets are present so no diagonal join or
    // curved-corner artifact can reach the SVG path.
    const orthogonal = orthogonalPolyline(full);
    const labelPoint = pointAlongPolyline(orthogonal);
    return [roundedPolylinePath(orthogonal, 6), labelPoint.x, labelPoint.y];
  }, [
    waypoints,
    data?.sourceAnchor,
    data?.targetAnchor,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourceSide,
    targetSide,
    sourceOffset,
    targetOffset,
    midpointOffset,
  ]);

  const bundleCount = data?.bundleCount ?? 1;
  const opacity = (style?.opacity as number | undefined) ?? 1;
  const numericStrokeWidth =
    typeof style?.strokeWidth === "number"
      ? style.strokeWidth
      : Number.parseFloat(String(style?.strokeWidth ?? 1.5)) || 1.5;
  const routeStyle = {
    ...style,
    // Rounded copper runs keep dense, parallel Manhattan tracks readable at
    // corners without making them look like a single heavy bundle.
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as React.CSSProperties;
  // Use a binary casing opacity: translucent underlays compound into dark
  // patches wherever several routes overlap. Fully opaque separators remain a
  // stable canvas color, while deliberately dimmed edges get no casing at all.
  const casingOpacity = opacity >= 0.3 ? 1 : 0;
  const casingStyle = {
    stroke: "var(--topology-edge-casing)",
    strokeWidth: numericStrokeWidth +
      (typeof data?.casingGap === "number" ? data.casingGap : 3),
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeDasharray: "none",
    animation: "none",
    opacity: casingOpacity,
    pointerEvents: "none",
  } as React.CSSProperties;

  return (
    <>
      {/* A narrow underlay cuts unrelated crossing tracks apart visually. */}
      <path
        className="topology-edge-casing"
        d={path}
        fill="none"
        style={casingStyle}
        aria-hidden
      />
      <BaseEdge
        id={id}
        path={path}
        style={routeStyle}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth}
        label={label}
        labelX={labelX}
        labelY={labelY}
        labelStyle={labelStyle}
        labelShowBg={labelShowBg}
        labelBgStyle={labelBgStyle}
        labelBgPadding={labelBgPadding}
        labelBgBorderRadius={labelBgBorderRadius}
      />
      {bundleCount > 1 && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded-full border border-border bg-card/95 px-1 text-[9px] font-semibold leading-[14px] tabular-nums text-muted-foreground shadow-sm"
            style={{
              // Stack the count above the text label so the two never overlap.
              transform: `translate(-50%, -50%) translate(${labelX}px, ${label ? labelY - 11 : labelY}px)`,
              opacity,
            }}
            title={`${bundleCount} parallel connections`}
          >
            ×{bundleCount}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const RoutedEdge = memo(RoutedEdgeComponent);
