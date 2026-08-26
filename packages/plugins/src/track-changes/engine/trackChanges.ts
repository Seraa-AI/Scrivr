import { EditorState, PluginKey, Transaction } from "@scrivr/core/pm";

import { getAction, TrackChangesAction } from "../actions";
import { processStepsBeforeTracking } from "./processStepsBeforeTracking";
import {
  changeMovedToInsertsOnSourceDeletion,
  filterMeaninglessMoveSteps,
  getIndentationOperationSteps,
  getMoveOperationsSteps,
  trFromHistory,
} from "./transactionProcessing";
import { TrTrackingContext } from "../types";
import { trackTransaction } from "./trackTransaction";

export function trackChanges(
  tx: Transaction,
  createdTr: Transaction,
  oldState: EditorState,
  userID: string,
  skipTrsWithMetas: (PluginKey | string)[],
) {
  const wasAppended = tx.getMeta("appendTransaction") as
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

  const isInitialLoad = tx.getMeta("initialContent") === true;

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
    isPaginationChange ||
    (wasAppended && tx.getMeta("origin") === "paragraphs")
  ) {
    return null;
  }

  const indentationAction = getAction(tx, TrackChangesAction.indentationAction);
  const action = indentationAction?.action;
  const trContext: TrTrackingContext = {
    action,
    stepsByGroupIDMap: new Map(),
  };

  const clearedSteps = processStepsBeforeTracking(tx, trContext, [
    getMoveOperationsSteps,
    getIndentationOperationSteps,
    filterMeaninglessMoveSteps,
  ]);

  changeMovedToInsertsOnSourceDeletion(tx, createdTr, trContext);
  return trackTransaction(
    tx,
    oldState,
    createdTr,
    userID,
    clearedSteps,
    trContext,
  );
}
