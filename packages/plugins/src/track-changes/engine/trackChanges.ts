import { NORMALIZATION_META } from "@scrivr/core";
import { EditorState, Mapping, PluginKey, Transaction } from "@scrivr/core/pm";

import { getAction, TrackChangesAction } from "../actions";
import {
  changeMovedToInsertsOnSourceDeletion,
  contentSteps,
  groupIndentationSteps,
  groupMoveSteps,
  trackingRefusal,
  trFromHistory,
} from "./transactionProcessing";
import { TrackingResult, TrTrackingContext } from "../types";
import { trackTransaction } from "./trackTransaction";

export type TrackingOutcome =
  | { kind: "skipped" }
  | { kind: "tracked"; tr: Transaction; result: Extract<TrackingResult, { status: "ready" }> }
  | { kind: "refused"; result: Extract<TrackingResult, { status: "refused" }> };

export function trackChanges(
  tx: Transaction,
  createdTr: Transaction,
  oldState: EditorState,
  userID: string,
  skipTrsWithMetas: (PluginKey | string)[],
): TrackingOutcome {
  const wasAppended = tx.getMeta("appendedTransaction") as
    | Transaction
    | undefined;
  const skipMetaUsed = skipTrsWithMetas.some(
    m => tx.getMeta(m) || wasAppended?.getMeta(m),
  );
  const skipTrackUsed =
    getAction(tx, TrackChangesAction.skipTrack) ||
    (wasAppended && getAction(wasAppended, TrackChangesAction.skipTrack));

  const isCollabSync =
    tx.getMeta("y-sync$") !== undefined ||
    tx.getMeta("isRemote") !== undefined ||
    tx.getMeta("pointer") !== undefined;

  const isInitialLoad =
    tx.getMeta("initialContent") === true ||
    wasAppended?.getMeta("initialContent") === true;

  const isNormalization = !!tx.getMeta(NORMALIZATION_META);

  const isPaginationChange =
    tx.getMeta("inserting") !== undefined ||
    tx.getMeta("deleting") !== undefined;

  if (
    !tx.docChanged ||
    skipMetaUsed ||
    skipTrackUsed ||
    trFromHistory(tx) ||
    isCollabSync ||
    isInitialLoad ||
    isNormalization ||
    isPaginationChange ||
    (wasAppended && tx.getMeta("origin") === "paragraphs")
  ) {
    return { kind: "skipped" };
  }

  const indentationAction = getAction(tx, TrackChangesAction.indentationAction);
  const action = indentationAction?.action;
  const trContext: TrTrackingContext = {
    action,
    stepsByGroupIDMap: new Map(),
    replayBridge: new Mapping(),
  };

  groupMoveSteps(tx, trContext);
  groupIndentationSteps(tx, trContext);

  const steps = contentSteps(tx.steps).length;
  const refusal = trackingRefusal(tx.steps);
  if (refusal) {
    return {
      kind: "refused",
      result: { status: "refused", ...refusal, steps },
    };
  }

  const startedAt = Date.now();
  changeMovedToInsertsOnSourceDeletion(tx, createdTr, trContext);
  const tr = trackTransaction(
    tx,
    oldState,
    createdTr,
    userID,
    trContext,
  );
  return {
    kind: "tracked",
    tr,
    result: { status: "ready", steps, elapsedMs: Date.now() - startedAt },
  };
}
