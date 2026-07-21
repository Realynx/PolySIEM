import { describe, expect, it } from "vitest";
import {
  footprintTraceCorridorWidth,
  footprintTraceTrackX,
  footprintTracewayWaypoints,
  packFootprintCircuitBanks,
  packFootprintLanes,
  type FootprintLayoutBox,
} from "./footprint-layout";

const boxes: FootprintLayoutBox[] = Array.from({ length: 8 }, (_, index) => ({
  id: `lane-${index}`,
  width: 420,
  height: index % 3 === 0 ? 220 : 140,
  category: index < 4 ? "lan" : "other",
}));

describe("footprint lane packing", () => {
  it("uses horizontal space to avoid a single tall lane stack", () => {
    const packed = packFootprintLanes(boxes, { centerX: 500, startY: 200 });
    const stackedHeight = boxes.reduce((sum, box) => sum + box.height, 0) + (boxes.length - 1) * 28;
    expect(packed.columns).toBeGreaterThan(1);
    expect(packed.height).toBeLessThan(stackedHeight * 0.7);
  });

  it("returns non-overlapping positions with a stable center", () => {
    const packed = packFootprintLanes(boxes, { centerX: 500, startY: 200 });
    expect(packed.left + packed.width / 2).toBe(500);
    const rectangles = boxes.map((box) => ({ ...box, ...packed.positions.get(box.id)! }));
    for (let a = 0; a < rectangles.length; a += 1) {
      for (let b = a + 1; b < rectangles.length; b += 1) {
        const one = rectangles[a];
        const two = rectangles[b];
        const overlaps = one.x < two.x + two.width && one.x + one.width > two.x && one.y < two.y + two.height && one.y + one.height > two.y;
        expect(overlaps).toBe(false);
      }
    }
  });
});

describe("footprint PCB bank packing", () => {
  const circuitBoxes = boxes.slice(0, 6).map((box, index) => ({
    ...box,
    traceWeight: 12 - index,
  }));

  it("reserves an empty central trace corridor", () => {
    const packed = packFootprintCircuitBanks(circuitBoxes, {
      centerX: 500,
      startY: 200,
      corridorWidth: 160,
    });
    expect(packed.corridor).toEqual({ left: 420, right: 580, width: 160 });
    for (const box of circuitBoxes) {
      const position = packed.positions.get(box.id)!;
      const outsideCorridor =
        position.x + box.width <= packed.corridor.left ||
        position.x >= packed.corridor.right;
      expect(outsideCorridor).toBe(true);
    }
  });

  it("widens the routing channel with trace density and caps its footprint", () => {
    expect(footprintTraceCorridorWidth(0)).toBe(112);
    expect(footprintTraceCorridorWidth(10)).toBe(168);
    expect(footprintTraceCorridorWidth(100)).toBe(260);
  });

  it("keeps left and right ribbon tracks in separate corridor halves", () => {
    const corridor = { left: 400, right: 600, width: 200 };
    const left = Array.from({ length: 12 }, (_, index) =>
      footprintTraceTrackX(corridor, "left", index, 12),
    );
    const right = Array.from({ length: 12 }, (_, index) =>
      footprintTraceTrackX(corridor, "right", index, 12),
    );

    expect(Math.max(...left)).toBeLessThan(500);
    expect(Math.min(...right)).toBeGreaterThan(500);
    expect(left[1]).toBeGreaterThan(left[0]);
    expect(right[1]).toBeLessThan(right[0]);
  });

  it("does not force short jumps into a reversing traceway", () => {
    expect(
      footprintTracewayWaypoints(
        { x: 100, y: 100, width: 80, height: 40 },
        { x: 140, y: 170, width: 80, height: 40 },
        120,
      ),
    ).toBeNull();
  });

  it("keeps long traceway leads monotonic in either direction", () => {
    const down = footprintTracewayWaypoints(
      { x: 100, y: 100, width: 80, height: 40 },
      { x: 180, y: 300, width: 80, height: 40 },
      140,
    )!;
    const up = footprintTracewayWaypoints(
      { x: 180, y: 300, width: 80, height: 40 },
      { x: 100, y: 100, width: 80, height: 40 },
      140,
    )!;

    expect(down[0].y).toBeLessThanOrEqual(down[3].y);
    expect(up[0].y).toBeGreaterThanOrEqual(up[3].y);
    expect(down[1].x).toBe(down[2].x);
    expect(up[1].x).toBe(up[2].x);
  });

  it("escapes from side handles outward instead of crossing the node", () => {
    const waypoints = footprintTracewayWaypoints(
      { x: 100, y: 100, width: 80, height: 40 },
      { x: 180, y: 300, width: 80, height: 40 },
      180,
      "right",
      "top",
    )!;

    expect(waypoints[0].x).toBeGreaterThan(140);
    expect(waypoints[3].y).toBeLessThan(280);
  });

  it("falls back when a highway sits behind a side-facing handle", () => {
    expect(
      footprintTracewayWaypoints(
        { x: 100, y: 100, width: 80, height: 40 },
        { x: 180, y: 300, width: 80, height: 40 },
        80,
        "right",
        "top",
      ),
    ).toBeNull();
  });

  it("places the two highest-load groups at the top of opposing banks", () => {
    const packed = packFootprintCircuitBanks(circuitBoxes, {
      centerX: 500,
      startY: 200,
      corridorWidth: 140,
    });
    expect(packed.positions.get("lane-0")?.y).toBe(200);
    expect(packed.positions.get("lane-1")?.y).toBe(200);
    expect(packed.bankById.get("lane-0")).not.toBe(
      packed.bankById.get("lane-1"),
    );
  });

  it("keeps variable-size cards separated within each bank", () => {
    const packed = packFootprintCircuitBanks(circuitBoxes, {
      centerX: 500,
      startY: 200,
      corridorWidth: 120,
    });
    for (const side of ["left", "right"] as const) {
      const inBank = circuitBoxes
        .filter((box) => packed.bankById.get(box.id) === side)
        .map((box) => ({ ...box, ...packed.positions.get(box.id)! }))
        .sort((a, b) => a.y - b.y);
      for (let index = 1; index < inBank.length; index += 1) {
        expect(inBank[index].y).toBeGreaterThanOrEqual(
          inBank[index - 1].y + inBank[index - 1].height + 42,
        );
      }
    }
  });
});
