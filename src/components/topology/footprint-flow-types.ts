import type { Edge } from "@xyflow/react";
import type { EdgeDetail } from "@/components/topology/edge-details";
import type { FootprintFlowNode } from "@/components/topology/footprint-node-model";
export interface BuiltFlow { nodes: FootprintFlowNode[]; edges: Edge[]; details: Map<string, EdgeDetail>; parentOfNode: Map<string, string>; }
