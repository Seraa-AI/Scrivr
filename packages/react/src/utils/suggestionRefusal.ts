import type { TrackingRefusal } from "@scrivr/plugins";

/** What to tell someone whose edit was stopped, and what they can do instead. */
export interface SuggestionRefusalText {
  message: string;
  remedy: string;
}

const TEXT: Record<TrackingRefusal["reason"], SuggestionRefusalText> = {
  "overlapping-steps": {
    message: "This edit changes your new suggestion and the text around it at once, so it can't be suggested.",
    remedy: "Make it in two steps, or accept or reject your suggestion first.",
  },
  "unsupported-step": {
    message: "This kind of change can't be suggested yet.",
    remedy: "Ask someone who can edit directly, or turn suggesting off if you're allowed to.",
  },
  "duplicate-transform-package": {
    message: "Suggestions are unavailable because the editor is set up incorrectly.",
    remedy: "Report this to whoever maintains this editor.",
  },
};

/** Words for an edit `TrackChanges` stopped through `onRefused`. */
export function describeSuggestionRefusal(refusal: TrackingRefusal): SuggestionRefusalText {
  return TEXT[refusal.reason];
}
