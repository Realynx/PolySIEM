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

interface HighwayScore {
  x: number;
  coverage: number;
  detour: number;
  centerDistance: number;
}

function scoreHighway(
  x: number,
  members: readonly FootprintHighwayMember[],
  visualCenter: number,
): HighwayScore {
  let coverage = 0;
  let detour = 0;
  for (const member of members) {
    const direct = Math.abs(member.sourceX - member.targetX);
    const via = Math.abs(member.sourceX - x) + Math.abs(member.targetX - x);
    const extra = Math.max(0, via - direct);
    if (extra <= Math.max(36, Math.min(72, direct * 0.2))) coverage += 1;
    detour += extra;
  }
  return { x, coverage, detour, centerDistance: Math.abs(x - visualCenter) };
}

function highwayScoreIsBetter(candidate: HighwayScore, best: HighwayScore | null): boolean {
  if (!best || candidate.coverage !== best.coverage)
    return !best || candidate.coverage > best.coverage;
  if (Math.abs(candidate.detour - best.detour) >= 0.01)
    return candidate.detour < best.detour;
  if (Math.abs(candidate.centerDistance - best.centerDistance) >= 0.01)
    return candidate.centerDistance < best.centerDistance;
  return candidate.x < best.x;
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
  let best: HighwayScore | null = null;
  for (const x of axes) {
    if (!isCandidateClear(x)) continue;
    const candidate = scoreHighway(x, members, visualCenter);
    if (highwayScoreIsBetter(candidate, best)) best = candidate;
  }
  return best?.x ?? null;
}

function traceFacesTrack(side: FootprintTraceSide, escapeX: number, trackX: number): boolean {
  if (side === "left") return trackX <= escapeX;
  if (side === "right") return trackX >= escapeX;
  return true;
}

function escapesAreOrdered(
  direction: number,
  sourceEscape: TracePoint,
  targetEscape: TracePoint,
): boolean {
  return direction > 0
    ? sourceEscape.y <= targetEscape.y
    : sourceEscape.y >= targetEscape.y;
}

function scaledTraceLeads(
  rails: FootprintTraceRails | undefined,
  defaultLead: number,
  clearance: number,
): { sourceLead: number; targetLead: number } {
  let sourceLead = rails?.sourceLead ?? defaultLead;
  let targetLead = rails?.targetLead ?? defaultLead;
  const requestedLead = sourceLead + targetLead;
  if (requestedLead <= clearance || requestedLead <= 0) return { sourceLead, targetLead };
  const scale = clearance / requestedLead;
  sourceLead *= scale;
  targetLead *= scale;
  return { sourceLead, targetLead };
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

interface ResolvedRouteOptions {
  sourceSide: FootprintTraceSide;
  targetSide: FootprintTraceSide;
  sourceLead: number;
  targetLead: number;
  clearance: number;
  minimumTraceSpacing: number;
  obstacles: readonly FootprintRouteObstacle[];
  occupied: readonly FootprintRouteSegment[];
  owner: string;
  group: string | undefined;
}

function resolveRouteOptions(options: FootprintRouteOptions): ResolvedRouteOptions {
  return {
    sourceSide: options.sourceSide ?? "bottom",
    targetSide: options.targetSide ?? "top",
    sourceLead: options.sourceLead ?? 12,
    targetLead: options.targetLead ?? 12,
    clearance: options.clearance ?? 8,
    minimumTraceSpacing: options.minimumTraceSpacing ?? 5,
    obstacles: options.obstacles ?? [],
    occupied: options.occupied ?? [],
    owner: options.owner ?? "",
    group: options.group,
  };
}

function safeTraceEscape(
  endpoint: FootprintTraceEndpoint,
  side: FootprintTraceSide,
  requestedLead: number,
  lateral: number | undefined,
  obstacles: readonly FootprintRouteObstacle[],
  clearance: number,
): TracePoint | null {
  const isBlocked = (point: TracePoint) => obstacles.some((obstacle) =>
    point.x > obstacle.x - clearance &&
    point.x < obstacle.x + obstacle.width + clearance &&
    point.y > obstacle.y - clearance &&
    point.y < obstacle.y + obstacle.height + clearance);
  for (let lead = requestedLead; lead >= 0; lead -= 1) {
    const point = traceEscapePoint(endpoint, side, lead, lateral);
    if (!isBlocked(point)) return point;
  }
  return null;
}

function routeAxes(
  start: TracePoint,
  end: TracePoint,
  options: FootprintRouteOptions,
  resolved: ResolvedRouteOptions,
): { xs: Set<number>; ys: Set<number> } {
  const { obstacles, occupied, clearance, minimumTraceSpacing } = resolved;
  const xs = new Set<number>([start.x, end.x, (start.x + end.x) / 2]);
  const ys = new Set<number>([start.y, end.y, (start.y + end.y) / 2]);
  if (options.preferredTrackX !== undefined) xs.add(options.preferredTrackX);
  for (const obstacle of obstacles) {
    xs.add(obstacle.x - clearance);
    xs.add(obstacle.x + obstacle.width + clearance);
    ys.add(obstacle.y - clearance);
    ys.add(obstacle.y + obstacle.height + clearance);
  }
  const midpointX = (start.x + end.x) / 2;
  const midpointY = (start.y + end.y) / 2;
  occupied
    .filter((segment) => Math.abs(segment.a.x - segment.b.x) < 0.01)
    .sort((a, b) => Math.abs(a.a.x - midpointX) - Math.abs(b.a.x - midpointX))
    .slice(0, 32)
    .forEach((segment) => {
      xs.add(segment.a.x - minimumTraceSpacing);
      xs.add(segment.a.x + minimumTraceSpacing);
    });
  occupied
    .filter((segment) => Math.abs(segment.a.y - segment.b.y) < 0.01)
    .sort((a, b) => Math.abs(a.a.y - midpointY) - Math.abs(b.a.y - midpointY))
    .slice(0, 32)
    .forEach((segment) => {
      ys.add(segment.a.y - minimumTraceSpacing);
      ys.add(segment.a.y + minimumTraceSpacing);
    });
  addOuterRouteAxes(xs, ys, obstacles, occupied.length, clearance);
  return { xs, ys };
}

function addOuterRouteAxes(
  xs: Set<number>,
  ys: Set<number>,
  obstacles: readonly FootprintRouteObstacle[],
  occupiedCount: number,
  clearance: number,
): void {
  if (obstacles.length === 0) return;
  const outerMargin = 18 + Math.min(120, occupiedCount * 3);
  xs.add(Math.min(...obstacles.map((obstacle) => obstacle.x)) - clearance - outerMargin);
  xs.add(Math.max(...obstacles.map((obstacle) => obstacle.x + obstacle.width)) + clearance + outerMargin);
  ys.add(Math.min(...obstacles.map((obstacle) => obstacle.y)) - clearance - outerMargin);
  ys.add(Math.max(...obstacles.map((obstacle) => obstacle.y + obstacle.height)) + clearance + outerMargin);
}

function routeCandidates(
  start: TracePoint,
  end: TracePoint,
  xs: ReadonlySet<number>,
  ys: ReadonlySet<number>,
  options: FootprintRouteOptions,
): TracePoint[][] {
  const candidates: TracePoint[][] = [];
  if (Math.abs(start.x - end.x) < 0.01 || Math.abs(start.y - end.y) < 0.01)
    candidates.push([start, end]);
  candidates.push(
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
  );
  for (const x of xs)
    candidates.push([start, { x, y: start.y }, { x, y: end.y }, end]);
  for (const y of ys) addHorizontalCandidates(candidates, start, end, y, options.preferredTrackX);
  addJunctionCandidates(candidates, start, end, options);
  return candidates;
}

function addHorizontalCandidates(
  candidates: TracePoint[][],
  start: TracePoint,
  end: TracePoint,
  y: number,
  preferredTrackX: number | undefined,
): void {
  candidates.push([start, { x: start.x, y }, { x: end.x, y }, end]);
  if (preferredTrackX === undefined) return;
  candidates.push(
    [start, { x: start.x, y }, { x: preferredTrackX, y }, { x: preferredTrackX, y: end.y }, end],
    [start, { x: preferredTrackX, y: start.y }, { x: preferredTrackX, y }, { x: end.x, y }, end],
  );
}

function addJunctionCandidates(
  candidates: TracePoint[][],
  start: TracePoint,
  end: TracePoint,
  options: FootprintRouteOptions,
): void {
  const trackX = options.preferredTrackX;
  const junctionY = options.preferredJunctionY;
  if (trackX === undefined || junctionY === undefined) return;
  candidates.push(
    [start, { x: start.x, y: junctionY }, { x: trackX, y: junctionY }, { x: trackX, y: end.y }, end],
    [start, { x: trackX, y: start.y }, { x: trackX, y: junctionY }, { x: end.x, y: junctionY }, end],
  );
  if (options.preferredApproachTrackX === undefined) return;
  const approachX = options.preferredApproachTrackX;
  candidates.push([start, { x: approachX, y: start.y }, { x: approachX, y: junctionY },
    { x: trackX, y: junctionY }, { x: trackX, y: end.y }, end]);
}

interface ScoredTrace {
  points: TracePoint[];
  score: number;
  key: string;
  usesPreferredTrack: boolean;
}

function traceCollisionMetrics(
  segments: readonly { a: TracePoint; b: TracePoint }[],
  resolved: ResolvedRouteOptions,
): { overlap: number; crossings: number; verticalCrowding: boolean } {
  let overlap = 0;
  let crossings = 0;
  let verticalCrowding = false;
  for (const segment of segments) {
    for (const used of resolved.occupied) {
      if (used.owner === resolved.owner) continue;
      overlap += overlapLength(segment.a, segment.b, used.a, used.b);
      if (verticalRunIsTooClose(segment.a, segment.b, used.a, used.b, resolved.minimumTraceSpacing))
        verticalCrowding = true;
      if ((resolved.group === undefined || used.group !== resolved.group) &&
        segmentsCross(segment.a, segment.b, used.a, used.b)) crossings += 1;
    }
  }
  return { overlap, crossings, verticalCrowding };
}

function scoreTraceCandidate(
  rawCandidate: readonly TracePoint[],
  options: FootprintRouteOptions,
  resolved: ResolvedRouteOptions,
): ScoredTrace | null {
  const points = simplifyTrace(rawCandidate);
  if (points.length < 2) return null;
  const segments = points.slice(1).map((point, index) => ({ a: points[index], b: point }));
  const finalSegment = segments.at(-1)!;
  if (options.targetApproachAxis === "horizontal" &&
    Math.abs(finalSegment.a.y - finalSegment.b.y) >= 0.01) return null;
  if (options.targetApproachAxis === "vertical" &&
    Math.abs(finalSegment.a.x - finalSegment.b.x) >= 0.01) return null;
  if (segments.some(({ a, b }) => !segmentIsClear(a, b, resolved.obstacles, resolved.clearance)))
    return null;
  const collision = traceCollisionMetrics(segments, resolved);
  if (collision.overlap > 0 || collision.verticalCrowding) return null;
  const length = segments.reduce((sum, segment) => sum + segmentLength(segment.a, segment.b), 0);
  const usesPreferredTrack = options.preferredTrackX !== undefined && segments.some(({ a, b }) =>
    Math.abs(a.x - options.preferredTrackX!) < 0.01 &&
    Math.abs(b.x - options.preferredTrackX!) < 0.01);
  const score = length + Math.max(0, points.length - 2) * (options.bendPenalty ?? 16) +
    collision.crossings * 28 - (usesPreferredTrack ? 4 : 0);
  return { points, score, key: points.map((point) => `${point.x},${point.y}`).join(";"), usesPreferredTrack };
}

function scoredTraceIsBetter(candidate: ScoredTrace, best: ScoredTrace | null): boolean {
  return !best || candidate.score < best.score - 0.01 ||
    (Math.abs(candidate.score - best.score) < 0.01 && candidate.key < best.key);
}

function bestTraceCandidate(
  candidates: readonly TracePoint[][],
  options: FootprintRouteOptions,
  resolved: ResolvedRouteOptions,
): TracePoint[] | null {
  let best: ScoredTrace | null = null;
  let bestPreferred: ScoredTrace | null = null;
  for (const rawCandidate of candidates) {
    const candidate = scoreTraceCandidate(rawCandidate, options, resolved);
    if (!candidate) continue;
    if (scoredTraceIsBetter(candidate, best)) best = candidate;
    if (candidate.usesPreferredTrack && scoredTraceIsBetter(candidate, bestPreferred))
      bestPreferred = candidate;
  }
  if (bestPreferred && best &&
    bestPreferred.score <= best.score + (options.preferredTrackTolerance ?? 0))
    return bestPreferred.points;
  return best?.points ?? null;
}

type SearchDirection = "n" | "h" | "v";
interface SearchState {
  x: number;
  y: number;
  direction: SearchDirection;
  cost: number;
  estimate: number;
  key: string;
}

const searchStateKey = (x: number, y: number, direction: SearchDirection) =>
  `${x}:${y}:${direction}`;

function pushSearchState(heap: SearchState[], state: SearchState): void {
  heap.push(state);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent].estimate <= state.estimate) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = state;
}

function popSearchState(heap: SearchState[]): SearchState | undefined {
  const first = heap[0];
  const last = heap.pop();
  if (!first || !last || heap.length === 0) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= heap.length) break;
    const child = right < heap.length && heap[right].estimate < heap[left].estimate ? right : left;
    if (heap[child].estimate >= last.estimate) break;
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = last;
  return first;
}

interface MazeContext {
  gridXs: number[];
  gridYs: number[];
  end: TracePoint;
  options: FootprintRouteOptions;
  resolved: ResolvedRouteOptions;
  costs: Map<string, number>;
  previous: Map<string, string>;
  heap: SearchState[];
}

function visitMazeNeighbor(
  current: SearchState,
  nextX: number,
  nextY: number,
  direction: SearchDirection,
  context: MazeContext,
): void {
  const { gridXs, gridYs, resolved } = context;
  if (nextX < 0 || nextY < 0 || nextX >= gridXs.length || nextY >= gridYs.length) return;
  const a = { x: gridXs[current.x], y: gridYs[current.y] };
  const b = { x: gridXs[nextX], y: gridYs[nextY] };
  if (!segmentIsClear(a, b, resolved.obstacles, resolved.clearance)) return;
  const collision = traceCollisionMetrics([{ a, b }], resolved);
  if (collision.overlap > 0 || collision.verticalCrowding) return;
  const bend = current.direction !== "n" && current.direction !== direction
    ? context.options.bendPenalty ?? 16
    : 0;
  const nextCost = current.cost + segmentLength(a, b) + bend + collision.crossings * 28;
  const key = searchStateKey(nextX, nextY, direction);
  if (nextCost >= (context.costs.get(key) ?? Number.POSITIVE_INFINITY)) return;
  context.costs.set(key, nextCost);
  context.previous.set(key, current.key);
  pushSearchState(context.heap, {
    x: nextX,
    y: nextY,
    direction,
    cost: nextCost,
    estimate: nextCost + segmentLength(b, context.end),
    key,
  });
}

function mazeGoalReached(
  current: SearchState,
  endX: number,
  endY: number,
  targetApproachAxis: FootprintRouteOptions["targetApproachAxis"],
): boolean {
  if (current.x !== endX || current.y !== endY) return false;
  if (targetApproachAxis === "horizontal") return current.direction === "h";
  if (targetApproachAxis === "vertical") return current.direction === "v";
  return true;
}

function reconstructMazeRoute(
  goal: SearchState,
  previous: ReadonlyMap<string, string>,
  gridXs: readonly number[],
  gridYs: readonly number[],
): TracePoint[] {
  const reversed: TracePoint[] = [];
  let cursor: string | undefined = goal.key;
  while (cursor) {
    const [x, y] = cursor.split(":").map(Number);
    reversed.push({ x: gridXs[x], y: gridYs[y] });
    cursor = previous.get(cursor);
  }
  return simplifyTrace(reversed.reverse());
}

function routeTraceMaze(
  start: TracePoint,
  end: TracePoint,
  xs: ReadonlySet<number>,
  ys: ReadonlySet<number>,
  options: FootprintRouteOptions,
  resolved: ResolvedRouteOptions,
): TracePoint[] | null {
  const gridXs = [...xs].sort((a, b) => a - b);
  const gridYs = [...ys].sort((a, b) => a - b);
  const startX = gridXs.findIndex((value) => Math.abs(value - start.x) < 0.01);
  const startY = gridYs.findIndex((value) => Math.abs(value - start.y) < 0.01);
  const endX = gridXs.findIndex((value) => Math.abs(value - end.x) < 0.01);
  const endY = gridYs.findIndex((value) => Math.abs(value - end.y) < 0.01);
  const heap: SearchState[] = [];
  const costs = new Map<string, number>();
  const previous = new Map<string, string>();
  const startKey = searchStateKey(startX, startY, "n");
  costs.set(startKey, 0);
  pushSearchState(heap, { x: startX, y: startY, direction: "n", cost: 0,
    estimate: segmentLength(start, end), key: startKey });
  const context: MazeContext = { gridXs, gridYs, end, options, resolved, costs, previous, heap };
  const maxMazeStates = Math.max(0, options.maxMazeStates ?? 2_500);
  let visitedStates = 0;
  while (heap.length > 0 && visitedStates < maxMazeStates) {
    const current = popSearchState(heap)!;
    if (current.cost > (costs.get(current.key) ?? Number.POSITIVE_INFINITY)) continue;
    visitedStates += 1;
    if (mazeGoalReached(current, endX, endY, options.targetApproachAxis))
      return reconstructMazeRoute(current, previous, gridXs, gridYs);
    visitMazeNeighbor(current, current.x - 1, current.y, "h", context);
    visitMazeNeighbor(current, current.x + 1, current.y, "h", context);
    visitMazeNeighbor(current, current.x, current.y - 1, "v", context);
    visitMazeNeighbor(current, current.x, current.y + 1, "v", context);
  }
  return null;
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
  const resolved = resolveRouteOptions(options);
  const { sourceSide, targetSide, sourceLead, targetLead, clearance, obstacles } = resolved;
  const start = safeTraceEscape(
    source,
    sourceSide,
    sourceLead,
    options.sourceLateral,
    obstacles,
    clearance,
  );
  const end = safeTraceEscape(
    target,
    targetSide,
    targetLead,
    options.targetLateral,
    obstacles,
    clearance,
  );
  if (!start || !end) return null;
  const { xs, ys } = routeAxes(start, end, options, resolved);

  const candidates = routeCandidates(start, end, xs, ys, options);

  const fastRoute = bestTraceCandidate(candidates, options, resolved);
  if (fastRoute) return fastRoute;

  if (options.allowMazeRouting === false) return null;

  return routeTraceMaze(start, end, xs, ys, options, resolved);
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
  const { sourceLead, targetLead } = scaledTraceLeads(rails, defaultLead, clearance);
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
  const sourceFacesTrack = traceFacesTrack(sourceSide, sourceEscape.x, trackX);
  const targetFacesTrack = traceFacesTrack(targetSide, targetEscape.x, trackX);
  if (!sourceFacesTrack || !targetFacesTrack || !escapesAreOrdered(direction, sourceEscape, targetEscape)) {
    return null;
  }
  return [
    sourceEscape,
    { x: trackX, y: sourceEscape.y },
    { x: trackX, y: targetEscape.y },
    targetEscape,
  ];
}
