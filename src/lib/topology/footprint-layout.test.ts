import { describe, expect, it } from "vitest";
import {
  footprintTraceCorridorWidth,
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
    expect(footprintTraceCorridorWidth(10)).toBe(148);
    expect(footprintTraceCorridorWidth(100)).toBe(260);
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
