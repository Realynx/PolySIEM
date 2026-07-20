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

export interface FootprintCircuitBox extends FootprintLayoutBox {
  /** Number of rendered traces incident to this group. */
  traceWeight: number;
}

export interface FootprintCircuitLayout extends FootprintPackedLayout {
  bankById: Map<string, FootprintCircuitBank>;
  corridor: { left: number; right: number; width: number };
}

/** Routing-channel width grows with rendered load, then caps for sane zoom. */
export function footprintTraceCorridorWidth(traceCount: number): number {
  return Math.min(260, Math.max(112, 88 + Math.max(0, traceCount) * 6));
}

interface Candidate {
  columns: number;
  columnWidths: number[];
  assignments: { box: FootprintLayoutBox; column: number; y: number }[];
  width: number;
  height: number;
  score: number;
}

/**
 * Pack network lanes into a predictable, balanced shelf layout. Candidate
 * column counts are scored against the wide dashboard canvas so dense graphs
 * spend horizontal space instead of becoming one extremely tall stack.
 */
export function packFootprintLanes(
  boxes: readonly FootprintLayoutBox[],
  options: {
    centerX: number;
    startY: number;
    maxColumns?: number;
    targetAspect?: number;
    gapX?: number;
    gapY?: number;
    categoryGap?: number;
  },
): FootprintPackedLayout {
  if (boxes.length === 0) {
    return { positions: new Map(), width: 0, height: 0, left: options.centerX, columns: 0 };
  }
  const maxColumns = Math.max(1, Math.min(options.maxColumns ?? 3, boxes.length));
  const targetAspect = options.targetAspect ?? 2.2;
  const gapX = options.gapX ?? 48;
  const gapY = options.gapY ?? 28;
  const categoryGap = options.categoryGap ?? 18;
  let best: Candidate | null = null;

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const columnWidths = Array.from({ length: columns }, () => 0);
    const columnHeights = Array.from({ length: columns }, () => 0);
    const previousCategory: Array<string | null> = Array.from({ length: columns }, () => null);
    const assignments: Candidate["assignments"] = [];

    boxes.forEach((box, index) => {
      const column = index % columns;
      const categoryBreak = previousCategory[column] !== null && previousCategory[column] !== box.category;
      if (columnHeights[column] > 0) columnHeights[column] += gapY + (categoryBreak ? categoryGap : 0);
      assignments.push({ box, column, y: columnHeights[column] });
      columnHeights[column] += box.height;
      columnWidths[column] = Math.max(columnWidths[column], box.width);
      previousCategory[column] = box.category;
    });

    const width = columnWidths.reduce((sum, value) => sum + value, 0) + gapX * (columns - 1);
    const height = Math.max(...columnHeights);
    const aspect = width / Math.max(1, height);
    const score = Math.abs(Math.log(aspect / targetAspect)) + columns * 0.01;
    if (!best || score < best.score) {
      best = { columns, columnWidths, assignments, width, height, score };
    }
  }

  const chosen = best!;
  const left = options.centerX - chosen.width / 2;
  const columnLefts: number[] = [];
  let cursorX = left;
  for (const width of chosen.columnWidths) {
    columnLefts.push(cursorX);
    cursorX += width + gapX;
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const assignment of chosen.assignments) {
    positions.set(assignment.box.id, {
      x: columnLefts[assignment.column] + (chosen.columnWidths[assignment.column] - assignment.box.width) / 2,
      y: options.startY + assignment.y,
    });
  }
  return {
    positions,
    width: chosen.width,
    height: chosen.height,
    left,
    columns: chosen.columns,
  };
}

/**
 * Place network groups into two component banks around a reserved trace
 * corridor. High-traffic groups are assigned first and therefore stay nearest
 * the controller/top of the board. Greedy height balancing keeps either bank
 * from becoming an unnecessarily tall strip.
 */
export function packFootprintCircuitBanks(
  boxes: readonly FootprintCircuitBox[],
  options: {
    centerX: number;
    startY: number;
    corridorWidth: number;
    bankGapY?: number;
    categoryGap?: number;
  },
): FootprintCircuitLayout {
  const corridorWidth = Math.max(72, options.corridorWidth);
  const corridor = {
    left: options.centerX - corridorWidth / 2,
    right: options.centerX + corridorWidth / 2,
    width: corridorWidth,
  };
  if (boxes.length === 0) {
    return {
      positions: new Map(),
      bankById: new Map(),
      corridor,
      width: corridorWidth,
      height: 0,
      left: corridor.left,
      columns: 0,
    };
  }

  const bankGapY = options.bankGapY ?? 42;
  const categoryGap = options.categoryGap ?? 16;
  const ordered = [...boxes].sort(
    (a, b) =>
      b.traceWeight - a.traceWeight ||
      b.height - a.height ||
      a.category.localeCompare(b.category) ||
      a.id.localeCompare(b.id),
  );
  const banks: Record<
    FootprintCircuitBank,
    { boxes: FootprintCircuitBox[]; height: number; width: number; category: string | null }
  > = {
    left: { boxes: [], height: 0, width: 0, category: null },
    right: { boxes: [], height: 0, width: 0, category: null },
  };

  for (const box of ordered) {
    const side: FootprintCircuitBank =
      banks.left.height <= banks.right.height ? "left" : "right";
    const bank = banks[side];
    if (bank.boxes.length > 0) {
      bank.height +=
        bankGapY + (bank.category !== box.category ? categoryGap : 0);
    }
    bank.boxes.push(box);
    bank.height += box.height;
    bank.width = Math.max(bank.width, box.width);
    bank.category = box.category;
  }

  const positions = new Map<string, { x: number; y: number }>();
  const bankById = new Map<string, FootprintCircuitBank>();
  const bankLeft = {
    left: corridor.left - banks.left.width,
    right: corridor.right,
  };
  for (const side of ["left", "right"] as const) {
    const bank = banks[side];
    let y = options.startY;
    let previousCategory: string | null = null;
    for (const box of bank.boxes) {
      if (previousCategory !== null) {
        y += bankGapY + (previousCategory !== box.category ? categoryGap : 0);
      }
      positions.set(box.id, {
        x:
          side === "left"
            ? corridor.left - box.width
            : corridor.right,
        y,
      });
      bankById.set(box.id, side);
      y += box.height;
      previousCategory = box.category;
    }
  }

  const left = bankLeft.left;
  const right = corridor.right + banks.right.width;
  return {
    positions,
    bankById,
    corridor,
    width: right - left,
    height: Math.max(banks.left.height, banks.right.height),
    left,
    columns: boxes.length === 1 ? 1 : 2,
  };
}
