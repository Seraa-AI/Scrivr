export { TrackChanges } from "./TrackChanges";
export { applyDiffAsSuggestion, applyMultiBlockDiff, namedMoreThanOnce } from "./lib/applyDiffAsSuggestion";
export type { ApplyDiffOptions, MultiBlockDiffOptions, ApplyDiffResult, MultiBlockDiffResult } from "./lib/applyDiffAsSuggestion";
export { buildParagraphContexts } from "./lib/buildParagraphContexts";
export type { ParagraphContext } from "./lib/buildParagraphContexts";
export { diffText, pairReplacements, phraseReplacements } from "./lib/diffText";
export type { DiffOp, PairedDiffOp } from "./lib/diffText";
export {
  buildAcceptedTextMap,
  bridgeable,
  acceptedOffsetToDocPos,
  acceptedRangeToDocRange,
  docRangeToAcceptedRange,
  acceptedTextMapFor,
} from "./lib/acceptedTextMap";
export type { PosMapEntry, AcceptedTextMapResult } from "./lib/acceptedTextMap";
export { acceptedMarksAt, plainProposalMarks, plainTextSpans } from "./lib/plainProposalMarks";
// Record writers and builders, kept for hosts that build records by hand. No
// lane uses them: every lane writes plain edits and the engine records them.
export { splitRangeForNewMark, applyTrackedDelete, applyTrackedInsert } from "./lib/splitRangeForNewMark";
export {
  addTrackIdIfDoesntExist,
  createNewDeleteAttrs,
  createNewInsertAttrs,
  createNewPendingAttrs,
  proposedForDeletion,
} from "./helpers";
export { changePreviewText, createChangePopover } from "./createChangePopover";
export { changedAttrKeys, describeAttrChanges } from "./attrChanges";
export type { ChangePopoverInfo, ChangePopoverCallbacks } from "./createChangePopover";
export { isTrackedMark } from "./helpers";
export { trackChangesPluginKey } from "./engine/trackChangesPlugin";
export { findChanges } from "./findChanges";
export { findLiveNodeById, isShadowNode, moveShadowRanges, shadowRanges } from "./liveNode";
export { originalDocument } from "./originalView";
export type { ShadowRange } from "./liveNode";
export { applyChanges } from "./applyChanges";
export { ChangeSet } from "./ChangeSet";
export {
  setAction,
  getAction,
  hasAction,
  skipTracking,
  trackAsSuggestion,
  TrackChangesAction,
} from "./actions";
export type { TrackChangesActionParams } from "./actions";
export { suggestionBlocked } from "./suggestionBlocked";
export { TrackChangesStatus, CHANGE_STATUS, CHANGE_OPERATION } from "./types";
export type { TrackChangesState } from "./engine/trackChangesPlugin";
export type {
  TrackChangesOptions,
  TrackChangesRenderMode,
  ReplacementView,
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
  TrackingResult,
  TrackingRefusal,
  SuggestionBlock,
  ListLevel,
  ReplacedMark,
} from "./types";

// Rich (leaf-based) semantic edits → tracked suggestions. The write-side merge
// primitive @scrivr/ai's applyRichEdit drives.
export { applyRichDiffAsSuggestion, pickAgentAttrs } from "./lib/applyRichDiffAsSuggestion";
export type { RichBlockEdit, RichDiffOptions, RichDiffResult } from "./lib/applyRichDiffAsSuggestion";
export { clearAuthorPendingMarks } from "./lib/applyDiffAsSuggestion";
export { writeProposal } from "./lib/writeProposal";

export { planChangeReview, changeActs } from "./reviewPlan";
export { planReview, planReviewIn, reviewChanges } from "./reviewChanges";
export type {
  ChangeAct,
  ReviewPlan,
  ReviewOutcome,
  ReviewRefusal,
  ReviewUnavailable,
  ReviewPlanResult,
  ReviewDependency,
  ReviewDecision,
  ReviewDecisions,
} from "./reviewPlan";

