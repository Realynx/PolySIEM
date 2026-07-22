"use client";

import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type EdgeMouseHandler,
  type EdgeTypes,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  type OnNodeDrag,
  type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";
import {
  layerTopologyEdges,
  layerTopologyNodes,
} from "@/components/topology/topology-layers";

/** Invisible React Flow handle — edges attach, but no dot is rendered. */
export const hiddenHandle =
  "!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0 pointer-events-none";

/** App-token theme for the React Flow chrome, shared by every map. */
const XY_THEME = {
  // Border is intentionally very translucent in dark mode, which is right for
  // card chrome but too faint for graph geometry. Use a dedicated neutral line
  // mixed from foreground and card so contextual routes remain legible.
  "--topology-edge-muted":
    "color-mix(in oklab, var(--color-muted-foreground) 72%, var(--color-card))",
  // Matches the translucent canvas surface closely enough to cut a small gap
  // beneath crossing tracks. This makes a crossing read as an overpass, not a
  // false T-junction between unrelated edges.
  "--topology-edge-casing":
    "color-mix(in oklab, var(--color-card) 40%, var(--color-background))",
  "--xy-edge-stroke": "var(--topology-edge-muted)",
  "--xy-controls-button-background-color": "var(--color-card)",
  "--xy-controls-button-background-color-hover": "var(--color-muted)",
  "--xy-controls-button-color": "var(--color-foreground)",
  "--xy-controls-button-color-hover": "var(--color-foreground)",
  "--xy-controls-button-border-color": "var(--color-border)",
  "--xy-minimap-background-color": "var(--color-card)",
  "--xy-minimap-mask-background-color":
    "color-mix(in oklab, var(--color-muted) 55%, transparent)",
  "--xy-attribution-background-color": "transparent",
} as React.CSSProperties;

interface TopologyCanvasProps<NodeType extends Node> {
  nodes: NodeType[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  /** Custom edge renderers (e.g. the shared routed/bundled edge). */
  edgeTypes?: EdgeTypes;
  onNodesChange: OnNodesChange<NodeType>;
  onNodeClick?: NodeMouseHandler<NodeType>;
  onNodeDragStart?: OnNodeDrag<NodeType>;
  onNodeDragStop?: OnNodeDrag<NodeType>;
  onNodeMouseEnter?: NodeMouseHandler<NodeType>;
  onNodeMouseLeave?: NodeMouseHandler<NodeType>;
  onEdgeClick?: EdgeMouseHandler;
  onEdgeMouseEnter?: EdgeMouseHandler;
  onEdgeMouseLeave?: EdgeMouseHandler;
  onPaneClick?: () => void;
  /** fitView padding — maps tune this slightly for their density. */
  fitPadding?: number;
  edgesFocusable?: boolean;
  /** Cull nodes and edges outside the viewport on especially dense maps. */
  onlyRenderVisibleElements?: boolean;
  /** Height utilities for the outer card; content fills it. */
  heightClassName?: string;
  /** Overlays (legend, detail panels) rendered above the canvas. */
  children?: React.ReactNode;
}

/**
 * The shared themed React Flow shell used by every topology map: outer card,
 * --xy-* token theme, dotted background, controls and minimap. Each map keeps
 * its own node components, layout pass and overlays.
 */
export function TopologyCanvas<NodeType extends Node>({
  nodes,
  edges,
  nodeTypes,
  edgeTypes,
  onNodesChange,
  onNodeClick,
  onNodeDragStart,
  onNodeDragStop,
  onNodeMouseEnter,
  onNodeMouseLeave,
  onEdgeClick,
  onEdgeMouseEnter,
  onEdgeMouseLeave,
  onPaneClick,
  fitPadding = 0.1,
  edgesFocusable,
  onlyRenderVisibleElements = false,
  heightClassName = "h-[calc(100vh-13rem)] min-h-[600px]",
  children,
}: TopologyCanvasProps<NodeType>) {
  const layeredNodes = useMemo(() => layerTopologyNodes(nodes), [nodes]);
  const layeredEdges = useMemo(() => layerTopologyEdges(edges), [edges]);

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-xl border border-border bg-card/40",
        heightClassName,
      )}
      style={XY_THEME}
    >
      {children}
      <ReactFlow
        nodes={layeredNodes}
        edges={layeredEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onEdgeClick={onEdgeClick}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseLeave={onEdgeMouseLeave}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: fitPadding, maxZoom: 1 }}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={edgesFocusable}
        onlyRenderVisibleElements={onlyRenderVisibleElements}
        // Exact layers prevent React Flow from automatically raising traces
        // connected to nested nodes above unrelated draggable cards.
        zIndexMode="manual"
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.5}
          color="var(--color-border)"
        />
        <Controls
          showInteractive={false}
          className="!shadow-sm [&>button]:!border-b [&>button]:!border-border"
        />
        <MiniMap
          pannable
          zoomable
          className="!rounded-lg !border !border-border !shadow-sm"
          nodeColor="var(--color-muted-foreground)"
          nodeStrokeColor="transparent"
          bgColor="var(--color-card)"
        />
      </ReactFlow>
    </div>
  );
}
