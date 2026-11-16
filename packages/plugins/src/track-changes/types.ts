import type { GestureComposition } from "./engine/composeGesture";
import type { ReplayedSelection } from "./engine/fixAndSetSelectionAfterTracking";
import type { PastedMove } from "./lib/cutAndPaste";
import { Fragment, Mark, Node, NodeType, Slice } from "@scrivr/core/pm";
import { PluginKey } from "@scrivr/core/pm";
import { Mapping, ReplaceAroundStep, ReplaceStep } from "@scrivr/core/pm";

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
  /** The break ending this block was deleted: accepting it joins the next block on. */
  node_join = "node_join",
  /** The lists this block sits in changed; the record keeps where it sat before. */
  list_change = "list_change",
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
   * Links the two halves of moved content that is not carried as a block: its
   * deletion where it was and its insertion where it went, as Word's
   * `moveFrom` and `moveTo`. Deciding either decides both.
   */
  moveId?: string;
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
  /**
   * Set on each record that is part of an insertion recorded in several
   * places — the new node and the text inside it. Reviewing the creation
   * reviews all of them.
   */
  creationId?: string;
  /**
   * The same for a deletion recorded in several places: deleting a node that
   * holds someone else's pending work keeps that work as a proposal, so the
   * deletion is written on the node and again on what it struck inside it.
   */
  deletionId?: string;
  /**
   * This record is a piece of the record named here, split apart by later
   * work — typing inside a deletion. Each piece has its own id because an id
   * names one contiguous span; the pieces are still one change.
   */
  continuesId?: string;
  /**
   * Creations this record relies on: set when work inside a pending insertion
   * does not fold into it, and when a pending insertion moves. Rejecting that
   * insertion names this record as dependent work instead of silently taking it.
   */
  dependsOn?: string[];
  /**
   * Set on a creation once separate work has depended on it. From then on the
   * creator's own later edits inside it record `dependsOn` rather than folding
   * in, and deleting it no longer cancels it, even after that work is reviewed.
   */
  foldingClosed?: boolean;
  /** A later placement is based on these still-pending placement decisions. */
  placementDependsOn?: string[];
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

export type NodeJoinAttrs = Omit<InsertDeleteAttrs, "operation"> & {
  operation: CHANGE_OPERATION.node_join;
};

/** One list a block sits in, and the item holding it there: an entry of a list change's `oldList`. */
export type ListLevel = {
  type: string;
  attrs: Record<string, unknown>;
  item: Record<string, unknown>;
  /** The block is the first in its item, so the item starts with it. */
  startsItem: boolean;
};

export type ListChangeAttrs = Omit<InsertDeleteAttrs, "operation"> & {
  operation: CHANGE_OPERATION.list_change;
  /** The lists the block sat in before, outermost first; empty when in none. */
  oldList: ListLevel[];
};

export type ReferenceAttrs = Omit<InsertDeleteAttrs, "operation"> & {
  operation: CHANGE_OPERATION.reference;
  referenceId: string;
  /** The id the split block had, which it takes back when the split is rejected. */
  originalNodeId?: string;
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
  | NodeJoinAttrs
  | ListChangeAttrs
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
  /** For a deleted paragraph break: where the block it joins onto starts. */
  joinsAt?: number;
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

// ── Plugin options / state ────────────────────────────────────────────────────

/**
 * How tracked changes show on the canvas: `"all"` paints every change in its
 * author's colour; `"none"` paints nothing, for a host that draws its own
 * review UI. Changes are recorded either way.
 */
export type TrackChangesRenderMode = "all" | "none";

export interface TrackChangesOptions {
  debug?: boolean;
  userID: string;
  /** Default `"all"`. */
  renderMode?: TrackChangesRenderMode;
  skipTrsWithMetas?: (PluginKey | string)[];
  initialStatus?: TrackChangesStatus;
  canAcceptReject?: boolean;
  /**
   * Called with the reason when an edit is stopped because it could not be
   * recorded as a suggestion. The edit is not applied, so tell the person why.
   */
  onRefused?: (refusal: TrackingRefusal) => void;
}

// ── Transaction tracking context ──────────────────────────────────────────────

/** Why a gesture could not be represented as tracked changes. */
export type TrackingRefusal =
  | { reason: "unsupported-step"; stepType: string }
  | { reason: "duplicate-transform-package" }
  /** A later step writes across the edge of an earlier step's insertion where it can't be split. */
  | { reason: "overlapping-steps" };

/**
 * What tracking did with a gesture. `refused` is the one outcome a host must act
 * on: the edit stands in the document but nothing was recorded, so undoing it or
 * warning the author is the host's call.
 *
 * Refusal means the gesture cannot be represented, never that it was big. Step
 * count and elapsed time are diagnostics for finding expensive replays — a
 * document-wide formatting command legitimately produces thousands of steps and
 * must still be tracked in full. `elapsedMs` is only on `tracked`: a refusal is
 * decided before anything runs.
 */
export type TrackingResult =
  | { status: "tracked"; steps: number; elapsedMs: number }
  | ({ status: "refused"; steps: number } & TrackingRefusal);

export type TrTrackingContext = {
  prevLiftStep?: ReplaceAroundStep;
  liftFragment?: Fragment;
  action: ReturnType<typeof getAction>;
  stepsByGroupIDMap: Map<ReplaceStep, string>;
  /** Steps moving text: the deletion and the insertion of one move share an id. */
  textMoves: Map<ReplaceStep, string>;
  /** The move a paste completes: what it inserts is that move's destination. */
  pastedMove?: PastedMove;
  replayedSelection: ReplayedSelection;
  composition: GestureComposition;
  /**
   * Maps the source document the replay has reached into the replayed one. The
   * replay walks the gesture's steps backwards, so each iteration re-bases this
   * onto the document that step applied to; every tracker writing into the
   * replayed document maps its source positions through it first.
   */
  replayBridge: Mapping;
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
  fragment: Fragment;
}

export interface InsertSliceStep {
  from: number;
  to: number;
  sliceWasSplit: boolean;
  type: "insert-slice";
  slice: Slice;
  /** The replay map that undid this content, when this writes back the same size. */
  undoMapIndex?: number;
  /** Where the step left the caret, when not at the end of what this writes. */
  caretAt?: number;
}

export interface UpdateNodeAttrsStep {
  pos: number;
  type: "update-node-attrs";
  node: Node;
  newAttrs: Record<string, any>;
  /** New node type when the block type changes (e.g. paragraph → heading). Undefined means keep existing type. */
  newNodeType?: NodeType;
}

/** A deleted break between a block and the one after it. */
export interface JoinNodeStep {
  pos: number;
  type: "join-node";
  node: Node;
  /** The deletion leaves the next block to join onto, rather than taking it whole. */
  joinsNext: boolean;
}

export type ChangeStep =
  | JoinNodeStep
  | DeleteNodeStep
  | DeleteTextStep
  | MergeFragmentStep
  | InsertSliceStep
  | UpdateNodeAttrsStep;
