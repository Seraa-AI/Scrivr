import { EditorState, Mapping, PluginKey, Transaction } from "@scrivr/core/pm";

import { getAction, TrackChangesAction } from "../actions";
import { processStepsBeforeTracking } from "./processStepsBeforeTracking";
import {
  changeMovedToInsertsOnSourceDeletion,
  contentSteps,
  getIndentationOperationSteps,
  getMoveOperationsSteps,
  planTracking,
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
    return { kind: "skipped" };
  }

  const indentationAction = getAction(tx, TrackChangesAction.indentationAction);
  const action = indentationAction?.action;
  const trContext: TrTrackingContext = {
    action,
    stepsByGroupIDMap: new Map(),
    replayBridge: new Mapping(),
  };

  const clearedSteps = processStepsBeforeTracking(tx, trContext, [
    getMoveOperationsSteps,
    getIndentationOperationSteps,
    ]);

  const steps = contentSteps(clearedSteps).length;
  const refusal = planTracking(clearedSteps);
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
    clearedSteps,
    trContext,
  );
  return {
    kind: "tracked",
    tr,
    result: { status: "ready", steps, elapsedMs: Date.now() - startedAt },
  };
}
