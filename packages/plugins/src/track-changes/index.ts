export { TrackChanges } from "./TrackChanges";
export { applyDiffAsSuggestion, applyMultiBlockDiff } from "./lib/applyDiffAsSuggestion";
export type { ApplyDiffOptions, MultiBlockDiffOptions, ApplyDiffResult } from "./lib/applyDiffAsSuggestion";
export { buildParagraphContexts } from "./lib/buildParagraphContexts";
export type { ParagraphContext } from "./lib/buildParagraphContexts";
export { diffText, pairReplacements } from "./lib/diffText";
export type { DiffOp, PairedDiffOp } from "./lib/diffText";
export { buildAcceptedTextMap, acceptedOffsetToDocPos, acceptedRangeToDocRange } from "./lib/acceptedTextMap";
export type { PosMapEntry, AcceptedTextMapResult } from "./lib/acceptedTextMap";
export { splitRangeForNewMark, applyTrackedDelete, applyTrackedInsert } from "./lib/splitRangeForNewMark";
// Tracked-attrs builders — consumed by @scrivr/ai's suggestion apply path.
export {
  addTrackIdIfDoesntExist,
  createNewDeleteAttrs,
  createNewInsertAttrs,
  createNewPendingAttrs,
} from "./helpers";
export { createChangePopover } from "./createChangePopover";
export type { ChangePopoverInfo, ChangePopoverCallbacks } from "./createChangePopover";
export { trackChangesPluginKey } from "./engine/trackChangesPlugin";
export { findChanges } from "./findChanges";
export { applyChanges } from "./applyChanges";
export { ChangeSet } from "./ChangeSet";
export {
  setAction,
  getAction,
  hasAction,
  skipTracking,
  TrackChangesAction,
} from "./actions";
export type { TrackChangesActionParams } from "./actions";
export { TrackChangesStatus, CHANGE_STATUS, CHANGE_OPERATION } from "./types";
export type {
  TrackChangesOptions,
  TrackedAttrs,
  TrackedChange,
  TextChange,
  NodeChange,
  NodeAttrChange,
  WrapChange,
  MarkChange,
  ReferenceChange,
  ChangeStep,
  IncompleteChange,
} from "./types";
