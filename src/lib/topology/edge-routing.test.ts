import { describe, expect, it } from "vitest";
import {
  bundleBy,
  dagreRoute,
  dedupePoints,
  deformWaypoints,
  directedKey,
  endpointOffsets,
  interiorWaypoints,
  orthogonalPolyline,
  pointAlongPolyline,
  polylinePath,
  roundedPolylinePath,
  simplifyPolyline,
  smoothPath,
  undirectedKey,
  type Pt,
} from "./edge-routing";

/** Count non-overlapping occurrences of a substring. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("dedupePoints", () => {
  it("drops consecutive duplicates but keeps distinct points", () => {
    const pts: Pt[] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ];
    expect(dedupePoints(pts)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
  });

  it("keeps a non-consecutive repeat (a genuine loop-back point)", () => {
    const pts: Pt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(dedupePoints(pts)).toHaveLength(3);
  });

  it("returns fresh point objects (no shared references)", () => {
    const input: Pt[] = [{ x: 1, y: 2 }];
    const out = dedupePoints(input);
    expect(out[0]).not.toBe(input[0]);
    expect(out[0]).toEqual(input[0]);
  });
});

describe("interiorWaypoints", () => {
  it("returns [] for nullish / short inputs (nothing to route around)", () => {
    expect(interiorWaypoints(undefined)).toEqual([]);
    expect(interiorWaypoints(null)).toEqual([]);
    expect(interiorWaypoints([])).toEqual([]);
    expect(interiorWaypoints([{ x: 0, y: 0 }])).toEqual([]);
    expect(
      interiorWaypoints([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toEqual([]);
  });

  it("drops the boundary endpoints, keeping only interior bends", () => {
    const pts: Pt[] = [
      { x: 0, y: 0 }, // source boundary
      { x: 5, y: 2 },
      { x: 8, y: 4 },
      { x: 12, y: 6 }, // target boundary
    ];
    expect(interiorWaypoints(pts)).toEqual([
      { x: 5, y: 2 },
      { x: 8, y: 4 },
    ]);
  });

  it("copies points so callers can't mutate dagre's internals", () => {
    const pts: Pt[] = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 10 },
    ];
    const out = interiorWaypoints(pts);
    expect(out[0]).not.toBe(pts[1]);
    expect(out).toEqual([{ x: 5, y: 5 }]);
  });
});

describe("live dagre route deformation", () => {
  it("keeps boundary anchors alongside copied interior waypoints", () => {
    const route = dagreRoute([
      { x: 0, y: 0 },
      { x: 50, y: 20 },
      { x: 100, y: 0 },
    ]);
    expect(route).toEqual({
      sourceAnchor: { x: 0, y: 0 },
      targetAnchor: { x: 100, y: 0 },
      waypoints: [{ x: 50, y: 20 }],
    });
  });

  it("carries a midpoint halfway with a moved target", () => {
    expect(
      deformWaypoints(
        [{ x: 50, y: 0 }],
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ),
    ).toEqual([{ x: 100, y: 0 }]);
  });

  it("translates the whole corridor when both endpoints move together", () => {
    expect(
      deformWaypoints(
        [{ x: 50, y: 25 }],
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 10, y: 30 },
        { x: 110, y: 30 },
      ),
    ).toEqual([{ x: 60, y: 55 }]);
  });
});

describe("rounded polylines", () => {
  it("drops redundant collinear bends", () => {
    expect(
      simplifyPolyline([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it("keeps a collinear reversal because it is a real bend", () => {
    expect(
      simplifyPolyline([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 0 },
      ]),
    ).toHaveLength(3);
  });

  it("rounds locally with quadratics and still lands on the endpoint", () => {
    const path = roundedPolylinePath([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ]);
    expect(path).toBe("M 0,0 L 12,0 Q 20,0 20,8 L 20,20");
    expect(path).not.toContain(" C ");
  });

  it("places a midpoint by distance rather than waypoint index", () => {
    expect(
      pointAlongPolyline([
        { x: 0, y: 0 },
        { x: 80, y: 0 },
        { x: 80, y: 20 },
      ]),
    ).toEqual({ x: 50, y: 0 });
  });
});

describe("orthogonal polylines", () => {
  it("inserts right-angle elbows into diagonal joins", () => {
    const points = orthogonalPolyline([
      { x: 0, y: 0 },
      { x: 0, y: 12 },
      { x: 40, y: 27 },
      { x: 80, y: 27 },
    ]);

    for (let index = 1; index < points.length; index += 1) {
      expect(
        points[index - 1].x === points[index].x ||
          points[index - 1].y === points[index].y,
      ).toBe(true);
    }
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 27 },
      { x: 80, y: 27 },
    ]);
  });

  it("continues the explicit initial axis before turning", () => {
    expect(
      orthogonalPolyline(
        [
          { x: 0, y: 0 },
          { x: 20, y: 30 },
        ],
        "horizontal",
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 30 },
    ]);
  });

  it("renders only sharp move/line commands", () => {
    const path = polylinePath(
      orthogonalPolyline([
        { x: 0, y: 0 },
        { x: 20, y: 10 },
        { x: 40, y: 10 },
      ]),
    );
    expect(path).toBe("M 0,0 L 20,0 L 20,10 L 40,10");
    expect(path).not.toMatch(/[QC]/);
  });
});

describe("endpointOffsets", () => {
  it("fans shared endpoints into deterministic centered lanes", () => {
    const offsets = endpointOffsets([
      { id: "first", source: "hub", target: "a" },
      { id: "middle", source: "hub", target: "b" },
      { id: "last", source: "hub", target: "c" },
    ]);
    expect(offsets.get("first")?.sourceOffset).toBe(-8);
    expect(offsets.get("middle")?.sourceOffset).toBe(0);
    expect(offsets.get("last")?.sourceOffset).toBe(8);
  });

  it("separates fan-in independently from fan-out", () => {
    const offsets = endpointOffsets([
      { id: "a", source: "a", target: "hub" },
      { id: "b", source: "b", target: "hub" },
    ]);
    expect(offsets.get("a")?.targetOffset).toBe(-4);
    expect(offsets.get("b")?.targetOffset).toBe(4);
    expect(offsets.get("a")?.sourceOffset).toBe(0);
  });
});

describe("smoothPath", () => {
  it("returns an empty string for no points", () => {
    expect(smoothPath([])).toBe("");
  });

  it("returns a bare moveto for a single point", () => {
    expect(smoothPath([{ x: 3, y: 7 }])).toBe("M 3,7");
  });

  it("returns a straight line for two points", () => {
    expect(
      smoothPath([
        { x: 0, y: 0 },
        { x: 10, y: 20 },
      ]),
    ).toBe("M 0,0 L 10,20");
  });

  it("collapses to a straight line when points dedupe to two", () => {
    const path = smoothPath([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 20 },
    ]);
    expect(path).toBe("M 0,0 L 10,20");
  });

  it("builds one cubic segment per gap and passes through the endpoints", () => {
    const pts: Pt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    const path = smoothPath(pts);
    expect(path.startsWith("M 0,0")).toBe(true);
    // N points -> N-1 curve segments.
    expect(occurrences(path, " C ")).toBe(2);
    // Final curve lands exactly on the last waypoint.
    expect(path.endsWith("20,0")).toBe(true);
  });

  it("scales the number of curves with the number of waypoints", () => {
    const pts: Pt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
      { x: 30, y: 5 },
      { x: 40, y: 0 },
    ];
    const path = smoothPath(pts);
    expect(occurrences(path, " C ")).toBe(4);
    expect(path.endsWith("40,0")).toBe(true);
  });

  it("stays finite (no NaN) for collinear points", () => {
    const pts: Pt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    const path = smoothPath(pts);
    expect(path).not.toMatch(/NaN/);
    expect(occurrences(path, " C ")).toBe(3);
    expect(path.endsWith("30,0")).toBe(true);
  });

  it("clamps floats to two decimals", () => {
    const path = smoothPath([{ x: 0.123456, y: 9.87654 }]);
    expect(path).toBe("M 0.12,9.88");
  });
});

describe("bundleBy", () => {
  it("returns [] for no items", () => {
    expect(bundleBy([], () => "k")).toEqual([]);
  });

  it("wraps a single item as a count-1 bundle", () => {
    const bundles = bundleBy([{ id: "a" }], (x) => x.id);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].count).toBe(1);
    expect(bundles[0].primary).toEqual({ id: "a" });
    expect(bundles[0].key).toBe("a");
  });

  it("collapses items that share a key, keeping input order and the first as primary", () => {
    const items = [
      { id: "u1", pair: "x" },
      { id: "u2", pair: "x" },
      { id: "u3", pair: "x" },
    ];
    const bundles = bundleBy(items, (x) => x.pair);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].count).toBe(3);
    expect(bundles[0].primary.id).toBe("u1");
    expect(bundles[0].items.map((i) => i.id)).toEqual(["u1", "u2", "u3"]);
  });

  it("keeps distinct keys as separate bundles in first-seen order", () => {
    const items = [
      { id: "a", pair: "p2" },
      { id: "b", pair: "p1" },
      { id: "c", pair: "p2" },
      { id: "d", pair: "p1" },
      { id: "e", pair: "p3" },
    ];
    const bundles = bundleBy(items, (x) => x.pair);
    expect(bundles.map((b) => b.key)).toEqual(["p2", "p1", "p3"]);
    expect(bundles.map((b) => b.count)).toEqual([2, 2, 1]);
  });
});

describe("pair keys", () => {
  it("undirectedKey is order-independent", () => {
    expect(undirectedKey("a", "b")).toBe(undirectedKey("b", "a"));
    expect(undirectedKey("a", "b")).not.toBe(undirectedKey("a", "c"));
  });

  it("directedKey preserves direction", () => {
    expect(directedKey("a", "b")).not.toBe(directedKey("b", "a"));
    expect(directedKey("a", "b")).toBe(directedKey("a", "b"));
  });
});
