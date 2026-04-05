// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  TextStyle,
  AiOpType,
  AiOp,
  AiSuggestionBlock,
  AiSuggestion as AiSuggestionData,
  AiSuggestionPluginState,
  ApplyAiSuggestionOptions,
  RejectAiSuggestionOptions,
} from "./types";

// ── Plugin ────────────────────────────────────────────────────────────────────
export {
  aiSuggestionPlugin,
  aiSuggestionPluginKey,
  AI_SUGGESTION_SET,
  AI_SUGGESTION_SET_STALE,
  AI_SUGGESTION_SET_HOVER,
  AI_SUGGESTION_SET_ACTIVE,
} from "./AiSuggestionPlugin";

// ── Extension ─────────────────────────────────────────────────────────────────
export { AiSuggestion } from "./AiSuggestion";

// ── Commands ─────────────────────────────────────────────────────────────────
export { showAiSuggestion, applyAiSuggestion, rejectAiSuggestion } from "./showHideApply";

// ── Compute ───────────────────────────────────────────────────────────────────
export { computeAiSuggestion } from "./computeAiSuggestion";
export type { ComputeAiSuggestionOptions } from "./computeAiSuggestion";

// ── Vanilla JS subscription ───────────────────────────────────────────────────
export { subscribeToAiSuggestions } from "./subscribeToAiSuggestions";
export type {
  AiSuggestionCardData,
  AiSuggestionCardActions,
} from "./subscribeToAiSuggestions";

// ── Popover controller ────────────────────────────────────────────────────────
export { createSuggestionPopover } from "./createSuggestionPopover";
export type {
  SuggestionGroupInfo,
  SuggestionPopoverCallbacks,
} from "./createSuggestionPopover";

// ── Render helpers (for advanced custom overlays) ─────────────────────────────
export {
  renderDeleteHighlight,
  renderInsertMarker,
  buildOpRenderInstructions,
  renderInstructions,
} from "./renderAiSuggestionOps";
export type {
  InsertRenderInstruction,
  DeleteRenderInstruction,
  RenderInstruction,
} from "./renderAiSuggestionOps";
