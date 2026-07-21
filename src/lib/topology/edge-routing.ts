/**
 * Pure edge-routing helpers shared by the topology maps.
 *
 * Two independent concerns, both framework-agnostic and unit-tested:
 *
 * 1. Preserving and rendering dagre's routed waypoint corridor. The renderer
 *    deforms it when nodes move, restores strict Manhattan geometry, and
 *    separates crowded shared handles without diagonals crossing nearby nodes.
 *
 * 2. Optional semantic bundling for callers where one connector really is one
 *    physical channel (for example, documented LAG members). Ordinary logical
 *    traces should remain distinct and use the endpoint/corridor offsets above.
 *
 * Nothing here imports React or dagre — callers pass in plain points/records.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface DagreRoute {
  /** Interior bends supplied by dagre. */
  waypoints: Pt[];
  /** Original boundary points, used to deform the route after a node moves. */
  sourceAnchor?: Pt;
  targetAnchor?: Pt;
}

export interface EndpointOffsets {
  sourceOffset: number;
  targetOffset: number;
}

/** Compact SVG number: integers stay integers, floats clamp to 2dp. */
function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Divide, treating a zero denominator as 0 (guards coincident spline knots). */
function safeDiv(num: number, den: number): number {
  return den === 0 ? 0 : num / den;
}

/** Drop consecutive duplicate points — zero-length segments break the spline math. */
export function dedupePoints(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * The interior routing waypoints of a dagre edge: its `points` with the first
 * and last dropped (those sit on the node boundaries). React Flow supplies the
 * true endpoints live from the handles, so keeping only the interior bends lets
 * the edge stay attached to its nodes when one is dragged while still following
 * dagre's routing channel at rest.
 */
export function interiorWaypoints(
  points: readonly Pt[] | undefined | null,
): Pt[] {
  if (!points || points.length <= 2) return [];
  return points.slice(1, -1).map((p) => ({ x: p.x, y: p.y }));
}

/**
 * Preserve dagre's boundary anchors along with its interior bends. The anchors
 * let the renderer notice how far either endpoint has moved since layout and
 * smoothly carry nearby bends with it instead of leaving a stale route behind.
 */
export function dagreRoute(
  points: readonly Pt[] | undefined | null,
): DagreRoute {
  const clean = dedupePoints(points ?? []);
  if (clean.length < 2) return { waypoints: [] };
  return {
    waypoints: clean.slice(1, -1),
    sourceAnchor: clean[0],
    targetAnchor: clean[clean.length - 1],
  };
}

/**
 * Deform a layout-time route to current endpoint positions. Displacement is
 * blended by distance along the original route: moving just the target carries
 * target-side bends farther than source-side bends, while moving both endpoints
 * together translates the entire corridor. This keeps saved/dragged positions
 * from producing the long loops caused by fixed interior waypoints.
 */
export function deformWaypoints(
  waypoints: readonly Pt[],
  sourceAnchor: Pt | undefined,
  targetAnchor: Pt | undefined,
  liveSource: Pt,
  liveTarget: Pt,
): Pt[] {
  if (!sourceAnchor || !targetAnchor || waypoints.length === 0)
    return waypoints.map((p) => ({ ...p }));

  const route = [sourceAnchor, ...waypoints, targetAnchor];
  const lengths: number[] = [0];
  for (let i = 1; i < route.length; i += 1)
    lengths.push(lengths[i - 1] + dist(route[i - 1], route[i]));
  const total = lengths[lengths.length - 1];
  const sourceDelta = {
    x: liveSource.x - sourceAnchor.x,
    y: liveSource.y - sourceAnchor.y,
  };
  const targetDelta = {
    x: liveTarget.x - targetAnchor.x,
    y: liveTarget.y - targetAnchor.y,
  };

  return waypoints.map((point, index) => {
    const t =
      total === 0
        ? (index + 1) / (waypoints.length + 1)
        : lengths[index + 1] / total;
    return {
      x: point.x + sourceDelta.x * (1 - t) + targetDelta.x * t,
      y: point.y + sourceDelta.y * (1 - t) + targetDelta.y * t,
    };
  });
}

/**
 * Carry endpoint fan-out/fan-in lanes through the nearest routed waypoint.
 *
 * Offsetting only the visible endpoint leaves the first stored waypoint on the
 * handle centerline. When that waypoint lies opposite the route's destination
 * (notably a centered Cloudflare tunnel feeding a vertical list of hostnames),
 * the path briefly returns to center and forms a tiny 180-degree hairpin. Keep
 * the endpoint segment straight by moving its adjacent waypoint onto the same
 * lateral lane; the middle of the route remains untouched.
 */
export function alignEndpointLanes(
  rawWaypoints: readonly Pt[],
  source: Pt,
  target: Pt,
  sourceAxis: RouteAxis,
  targetAxis: RouteAxis,
): Pt[] {
  if (rawWaypoints.length === 0) return [];

  const align = (point: Pt, endpoint: Pt, axis: RouteAxis): Pt =>
    axis === "horizontal"
      ? { x: point.x, y: endpoint.y }
      : { x: endpoint.x, y: point.y };

  if (rawWaypoints.length === 1) {
    return dedupePoints([
      align(rawWaypoints[0], source, sourceAxis),
      align(rawWaypoints[0], target, targetAxis),
    ]);
  }

  const waypoints = rawWaypoints.map((point) => ({ ...point }));
  waypoints[0] = align(waypoints[0], source, sourceAxis);
  const last = waypoints.length - 1;
  waypoints[last] = align(waypoints[last], target, targetAxis);
  return dedupePoints(waypoints);
}

/** Remove points that sit on the straight segment between their neighbours. */
export function simplifyPolyline(
  rawPoints: readonly Pt[],
  epsilon = 0.01,
): Pt[] {
  const points = dedupePoints(rawPoints);
  if (points.length <= 2) return points;
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const bc = { x: c.x - b.x, y: c.y - b.y };
    const cross = ab.x * bc.y - ab.y * bc.x;
    const forward = ab.x * bc.x + ab.y * bc.y >= 0;
    if (Math.abs(cross) > epsilon || !forward) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

export type RouteAxis = "horizontal" | "vertical";

/** Axis of a non-zero orthogonal segment; null for a diagonal or duplicate. */
function segmentAxis(a: Pt, b: Pt): RouteAxis | null {
  if (a.y === b.y && a.x !== b.x) return "horizontal";
  if (a.x === b.x && a.y !== b.y) return "vertical";
  return null;
}

/**
 * Turn an arbitrary waypoint corridor into a Manhattan polyline.
 *
 * Live node movement can deform a dagre bend on both axes, leaving a diagonal
 * between otherwise orthogonal escape segments. Each such join gets one elbow
 * that continues the previous segment's axis before turning 90 degrees. When
 * there is no previous direction, the longer axis is traversed first. The
 * caller's explicit source/target escape points therefore remain authoritative.
 */
export function orthogonalPolyline(
  rawPoints: readonly Pt[],
  initialAxis?: RouteAxis,
): Pt[] {
  const points = dedupePoints(rawPoints);
  if (points.length <= 1) return points;

  const out: Pt[] = [{ ...points[0] }];
  let previousAxis = initialAxis ?? null;
  for (let index = 1; index < points.length; index += 1) {
    const current = out[out.length - 1];
    const next = points[index];
    const directAxis = segmentAxis(current, next);
    if (directAxis) {
      out.push({ ...next });
      previousAxis = directAxis;
      continue;
    }
    if (current.x === next.x && current.y === next.y) continue;

    const firstAxis =
      previousAxis ??
      (Math.abs(next.x - current.x) >= Math.abs(next.y - current.y)
        ? "horizontal"
        : "vertical");
    const elbow =
      firstAxis === "horizontal"
        ? { x: next.x, y: current.y }
        : { x: current.x, y: next.y };
    out.push(elbow, { ...next });
    previousAxis = firstAxis === "horizontal" ? "vertical" : "horizontal";
  }
  return simplifyPolyline(out);
}

/** Render a sharp-cornered SVG polyline using only move/line commands. */
export function polylinePath(rawPoints: readonly Pt[]): string {
  const points = simplifyPolyline(rawPoints);
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return rest.reduce(
    (path, point) => `${path} L ${fmt(point.x)},${fmt(point.y)}`,
    `M ${fmt(first.x)},${fmt(first.y)}`,
  );
}

/**
 * Render a polyline with small quadratic corner rounds. Unlike a free spline,
 * the curve stays local to every routed bend and cannot bow across an unrelated
 * node in the middle of a long segment.
 */
export function roundedPolylinePath(
  rawPoints: readonly Pt[],
  radius = 8,
): string {
  const points = simplifyPolyline(rawPoints);
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${fmt(points[0].x)},${fmt(points[0].y)}`;

  let d = `M ${fmt(points[0].x)},${fmt(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const before = dist(prev, corner);
    const after = dist(corner, next);
    const incoming = {
      x: corner.x - prev.x,
      y: corner.y - prev.y,
    };
    const outgoing = {
      x: next.x - corner.x,
      y: next.y - corner.y,
    };
    const turn = incoming.x * outgoing.y - incoming.y * outgoing.x;

    // A collinear reversal is a real routing bend, but it is not a corner that
    // a quadratic can round. Its entry and exit points coincide, producing a
    // zero-width cusp that SVG renderers display as a sharp spike. Leave the
    // reversal as line segments; the path's round stroke join renders it cleanly.
    if (Math.abs(turn) <= 0.0001) {
      d += ` L ${fmt(corner.x)},${fmt(corner.y)}`;
      continue;
    }
    const r = Math.min(radius, before / 2, after / 2);
    if (r <= 0) continue;
    const into = {
      x: corner.x - ((corner.x - prev.x) / before) * r,
      y: corner.y - ((corner.y - prev.y) / before) * r,
    };
    const out = {
      x: corner.x + ((next.x - corner.x) / after) * r,
      y: corner.y + ((next.y - corner.y) / after) * r,
    };
    d += ` L ${fmt(into.x)},${fmt(into.y)} Q ${fmt(corner.x)},${fmt(corner.y)} ${fmt(out.x)},${fmt(out.y)}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${fmt(last.x)},${fmt(last.y)}`;
}

/** Point at a fraction of cumulative polyline length (used for stable labels). */
export function pointAlongPolyline(
  rawPoints: readonly Pt[],
  fraction = 0.5,
): Pt {
  const points = dedupePoints(rawPoints);
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const length = dist(points[i - 1], points[i]);
    lengths.push(length);
    total += length;
  }
  if (total === 0) return points[0];
  const wanted = Math.max(0, Math.min(1, fraction)) * total;
  let travelled = 0;
  for (let i = 0; i < lengths.length; i += 1) {
    if (travelled + lengths[i] >= wanted) {
      const t = lengths[i] === 0 ? 0 : (wanted - travelled) / lengths[i];
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
    }
    travelled += lengths[i];
  }
  return points[points.length - 1];
}

/**
 * Give fan-in/fan-out edges deterministic, centered lanes near shared handles.
 * The renderer turns these scalar offsets into short orthogonal escape segments.
 */
export function endpointOffsets<
  T extends { id: string; source: string; target: string },
>(edges: readonly T[], gap = 8, maxOffset = 28): Map<string, EndpointOffsets> {
  const result = new Map(
    edges.map((edge) => [edge.id, { sourceOffset: 0, targetOffset: 0 }]),
  );
  const sources = new Map<string, T[]>();
  const targets = new Map<string, T[]>();
  for (const edge of edges) {
    sources.set(edge.source, [...(sources.get(edge.source) ?? []), edge]);
    targets.set(edge.target, [...(targets.get(edge.target) ?? []), edge]);
  }
  const assign = (
    groups: Map<string, T[]>,
    key: "sourceOffset" | "targetOffset",
  ) => {
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const effectiveGap = Math.min(gap, (maxOffset * 2) / (group.length - 1));
      group.forEach((edge, index) => {
        result.get(edge.id)![key] =
          (index - (group.length - 1) / 2) * effectiveGap;
      });
    }
  };
  assign(sources, "sourceOffset");
  assign(targets, "targetOffset");
  return result;
}

/**
 * A smooth SVG path through `points`, using a centripetal Catmull-Rom spline
 * (alpha = 0.5) converted to cubic beziers. The curve passes through every
 * point with no overshoot or cusps — ideal for dagre's waypoints.
 *
 * Degenerate inputs are handled: `[]` → "", one point → a bare moveto, two
 * points (or any run that dedupes to two) → a straight line.
 */
export function smoothPath(rawPoints: readonly Pt[], alpha = 0.5): string {
  const points = dedupePoints(rawPoints);
  if (points.length === 0) return "";

  const first = points[0];
  if (points.length === 1) return `M ${fmt(first.x)},${fmt(first.y)}`;
  if (points.length === 2) {
    const b = points[1];
    return `M ${fmt(first.x)},${fmt(first.y)} L ${fmt(b.x)},${fmt(b.y)}`;
  }

  // Pad with the endpoints duplicated so the spline actually reaches them.
  const pad = [first, ...points, points[points.length - 1]];
  let d = `M ${fmt(first.x)},${fmt(first.y)}`;

  for (let i = 1; i < pad.length - 2; i += 1) {
    const p0 = pad[i - 1];
    const p1 = pad[i];
    const p2 = pad[i + 1];
    const p3 = pad[i + 2];

    // Non-uniform (centripetal) knot spacing.
    const t01 = dist(p0, p1) ** alpha;
    const t12 = dist(p1, p2) ** alpha;
    const t23 = dist(p2, p3) ** alpha;
    const t1 = t01;
    const t2 = t01 + t12;
    const t3 = t01 + t12 + t23;

    // Tangents at p1 and p2, each scaled by the segment's knot span (t2 - t1).
    const span = t2 - t1;
    const m1x =
      span *
      (safeDiv(p1.x - p0.x, t1) -
        safeDiv(p2.x - p0.x, t2) +
        safeDiv(p2.x - p1.x, t2 - t1));
    const m1y =
      span *
      (safeDiv(p1.y - p0.y, t1) -
        safeDiv(p2.y - p0.y, t2) +
        safeDiv(p2.y - p1.y, t2 - t1));
    const m2x =
      span *
      (safeDiv(p3.x - p2.x, t3 - t2) -
        safeDiv(p3.x - p1.x, t3 - t1) +
        safeDiv(p2.x - p1.x, t2 - t1));
    const m2y =
      span *
      (safeDiv(p3.y - p2.y, t3 - t2) -
        safeDiv(p3.y - p1.y, t3 - t1) +
        safeDiv(p2.y - p1.y, t2 - t1));

    const c1x = p1.x + m1x / 3;
    const c1y = p1.y + m1y / 3;
    const c2x = p2.x - m2x / 3;
    const c2y = p2.y - m2y / 3;

    d += ` C ${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(p2.x)},${fmt(p2.y)}`;
  }

  return d;
}

/* ------------------------------------------------------------------ */
/* Parallel-edge bundling                                              */
/* ------------------------------------------------------------------ */

export interface EdgeBundle<T> {
  /** The shared key every item in the bundle produced. */
  key: string;
  /** Every item that collapsed into this bundle, in input order. */
  items: T[];
  /** Convenience: `items.length`. >1 means genuinely parallel edges. */
  count: number;
  /** The first item — used as the representative for id/style/label. */
  primary: T;
}

/**
 * Group items that share a key into bundles, preserving first-seen key order.
 * A bundle with `count > 1` is a set of parallel edges that should render as one
 * connector with an "×N" badge.
 */
export function bundleBy<T>(
  items: readonly T[],
  keyFn: (item: T, index: number) => string,
): EdgeBundle<T>[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  items.forEach((item, index) => {
    const key = keyFn(item, index);
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
      order.push(key);
    }
  });
  return order.map((key) => {
    const group = groups.get(key)!;
    return { key, items: group, count: group.length, primary: group[0] };
  });
}

const SEP = "␟"; // unit separator — unlikely to appear in a node id

/** Order-independent pair key: `a→b` and `b→a` land in the same bundle. */
export function undirectedKey(a: string, b: string): string {
  return a <= b ? `${a}${SEP}${b}` : `${b}${SEP}${a}`;
}

/** Direction-preserving pair key: `a→b` and `b→a` are separate bundles. */
export function directedKey(a: string, b: string): string {
  return `${a}${SEP}${b}`;
}
