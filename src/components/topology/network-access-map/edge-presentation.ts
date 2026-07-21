import type { Edge } from "@xyflow/react";

export const EDGE_LABEL_DEFAULTS = {
  labelStyle: { fill: "var(--color-muted-foreground)", fontSize: 10 },
  labelBgStyle: { fill: "var(--color-card)", fillOpacity: 0.9 },
  labelBgPadding: [4, 2] as [number, number],
  labelBgBorderRadius: 4,
} satisfies Pick<
  Edge,
  "labelStyle" | "labelBgStyle" | "labelBgPadding" | "labelBgBorderRadius"
>;

export type EdgeOpacity = (
  id: string,
  source?: string,
  target?: string,
) => number;

/** Keep selection emphasis consistent across every access-map edge family. */
export function createEdgeOpacity(
  selectedEdgeId: string | null,
  selectedNodeId: string | null,
): EdgeOpacity {
  return (id, source, target) => {
    if (selectedEdgeId) return id === selectedEdgeId ? 1 : 0.1;
    if (selectedNodeId) {
      return source === selectedNodeId || target === selectedNodeId ? 1 : 0.08;
    }
    return 0.85;
  };
}
