export interface FootprintLayoutBox {
  id: string;
  width: number;
  height: number;
  category: string;
}

export interface FootprintPackedLayout {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
  left: number;
  columns: number;
}

export type FootprintCircuitBank = "left" | "right";

export interface FootprintTraceCorridor {
  left: number;
  right: number;
  width: number;
}

export interface FootprintCircuitBox extends FootprintLayoutBox {
  /** Legacy metadata; component placement no longer depends on routed load. */
  traceWeight?: number;
}

export interface FootprintCircuitLayout extends FootprintPackedLayout {
  bankById: Map<string, FootprintCircuitBank>;
  corridor: FootprintTraceCorridor;
}

/** Stable board gutter; trace density is handled by obstacle-aware routing. */
export function footprintTraceCorridorWidth(_traceCount = 0): number {
  void _traceCount;
  return 260;
}

/**
 * Assign one PCB track inside a bank's half of the reserved corridor. Tracks
 * grow inward from the destination bank but retain a small center gap so left
 * and right ribbon cables remain visually distinct even at maximum density.
 */
export function footprintTraceTrackX(
  corridor: FootprintTraceCorridor,
  bank: FootprintCircuitBank,
  index: number,
  count: number,
): number {
  const edgeInset = 18;
  const centerClearance = 8;
  const usable = Math.max(
    0,
    corridor.width / 2 - edgeInset - centerClearance,
  );
  const gap = count <= 1 ? 0 : Math.min(6, usable / (count - 1));
  return bank === "left"
    ? corridor.left + edgeInset + Math.max(0, index) * gap
    : corridor.right - edgeInset - Math.max(0, index) * gap;
}

export interface FootprintTraceEndpoint {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FootprintTraceSide = "left" | "right" | "top" | "bottom";

export interface FootprintTraceRails {
  sourceLead?: number;
  targetLead?: number;
  sourceLateral?: number;
  targetLateral?: number;
}

export interface FootprintRouteObstacle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FootprintRouteSegment {
  owner: string;
  group?: string;
  a: { x: number; y: number };
  b: { x: number; y: number };
}

export interface FootprintRouteOptions extends FootprintTraceRails {
  sourceSide?: FootprintTraceSide;
  targetSide?: FootprintTraceSide;
  preferredTrackX?: number;
  /** Optional first bus used before transferring onto the preferred track. */
  preferredApproachTrackX?: number;
  /** Split/fan-in rail where a family joins or leaves its shared track. */
  preferredJunctionY?: number;
  /** Required axis for the final segment into an explicit connection port. */
  targetApproachAxis?: "horizontal" | "vertical";
  /** Hard ceiling for the sparse fallback search. */
  maxMazeStates?: number;
  obstacles?: readonly FootprintRouteObstacle[];
  occupied?: readonly FootprintRouteSegment[];
  owner?: string;
  group?: string;
  clearance?: number;
  /** Minimum centerline spacing for overlapping vertical trace runs. */
  minimumTraceSpacing?: number;
  bendPenalty?: number;
  /** Extra score a route may spend to join its family's PCB highway. */
  preferredTrackTolerance?: number;
  /** Dense graph rendering can disable the expensive sparse-grid fallback. */
  allowMazeRouting?: boolean;
}

export interface FootprintHighwayMember {
  id: string;
  sourceX: number;
  targetX: number;
}

/**
 * Choose the vertical axis used by the largest useful set of related traces.
 *
 * A candidate receives a vote when joining it adds only a modest horizontal
 * detour to that member's Manhattan route. Coverage wins before total detour,
 * so one distant outlier cannot pull a busy bus away from the majority. The
 * final tie-break keeps the highway near the family's visual center.
 */
export function footprintTraceHighwayX(
  members: readonly FootprintHighwayMember[],
  candidates: readonly number[] = [],
  isCandidateClear: (x: number) => boolean = () => true,
): number | null {
  if (members.length === 0) return null;
  const midpoint = (member: FootprintHighwayMember) =>
    (member.sourceX + member.targetX) / 2;
  const visualCenter = [...members]
    .map(midpoint)
    .sort((a, b) => a - b)[Math.floor(members.length / 2)];
  const axes = new Set<number>(candidates);
  for (const member of members) {
    axes.add(member.sourceX);
    axes.add(member.targetX);
    axes.add(midpoint(member));
  }
  let best: {
    x: number;
    coverage: number;
    detour: number;
    centerDistance: number;
  } | null = null;
  for (const x of axes) {
    if (!isCandidateClear(x)) continue;
    let coverage = 0;
    let detour = 0;
    for (const member of members) {
      const direct = Math.abs(member.sourceX - member.targetX);
      const via =
        Math.abs(member.sourceX - x) + Math.abs(member.targetX - x);
      const extra = Math.max(0, via - direct);
      // Enough give for a clean ribbon, but never enough for a board-wide
      // excursion merely to reuse a track.
      if (extra <= Math.max(36, Math.min(72, direct * 0.2))) coverage += 1;
      detour += extra;
    }
    const centerDistance = Math.abs(x - visualCenter);
    if (
      !best ||
      coverage > best.coverage ||
      (coverage === best.coverage && detour < best.detour - 0.01) ||
      (coverage === best.coverage &&
        Math.abs(detour - best.detour) < 0.01 &&
        centerDistance < best.centerDistance - 0.01) ||
      (coverage === best.coverage &&
        Math.abs(detour - best.detour) < 0.01 &&
        Math.abs(centerDistance - best.centerDistance) < 0.01 &&
        x < best.x)
    ) {
      best = { x, coverage, detour, centerDistance };
    }
  }
  return best?.x ?? null;
}

function traceEscapePoint(
  endpoint: FootprintTraceEndpoint,
  side: FootprintTraceSide,
  lead: number,
  lateral = 0,
): { x: number; y: number } {
  if (side === "left")
    return {
      x: endpoint.x - endpoint.width / 2 - lead,
      y: endpoint.y + lateral,
    };
  if (side === "right")
    return {
      x: endpoint.x + endpoint.width / 2 + lead,
      y: endpoint.y + lateral,
    };
  if (side === "top")
    return {
      x: endpoint.x + lateral,
      y: endpoint.y - endpoint.height / 2 - lead,
    };
  return {
    x: endpoint.x + lateral,
    y: endpoint.y + endpoint.height / 2 + lead,
  };
}

type TracePoint = { x: number; y: number };

function samePoint(a: TracePoint, b: TracePoint): boolean {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

function simplifyTrace(points: readonly TracePoint[]): TracePoint[] {
  const out: TracePoint[] = [];
  for (const point of points) {
    if (out.length > 0 && samePoint(out[out.length - 1], point)) continue;
    const previous = out[out.length - 1];
    const before = out[out.length - 2];
    if (
      before &&
      previous &&
      ((Math.abs(before.x - previous.x) < 0.01 &&
        Math.abs(previous.x - point.x) < 0.01) ||
        (Math.abs(before.y - previous.y) < 0.01 &&
          Math.abs(previous.y - point.y) < 0.01))
    ) {
      out[out.length - 1] = point;
    } else {
      out.push(point);
    }
  }
  return out;
}

function segmentLength(a: TracePoint, b: TracePoint): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function segmentIsClear(
  a: TracePoint,
  b: TracePoint,
  obstacles: readonly FootprintRouteObstacle[],
  clearance: number,
): boolean {
  const horizontal = Math.abs(a.y - b.y) < 0.01;
  const vertical = Math.abs(a.x - b.x) < 0.01;
  if (!horizontal && !vertical) return false;
  for (const obstacle of obstacles) {
    const left = obstacle.x - clearance;
    const right = obstacle.x + obstacle.width + clearance;
    const top = obstacle.y - clearance;
    const bottom = obstacle.y + obstacle.height + clearance;
    if (horizontal) {
      if (a.y <= top || a.y >= bottom) continue;
      if (
        Math.min(a.x, b.x) < right &&
        Math.max(a.x, b.x) > left
      ) return false;
    } else {
      if (a.x <= left || a.x >= right) continue;
      if (
        Math.min(a.y, b.y) < bottom &&
        Math.max(a.y, b.y) > top
      ) return false;
    }
  }
  return true;
}

function overlapLength(
  a: TracePoint,
  b: TracePoint,
  c: TracePoint,
  d: TracePoint,
): number {
  const firstHorizontal = Math.abs(a.y - b.y) < 0.01;
  const secondHorizontal = Math.abs(c.y - d.y) < 0.01;
  if (firstHorizontal !== secondHorizontal) return 0;
  if (firstHorizontal) {
    if (Math.abs(a.y - c.y) >= 0.01) return 0;
    return Math.max(
      0,
      Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)),
    );
  }
  if (Math.abs(a.x - c.x) >= 0.01) return 0;
  return Math.max(
    0,
    Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
      Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)),
  );
}

function verticalRunIsTooClose(
  a: TracePoint,
  b: TracePoint,
  c: TracePoint,
  d: TracePoint,
  minimumSpacing: number,
): boolean {
  const firstVertical = Math.abs(a.x - b.x) < 0.01;
  const secondVertical = Math.abs(c.x - d.x) < 0.01;
  if (!firstVertical || !secondVertical) return false;
  const overlap =
    Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
    Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
  return overlap > 0.01 && Math.abs(a.x - c.x) < minimumSpacing;
}

function segmentsCross(
  a: TracePoint,
  b: TracePoint,
  c: TracePoint,
  d: TracePoint,
): boolean {
  const firstHorizontal = Math.abs(a.y - b.y) < 0.01;
  const secondHorizontal = Math.abs(c.y - d.y) < 0.01;
  if (firstHorizontal === secondHorizontal) return false;
  const horizontalA = firstHorizontal ? a : c;
  const horizontalB = firstHorizontal ? b : d;
  const verticalA = firstHorizontal ? c : a;
  const verticalB = firstHorizontal ? d : b;
  return (
    verticalA.x > Math.min(horizontalA.x, horizontalB.x) &&
    verticalA.x < Math.max(horizontalA.x, horizontalB.x) &&
    horizontalA.y > Math.min(verticalA.y, verticalB.y) &&
    horizontalA.y < Math.max(verticalA.y, verticalB.y)
  );
}

/**
 * Pick the cheapest clear rectilinear connection between two component leads.
 *
 * Candidates include the direct L routes, a central dogleg, the preferred PCB
 * corridor, and every obstacle gutter. Manhattan length dominates the score;
 * bends, crossings, and especially shared copper add progressively larger
 * penalties. This keeps local connections local while retaining neat corridor
 * tracks for paths that genuinely need to cross the board.
 */
export function routeFootprintTrace(
  source: FootprintTraceEndpoint,
  target: FootprintTraceEndpoint,
  options: FootprintRouteOptions = {},
): TracePoint[] | null {
  const sourceSide = options.sourceSide ?? "bottom";
  const targetSide = options.targetSide ?? "top";
  const sourceLead = options.sourceLead ?? 12;
  const targetLead = options.targetLead ?? 12;
  const clearance = options.clearance ?? 8;
  const minimumTraceSpacing = options.minimumTraceSpacing ?? 5;
  const rawObstacles = options.obstacles ?? [];
  const occupied = options.occupied ?? [];
  const owner = options.owner ?? "";
  const group = options.group;
  // Callers remove the actual endpoint cards explicitly. Never discard an
  // unrelated obstacle merely because an overlong lead landed inside it;
  // doing so makes the selected route disappear behind that card.
  const obstacles = rawObstacles;
  const pointInsideObstacle = (point: TracePoint) =>
    obstacles.some(
      (obstacle) =>
        point.x > obstacle.x - clearance &&
        point.x < obstacle.x + obstacle.width + clearance &&
        point.y > obstacle.y - clearance &&
        point.y < obstacle.y + obstacle.height + clearance,
    );
  const safeEscapePoint = (
    endpoint: FootprintTraceEndpoint,
    side: FootprintTraceSide,
    requestedLead: number,
    lateral: number | undefined,
  ): TracePoint | null => {
    for (let lead = requestedLead; lead >= 0; lead -= 1) {
      const point = traceEscapePoint(endpoint, side, lead, lateral);
      if (!pointInsideObstacle(point)) return point;
    }
    return null;
  };
  const start = safeEscapePoint(
    source,
    sourceSide,
    sourceLead,
    options.sourceLateral,
  );
  const end = safeEscapePoint(
    target,
    targetSide,
    targetLead,
    options.targetLateral,
  );
  if (!start || !end) return null;
  const xs = new Set<number>([
    start.x,
    end.x,
    (start.x + end.x) / 2,
  ]);
  const ys = new Set<number>([
    start.y,
    end.y,
    (start.y + end.y) / 2,
  ]);
  if (options.preferredTrackX !== undefined)
    xs.add(options.preferredTrackX);
  for (const obstacle of obstacles) {
    xs.add(obstacle.x - clearance);
    xs.add(obstacle.x + obstacle.width + clearance);
    ys.add(obstacle.y - clearance);
    ys.add(obstacle.y + obstacle.height + clearance);
  }
  // Previously every routed segment contributed two new grid axes. Because
  // each candidate is checked against every occupied segment, that made a
  // late trace dramatically more expensive than an early one and could turn
  // a large dashboard into a million-cell maze. Family tracks already carry
  // the required spacing; retain only the closest few occupied gutters so a
  // local collision still has somewhere deterministic to move.
  const midpointX = (start.x + end.x) / 2;
  const midpointY = (start.y + end.y) / 2;
  occupied
    .filter((segment) => Math.abs(segment.a.x - segment.b.x) < 0.01)
    .sort(
      (a, b) =>
        Math.abs(a.a.x - midpointX) - Math.abs(b.a.x - midpointX),
    )
    .slice(0, 32)
    .forEach((segment) => {
      xs.add(segment.a.x - minimumTraceSpacing);
      xs.add(segment.a.x + minimumTraceSpacing);
    });
  occupied
    .filter((segment) => Math.abs(segment.a.y - segment.b.y) < 0.01)
    .sort(
      (a, b) =>
        Math.abs(a.a.y - midpointY) - Math.abs(b.a.y - midpointY),
    )
    .slice(0, 32)
    .forEach((segment) => {
      ys.add(segment.a.y - minimumTraceSpacing);
      ys.add(segment.a.y + minimumTraceSpacing);
    });
  if (obstacles.length > 0) {
    const outerMargin = 18 + Math.min(120, occupied.length * 3);
    xs.add(Math.min(...obstacles.map((obstacle) => obstacle.x)) - clearance - outerMargin);
    xs.add(
      Math.max(
        ...obstacles.map((obstacle) => obstacle.x + obstacle.width),
      ) + clearance + outerMargin,
    );
    ys.add(Math.min(...obstacles.map((obstacle) => obstacle.y)) - clearance - outerMargin);
    ys.add(
      Math.max(
        ...obstacles.map((obstacle) => obstacle.y + obstacle.height),
      ) + clearance + outerMargin,
    );
  }

  const candidates: TracePoint[][] = [];
  if (Math.abs(start.x - end.x) < 0.01 || Math.abs(start.y - end.y) < 0.01)
    candidates.push([start, end]);
  candidates.push(
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
  );
  for (const x of xs) {
    candidates.push([
      start,
      { x, y: start.y },
      { x, y: end.y },
      end,
    ]);
  }
  for (const y of ys) {
    candidates.push([
      start,
      { x: start.x, y },
      { x: end.x, y },
      end,
    ]);
    if (options.preferredTrackX !== undefined) {
      const trackX = options.preferredTrackX;
      candidates.push(
        [
          start,
          { x: start.x, y },
          { x: trackX, y },
          { x: trackX, y: end.y },
          end,
        ],
        [
          start,
          { x: trackX, y: start.y },
          { x: trackX, y },
          { x: end.x, y },
          end,
        ],
      );
    }
  }
  if (
    options.preferredTrackX !== undefined &&
    options.preferredJunctionY !== undefined
  ) {
    const trackX = options.preferredTrackX;
    const junctionY = options.preferredJunctionY;
    // Fan-in: stay on the source lane until the common rail, then join the
    // highway. Fan-out is the mirror image. These bounded four-bend routes
    // handle card grids without invoking the general A* maze search.
    candidates.push(
      [
        start,
        { x: start.x, y: junctionY },
        { x: trackX, y: junctionY },
        { x: trackX, y: end.y },
        end,
      ],
      [
        start,
        { x: trackX, y: start.y },
        { x: trackX, y: junctionY },
        { x: end.x, y: junctionY },
        end,
      ],
    );
    if (options.preferredApproachTrackX !== undefined) {
      const approachX = options.preferredApproachTrackX;
      candidates.push([
        start,
        { x: approachX, y: start.y },
        { x: approachX, y: junctionY },
        { x: trackX, y: junctionY },
        { x: trackX, y: end.y },
        end,
      ]);
    }
  }

  type ScoredTrace = { points: TracePoint[]; score: number; key: string };
  let best: ScoredTrace | null = null;
  let bestPreferred: ScoredTrace | null = null;
  for (const rawCandidate of candidates) {
    const points = simplifyTrace(rawCandidate);
    if (points.length < 2) continue;
    const segments = points.slice(1).map((point, index) => ({
      a: points[index],
      b: point,
    }));
    const finalSegment = segments.at(-1)!;
    if (
      (options.targetApproachAxis === "horizontal" &&
        Math.abs(finalSegment.a.y - finalSegment.b.y) >= 0.01) ||
      (options.targetApproachAxis === "vertical" &&
        Math.abs(finalSegment.a.x - finalSegment.b.x) >= 0.01)
    ) continue;
    if (
      segments.some(
        ({ a, b }) =>
          !segmentIsClear(a, b, obstacles, clearance),
      )
    ) continue;
    let overlap = 0;
    let crossings = 0;
    let verticalCrowding = false;
    for (const segment of segments) {
      for (const used of occupied) {
        if (used.owner === owner) continue;
        overlap += overlapLength(segment.a, segment.b, used.a, used.b);
        if (
          verticalRunIsTooClose(
            segment.a,
            segment.b,
            used.a,
            used.b,
            minimumTraceSpacing,
          )
        ) verticalCrowding = true;
        if (
          (group === undefined || used.group !== group) &&
          segmentsCross(segment.a, segment.b, used.a, used.b)
        ) crossings += 1;
      }
    }
    if (overlap > 0 || verticalCrowding) continue;
    const length = segments.reduce(
      (sum, segment) => sum + segmentLength(segment.a, segment.b),
      0,
    );
    const bends = Math.max(0, points.length - 2);
    const usesPreferredTrack =
      options.preferredTrackX !== undefined &&
      segments.some(
        ({ a, b }) =>
          Math.abs(a.x - options.preferredTrackX!) < 0.01 &&
          Math.abs(b.x - options.preferredTrackX!) < 0.01,
      );
    const score =
      length +
      bends * (options.bendPenalty ?? 16) +
      crossings * 28 -
      (usesPreferredTrack ? 4 : 0);
    const key = points.map((point) => `${point.x},${point.y}`).join(";");
    const result = { points, score, key };
    if (
      !best ||
      score < best.score - 0.01 ||
      (Math.abs(score - best.score) < 0.01 && key < best.key)
    ) best = result;
    if (
      usesPreferredTrack &&
      (!bestPreferred ||
        score < bestPreferred.score - 0.01 ||
        (Math.abs(score - bestPreferred.score) < 0.01 &&
          key < bestPreferred.key))
    ) bestPreferred = result;
  }
  if (
    bestPreferred &&
    best &&
    bestPreferred.score <=
      best.score + (options.preferredTrackTolerance ?? 0)
  ) return bestPreferred.points;
  if (best) return best.points;

  if (options.allowMazeRouting === false) return null;

  // A component maze can require more than the two bends covered by the fast
  // candidates above. Fall back to A* on the obstacle-gutter grid. The grid is
  // sparse (only endpoint, corridor, and obstacle boundary coordinates), so
  // this handles irregular dashboards without paying pixel-grid costs.
  const gridXs = [...xs].sort((a, b) => a - b);
  const gridYs = [...ys].sort((a, b) => a - b);
  const startX = gridXs.findIndex((value) => Math.abs(value - start.x) < 0.01);
  const startY = gridYs.findIndex((value) => Math.abs(value - start.y) < 0.01);
  const endX = gridXs.findIndex((value) => Math.abs(value - end.x) < 0.01);
  const endY = gridYs.findIndex((value) => Math.abs(value - end.y) < 0.01);
  type Direction = "n" | "h" | "v";
  interface SearchState {
    x: number;
    y: number;
    direction: Direction;
    cost: number;
    estimate: number;
    key: string;
  }
  const stateKey = (x: number, y: number, direction: Direction) =>
    `${x}:${y}:${direction}`;
  const heap: SearchState[] = [];
  const push = (state: SearchState) => {
    heap.push(state);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (heap[parent].estimate <= state.estimate) break;
      heap[index] = heap[parent];
      index = parent;
    }
    heap[index] = state;
  };
  const pop = (): SearchState | undefined => {
    const first = heap[0];
    const last = heap.pop();
    if (!first || !last || heap.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= heap.length) break;
      const child =
        right < heap.length && heap[right].estimate < heap[left].estimate
          ? right
          : left;
      if (heap[child].estimate >= last.estimate) break;
      heap[index] = heap[child];
      index = child;
    }
    heap[index] = last;
    return first;
  };
  const costs = new Map<string, number>();
  const previous = new Map<string, string>();
  const startKey = stateKey(startX, startY, "n");
  costs.set(startKey, 0);
  push({
    x: startX,
    y: startY,
    direction: "n",
    cost: 0,
    estimate: segmentLength(start, end),
    key: startKey,
  });
  let goal: SearchState | null = null;
  const maxMazeStates = Math.max(0, options.maxMazeStates ?? 2_500);
  let visitedStates = 0;
  while (heap.length > 0 && visitedStates < maxMazeStates) {
    const current = pop()!;
    if (current.cost > (costs.get(current.key) ?? Number.POSITIVE_INFINITY))
      continue;
    visitedStates += 1;
    if (current.x === endX && current.y === endY) {
      const requiredDirection =
        options.targetApproachAxis === "horizontal"
          ? "h"
          : options.targetApproachAxis === "vertical"
            ? "v"
            : undefined;
      if (!requiredDirection || current.direction === requiredDirection) {
        goal = current;
        break;
      }
    }
    const neighbors = [
      [current.x - 1, current.y, "h"],
      [current.x + 1, current.y, "h"],
      [current.x, current.y - 1, "v"],
      [current.x, current.y + 1, "v"],
    ] as const;
    const a = { x: gridXs[current.x], y: gridYs[current.y] };
    for (const [nextX, nextY, direction] of neighbors) {
      if (
        nextX < 0 ||
        nextY < 0 ||
        nextX >= gridXs.length ||
        nextY >= gridYs.length
      ) continue;
      const b = { x: gridXs[nextX], y: gridYs[nextY] };
      if (!segmentIsClear(a, b, obstacles, clearance)) continue;
      let overlap = 0;
      let crossings = 0;
      let verticalCrowding = false;
      for (const used of occupied) {
        if (used.owner === owner) continue;
        overlap += overlapLength(a, b, used.a, used.b);
        if (
          verticalRunIsTooClose(
            a,
            b,
            used.a,
            used.b,
            minimumTraceSpacing,
          )
        ) verticalCrowding = true;
        if (
          (group === undefined || used.group !== group) &&
          segmentsCross(a, b, used.a, used.b)
        )
          crossings += 1;
      }
      if (overlap > 0 || verticalCrowding) continue;
      const nextCost =
        current.cost +
        segmentLength(a, b) +
        (current.direction !== "n" && current.direction !== direction
          ? options.bendPenalty ?? 16
          : 0) +
        crossings * 28;
      const key = stateKey(nextX, nextY, direction);
      if (nextCost >= (costs.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      costs.set(key, nextCost);
      previous.set(key, current.key);
      push({
        x: nextX,
        y: nextY,
        direction,
        cost: nextCost,
        estimate: nextCost + segmentLength(b, end),
        key,
      });
    }
  }
  if (!goal) return null;
  const reversed: TracePoint[] = [];
  let cursor: string | undefined = goal.key;
  while (cursor) {
    const [x, y] = cursor.split(":").map(Number);
    reversed.push({ x: gridXs[x], y: gridYs[y] });
    cursor = previous.get(cursor);
  }
  return simplifyTrace(reversed.reverse());
}

/**
 * Build a monotonic lead into a vertical PCB track. Short local jumps stay on
 * the routed-edge fallback: forcing them through a highway would make the two
 * leads pass one another and render as a spike or 180-degree reversal.
 */
export function footprintTracewayWaypoints(
  source: FootprintTraceEndpoint,
  target: FootprintTraceEndpoint,
  trackX: number,
  sourceSide: FootprintTraceSide = "bottom",
  targetSide: FootprintTraceSide = "top",
  minimumClearance = 40,
  rails?: FootprintTraceRails,
): { x: number; y: number }[] | null {
  const deltaY = target.y - source.y;
  if (deltaY === 0) return null;
  const direction = deltaY > 0 ? 1 : -1;
  const clearance =
    Math.abs(deltaY) - source.height / 2 - target.height / 2;
  if (clearance < minimumClearance) return null;
  const defaultLead = Math.min(16, clearance / 2);
  let sourceLead = rails?.sourceLead ?? defaultLead;
  let targetLead = rails?.targetLead ?? defaultLead;
  const requestedLead = sourceLead + targetLead;
  if (requestedLead > clearance && requestedLead > 0) {
    const scale = clearance / requestedLead;
    sourceLead *= scale;
    targetLead *= scale;
  }
  const sourceEscape = traceEscapePoint(
    source,
    sourceSide,
    sourceLead,
    rails?.sourceLateral,
  );
  const targetEscape = traceEscapePoint(
    target,
    targetSide,
    targetLead,
    rails?.targetLateral,
  );
  const sourceFacesTrack =
    (sourceSide !== "left" || trackX <= sourceEscape.x) &&
    (sourceSide !== "right" || trackX >= sourceEscape.x);
  const targetFacesTrack =
    (targetSide !== "left" || trackX <= targetEscape.x) &&
    (targetSide !== "right" || trackX >= targetEscape.x);
  if (
    !sourceFacesTrack ||
    !targetFacesTrack ||
    (direction > 0 && sourceEscape.y > targetEscape.y) ||
    (direction < 0 && sourceEscape.y < targetEscape.y)
  ) {
    return null;
  }
  return [
    sourceEscape,
    { x: trackX, y: sourceEscape.y },
    { x: trackX, y: targetEscape.y },
    targetEscape,
  ];
}
