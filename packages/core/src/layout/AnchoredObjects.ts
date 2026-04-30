import type { Node } from "prosemirror-model";

export const ANCHORED_OBJECT_MARGIN = 8;

export type AnchoredObjectMode =
  | "square-left"
  | "square-right"
  | "top-bottom"
  | "behind"
  | "front";

export interface AnchoredObjectInput {
  docPos: number;
  node: Node;
  mode: AnchoredObjectMode;
  width: number;
  height: number;
  floatOffset: { x: number; y: number };
  anchorFlowIndex: number;
  anchorGlobalY: number;
}

export interface AnchoredObjectPlacement {
  docPos: number;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  mode: AnchoredObjectMode;
  node: Node;
  anchorGlobalY: number;
  anchorPage: number;
}

export interface WrapZone {
  side: "left" | "right";
  x: number;
  right: number;
  top: number;
  bottom: number;
  anchorDocPos: number;
}

export interface FlowClearance {
  afterFlowIndex: number;
  y: number;
  anchorDocPos: number;
}

export interface AnchoredObjectSolverResult {
  placements: AnchoredObjectPlacement[];
  wrapZones: WrapZone[];
  clearances: FlowClearance[];
  status: "stable" | "exhausted";
  iterations: number;
}

export function isAnchoredObjectMode(mode: unknown): mode is AnchoredObjectMode {
  return (
    mode === "square-left" ||
    mode === "square-right" ||
    mode === "top-bottom" ||
    mode === "behind" ||
    mode === "front"
  );
}
