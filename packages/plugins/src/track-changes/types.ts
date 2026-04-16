import { Fragment, Mark, Node, NodeType, Slice } from "prosemirror-model";
import { PluginKey } from "prosemirror-state";
import { ReplaceAroundStep, ReplaceStep } from "prosemirror-transform";

import { getAction } from "./actions";
import { ChangeSet } from "./ChangeSet";

// ── DataTrackedAttrs ──────────────────────────────────────────────────────────

/**
 * Minimal shared shape of a single dataTracked entry — the fields that are
 * present on every operation type. Used in low-level utilities
 * (updateAttributes, trackRemoveMarkStep) where only id/status/operation
 * are needed. For the full per-operation union type see TrackedAttrs.
 */
export type DataTrackedAttrs = {
  id: string;
  status: string;
  operation: string;
  userID: string;
  createdAt: number;
};

// ── Enums ─────────────────────────────────────────────────────────────────────

export enum CHANGE_OPERATION {
  insert = "insert",
  delete = "delete",
  set_node_attributes = "set_attrs",
  wrap_with_node = "wrap_with_node",
  node_split = "node_split",
  reference = "reference",
  move = "move",
  structure = "structure",
}

export enum CHANGE_STATUS {
  accepted = "accepted",
  rejected = "rejected",
  pending = "pending",
}

export enum TrackChangesStatus {
  enabled = "enabled",
  viewSnapshots = "view-snapshots",
  disabled = "disabled",
}

// ── TrackedAttrs ──────────────────────────────────────────────────────────────

type InsertDeleteAttrs = {
  id: string;
  authorID: string;
  reviewedByID: string | null;
  operation: CHANGE_OPERATION.insert | CHANGE_OPERATION.delete;
  status: CHANGE_STATUS;
  statusUpdateAt: number;
  createdAt: number;
  updatedAt: number;
  moveNodeId?: string;
  /**
   * True when another author's mark overlaps this exact segment.
   * Drives amber conflict rendering and the conflict popover.
   * Set by splitRangeForNewMark when a second author touches the same range.
   */
  isConflict?: boolean;
  /**
   * Links a trackedDelete and its paired trackedInsert into one logical
   * replacement. Set by applyDiffAsSuggestion for adjacent delete+insert pairs
   * produced by the LCS diff. UI can use this to accept/reject the replacement
   * as a single atomic operation.
   */
  groupId?: string;
};

export type UpdateAttrs = Omit<InsertDeleteAttrs, "operation"> & {
  operation: CHANGE_OPERATION.set_node_attributes;
  oldAttrs: Record<string, any>;
  /** Original node type name, set only when the node type changes (e.g. ul→ol). Used to restore the type on rejection. */
  oldNodeTypeName?: string;
};

export type WrapAttrs = Omit<InsertDeleteAttrs, "operation"> & {
  operation: CHANGE_OPERATION.wrap_with_node;
};

export type NodeSplitAttrs = Omit<InsertDeleteAttrs, "operation"> & {
  operation: CHANGE_OPERATION.node_split;
};

export type ReferenceAttrs = Omit<InsertDeleteAttrs, "operation"> & {
  operation: CHANGE_OPERATION.reference;
  referenceId: string;
};

export type NodeMoveAttrs = Omit<InsertDeleteAttrs, "operation"> & {
  operation: CHANGE_OPERATION.move;
  indentationType?: "indent" | "unindent";
};

export type StructureAttrs = Omit<InsertDeleteAttrs, "operation"> & {
  operation: CHANGE_OPERATION.structure;
  action: string;
};

export type TrackedAttrs =
  | InsertDeleteAttrs
  | UpdateAttrs
  | WrapAttrs
  | NodeSplitAttrs
  | ReferenceAttrs
  | NodeMoveAttrs
  | StructureAttrs;

// ── TrackedChange ─────────────────────────────────────────────────────────────

export type Change = {
  id: string;
  from: number;
  to: number;
  dataTracked: TrackedAttrs;
};

export type TextChange = Change & {
  type: "text-change";
  text: string;
  nodeType: NodeType;
};

export type NodeChange = Change & {
  type: "node-change";
  node: Node;
  attrs: Record<string, any>;
  children: TrackedChange[];
};

export type NodeAttrChange = Change & {
  type: "node-attr-change";
  node: Node;
  oldAttrs: Record<string, any>;
  newAttrs: Record<string, any>;
  /** Set when the node type itself changed (e.g. bulletList → orderedList). */
  oldNodeTypeName?: string;
  /** Set when the node type itself changed (e.g. orderedList → bulletList). */
  newNodeTypeName?: string;
};

export type WrapChange = Change & {
  type: "wrap-change";
  wrapperNode: string;
};

export type ReferenceChange = Change & {
  type: "reference-change";
};

export type MarkChange = Change & {
  type: "mark-change";
  nodeType: NodeType;
  mark: Mark;
  node: Node;
  text: string;
};

export type TrackedChange =
  | TextChange
  | NodeChange
  | NodeAttrChange
  | WrapChange
  | ReferenceChange
  | MarkChange;

export type PartialChange<T extends TrackedChange> = Omit<T, "dataTracked"> & {
  dataTracked: Partial<TrackedAttrs>;
};

export type IncompleteChange = Omit<TrackedChange, "dataTracked"> & {
  dataTracked: Partial<TrackedAttrs>;
};

export type RootChanges = TrackedChange[][];
export type RootChange = TrackedChange[];

// ── Exposed PM types ──────────────────────────────────────────────────────────

export type ExposedReplaceStep = ReplaceStep & {
  slice: ExposedSlice;
};

export type ExposedSlice = Slice & {
  content: ExposedFragment;
  insertAt(pos: number, fragment: Fragment | ExposedFragment): ExposedSlice;
};

export type ExposedFragment = Fragment & {
  content: Node[];
};

// ── Plugin options / state ────────────────────────────────────────────────────

export interface TrackChangesOptions {
  debug?: boolean;
  userID: string;
  skipTrsWithMetas?: (PluginKey | string)[];
  initialStatus?: TrackChangesStatus;
  canAcceptReject?: boolean;
}

export interface TrackChangesState {
  status: TrackChangesStatus;
  userID: string;
  changeSet: ChangeSet;
}

// ── Transaction tracking context ──────────────────────────────────────────────

export type TrTrackingContext = {
  prevLiftStep?: ReplaceAroundStep;
  liftFragment?: Fragment;
  action: ReturnType<typeof getAction>;
  stepsByGroupIDMap: Map<ReplaceStep, string>;
  selectionPosFromInsertion?: number;
};

// ── ChangeStep variants ───────────────────────────────────────────────────────

export interface DeleteNodeStep {
  pos: number;
  nodeEnd: number;
  type: "delete-node";
  node: Node;
  ref?: string;
}

export interface DeleteTextStep {
  pos: number;
  from: number;
  to: number;
  type: "delete-text";
  node: Node;
  ref?: string;
}

export interface MergeFragmentStep {
  pos: number;
  mergePos: number;
  from: number;
  to: number;
  type: "merge-fragment";
  node: Node;
  fragment: ExposedFragment;
}

export interface InsertSliceStep {
  from: number;
  to: number;
  sliceWasSplit: boolean;
  type: "insert-slice";
  slice: ExposedSlice;
}

export interface UpdateNodeAttrsStep {
  pos: number;
  type: "update-node-attrs";
  node: Node;
  newAttrs: Record<string, any>;
  /** New node type when the block type changes (e.g. paragraph → heading). Undefined means keep existing type. */
  newNodeType?: NodeType;
}

export type ChangeStep =
  | DeleteNodeStep
  | DeleteTextStep
  | MergeFragmentStep
  | InsertSliceStep
  | UpdateNodeAttrsStep;
