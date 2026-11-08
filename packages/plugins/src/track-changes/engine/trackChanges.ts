import { COLLAB_SYNC_META, NORMALIZATION_META } from "@scrivr/core";
import { EditorState, Mapping, PluginKey, Transaction } from "@scrivr/core/pm";

import { getAction, TrackChangesAction } from "../actions";
import {
  changeMovedToInsertsOnSourceDeletion,
  contentSteps,
  groupIndentationSteps,
  groupMoveSteps,
  passThroughMeta,
  trackingRefusal,
  trFromHistory,
} from "./transactionProcessing";
import { createNewPendingAttrs } from "../helpers";
import { listMovesOnly, recordListChange } from "../lib/listChange";
import { composeGesture, splitAtInsertionEdges } from "./composeGesture";
import type { ReplayedSelection } from "./fixAndSetSelectionAfterTracking";
import { TrackingRefusal, TrackingResult, TrTrackingContext } from "../types";
import { trackTransaction } from "./trackTransaction";

export type TrackingOutcome =
  | { kind: "skipped" }
  | { kind: "tracked"; tr: Transaction; result: Extract<TrackingResult, { status: "tracked" }> }
  | { kind: "refused"; result: Extract<TrackingResult, { status: "refused" }> };

/** An edit a collaborator made, arriving through sync. */
export const fromCollaborator = (tx: Transaction) =>
  !!tx.getMeta(COLLAB_SYNC_META) ||
  tx.getMeta("y-sync$") !== undefined ||
  tx.getMeta("isRemote") !== undefined ||
  tx.getMeta("pointer") !== undefined;

/** Edits nobody authored, or that are someone else's to record. */
export function untracked(tx: Transaction, skipTrsWithMetas: (PluginKey | string)[]) {
  const wasAppended: Transaction | undefined = tx.getMeta("appendedTransaction");
  return (
    !tx.docChanged ||
    skipTrsWithMetas.some(meta => tx.getMeta(meta) || wasAppended?.getMeta(meta)) ||
    !!getAction(tx, TrackChangesAction.skipTrack) ||
    !!(wasAppended && getAction(wasAppended, TrackChangesAction.skipTrack)) ||
    trFromHistory(tx) ||
    fromCollaborator(tx) ||
    // Initial load
    tx.getMeta("initialContent") === true ||
    wasAppended?.getMeta("initialContent") === true ||
    !!tx.getMeta(NORMALIZATION_META) ||
    // Pagination
    tx.getMeta("inserting") !== undefined ||
    tx.getMeta("deleting") !== undefined ||
    !!(wasAppended && tx.getMeta("origin") === "paragraphs")
  );
}

/**
 * The gesture as it is recorded: a step straddling an insertion's edge is split
 * there and the gesture composed again, at most once per step.
 */
function recordableGesture(tx: Transaction, oldState: EditorState) {
  let gesture = tx;
  let composition = composeGesture(gesture);
  for (let splits = 0; composition.straddle && splits < tx.steps.length; splits++) {
    const split = splitAtInsertionEdges(gesture, composition.straddle, oldState);
    if (!split) break;
    gesture = split;
    composition = composeGesture(gesture);
  }
  return { gesture, composition };
}

const OVERLAPPING_STEPS: TrackingRefusal = { reason: "overlapping-steps" };

const refusalOf = ({ gesture, composition }: ReturnType<typeof recordableGesture>): TrackingRefusal | null =>
  trackingRefusal(gesture.steps) ?? (composition.straddle ? OVERLAPPING_STEPS : null);

/**
 * Why tracking could not record this edit, or null when it can or need not.
 * Asked before the edit is applied, so an edit that would land unrecorded can
 * be stopped instead.
 */
export function gestureRefusal(
  tx: Transaction,
  oldState: EditorState,
  skipTrsWithMetas: (PluginKey | string)[],
): TrackingRefusal | null {
  if (untracked(tx, skipTrsWithMetas)) return null;
  const refusal = refusalOf(recordableGesture(tx, oldState));
  return refusal && !listMovesOnly(tx) ? refusal : null;
}

export function trackChanges(
  tx: Transaction,
  createdTr: Transaction,
  oldState: EditorState,
  userID: string,
  skipTrsWithMetas: (PluginKey | string)[],
  replayedSelection: ReplayedSelection,
  pastedMove?: string,
): TrackingOutcome {
  if (untracked(tx, skipTrsWithMetas)) return { kind: "skipped" };

  // Moving blocks between lists changes where they sit, not what they say, so
  // it is recorded on the blocks rather than replayed step by step.
  const listMoves = listMovesOnly(tx);
  if (listMoves) {
    recordListChange(listMoves, createdTr, createNewPendingAttrs(tx.time, userID));
    return {
      kind: "tracked",
      tr: passThroughMeta(tx, createdTr),
      result: { status: "tracked", steps: contentSteps(tx.steps).length, elapsedMs: 0 },
    };
  }

  const { gesture, composition } = recordableGesture(tx, oldState);
  const trContext: TrTrackingContext = {
    action: getAction(tx, TrackChangesAction.indentationAction)?.action,
    stepsByGroupIDMap: new Map(),
    textMoves: new Map(),
    ...(pastedMove ? { pastedMove } : {}),
    replayBridge: new Mapping(),
    composition,
    replayedSelection,
  };

  groupMoveSteps(gesture, trContext);
  groupIndentationSteps(gesture, trContext);

  const steps = contentSteps(tx.steps).length;
  // The plugin stops these before they apply; this keeps tracking from ever
  // writing a gesture it cannot record.
  const refusal = refusalOf({ gesture, composition });
  if (refusal) return { kind: "refused", result: { status: "refused", ...refusal, steps } };

  const startedAt = Date.now();
  changeMovedToInsertsOnSourceDeletion(gesture, createdTr, trContext);
  const tr = trackTransaction(gesture, oldState, createdTr, userID, trContext);
  return {
    kind: "tracked",
    tr,
    result: { status: "tracked", steps, elapsedMs: Date.now() - startedAt },
  };
}
