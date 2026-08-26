import { Transaction } from "@scrivr/core/pm";

import { CHANGE_STATUS, StructureAttrs, TrackChangesStatus } from "./types";

export enum TrackChangesAction {
  skipTrack = "track-changes-skip-tracking",
  setUserID = "track-changes-set-user-id",
  setPluginStatus = "track-changes-set-track-status",
  setChangeStatuses = "track-changes-set-change-statuses",
  refreshChanges = "track-changes-refresh-changes",
  updateMetaNode = "track-changes-update-meta-node",
  structuralChangeAction = "track-changes-structural-change-action",
  indentationAction = "track-changes-indentation-action",
}

export type TrackChangesActionParams = {
  [TrackChangesAction.skipTrack]: boolean;
  [TrackChangesAction.setUserID]: string;
  [TrackChangesAction.setPluginStatus]: TrackChangesStatus;
  [TrackChangesAction.setChangeStatuses]: {
    status: CHANGE_STATUS;
    ids: string[];
  };
  [TrackChangesAction.refreshChanges]: boolean;
  [TrackChangesAction.updateMetaNode]: boolean;
  [TrackChangesAction.structuralChangeAction]: StructureAttrs["action"];
  [TrackChangesAction.indentationAction]: {
    action: "indent" | "unindent";
  };
};

/** Returns true if any track-changes action meta is set on the transaction. */
export function hasAction(tr: Transaction) {
  return Object.values(TrackChangesAction).some(action => !!tr.getMeta(action));
}

/** Gets the payload of a track-changes action meta. */
export function getAction<K extends keyof TrackChangesActionParams>(
  tr: Transaction,
  action: K,
) {
  return tr.getMeta(action) as TrackChangesActionParams[K] | undefined;
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
