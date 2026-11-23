import type { ReviewDecisions, ReviewOutcome } from "./reviewPlan";
import { Transaction, type Step } from "@scrivr/core/pm";

import { ReplacementView, StructureAttrs, TrackChangesStatus, TrackingResult } from "./types";

export enum TrackChangesAction {
  suggest = "track-changes-suggest",
  skipTrack = "track-changes-skip-tracking",
  setUserID = "track-changes-set-user-id",
  setPluginStatus = "track-changes-set-track-status",
  setReplacementView = "track-changes-set-replacement-view",
  setChangeStatuses = "track-changes-set-change-statuses",
  reviewResult = "track-changes-review-result",
  trackingResult = "track-changes-tracking-result",
  refreshChanges = "track-changes-refresh-changes",
  updateMetaNode = "track-changes-update-meta-node",
  structuralChangeAction = "track-changes-structural-change-action",
  indentationAction = "track-changes-indentation-action",
  /** Steps a writer made for one phrase, recorded as one group. */
  phrases = "track-changes-phrases",
}

export type TrackChangesActionParams = {
  [TrackChangesAction.suggest]: SuggestionIntent;
  [TrackChangesAction.skipTrack]: boolean;
  [TrackChangesAction.setUserID]: string;
  [TrackChangesAction.setPluginStatus]: TrackChangesStatus;
  [TrackChangesAction.setReplacementView]: ReplacementView;
  [TrackChangesAction.setChangeStatuses]: ReviewDecisions;
  [TrackChangesAction.reviewResult]: ReviewOutcome;
  [TrackChangesAction.trackingResult]: TrackingResult;
  [TrackChangesAction.refreshChanges]: boolean;
  [TrackChangesAction.updateMetaNode]: boolean;
  [TrackChangesAction.structuralChangeAction]: StructureAttrs["action"];
  [TrackChangesAction.indentationAction]: {
    action: "indent" | "unindent";
  };
  [TrackChangesAction.phrases]: ReadonlyArray<readonly Step[]>;
};

/** Returns true if any track-changes action meta is set on the transaction. */
export function hasAction(tr: Transaction) {
  return Object.values(TrackChangesAction).some(action => !!tr.getMeta(action));
}

/** Gets the payload of a track-changes action meta. */
export function getAction<K extends keyof TrackChangesActionParams>(
  tr: Transaction,
  action: K,
): TrackChangesActionParams[K] | undefined {
  return tr.getMeta(action);
}

/** Sets a track-changes action meta on a transaction. */
export function setAction<K extends keyof TrackChangesActionParams>(
  tr: Transaction,
  action: K,
  payload: TrackChangesActionParams[K],
) {
  return tr.setMeta(action, payload);
}

/** Marks a transaction as not to be tracked. Use with caution. */
export const skipTracking = (tr: Transaction) =>
  setAction(tr, TrackChangesAction.skipTrack, true);

export const isIndentationAction = (action: ReturnType<typeof getAction>) =>
  action === "indent" || action === "unindent";

/** Explicit proposal intent is independent of automatic tracking of user edits. */
/** Who a suggestion is from, and the host's name for it. */
export interface SuggestionIntent {
  authorID: string;
  /** Stored on every change the suggestion writes; see `TrackedAttrs.operationId`. */
  operationId?: string;
}

export function trackAsSuggestion(tr: Transaction, authorID: string, options: { operationId?: string } = {}): Transaction {
  return setAction(tr, TrackChangesAction.suggest, {
    authorID,
    ...(options.operationId !== undefined ? { operationId: options.operationId } : {}),
  });
}

/** Appended normalization steps belong to the same proposal as their root transaction. */
export function suggestionIntent(tr: Transaction): SuggestionIntent | undefined {
  const root: Transaction | undefined = tr.getMeta("appendedTransaction");
  return getAction(tr, TrackChangesAction.suggest) ?? (root && getAction(root, TrackChangesAction.suggest));
}
