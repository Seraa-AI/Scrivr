// Through each entry, as a consumer imports them: `tsc` fails here the moment
// a name leaves its entry, and the root must not take any of them back.
import { expect, it } from "vitest";
import * as root from "./index";
import {
  ReviewRefusalNotice,
  TrackChangesPanel,
  TrackChangesPopover,
  describeSuggestionRefusal,
  useReviewAction,
  useTrackChangesPanel,
  useTrackChangesPopover,
  type ReviewAction,
  type ReviewRefusalNoticeProps,
  type ReviewRefusalState,
  type SuggestionRefusalText,
  type TrackChangesDisplayItem,
  type TrackChangesPanelProps,
  type TrackChangesPopoverProps,
} from "./track-changes";
import {
  HeaderFooterRibbon,
  useHeaderFooterRibbon,
  type HeaderFooterRibbonItem,
  type HeaderFooterRibbonProps,
} from "./header-footer";
import {
  AiSuggestionCardsPanel,
  AiSuggestionPopover,
  useAiSuggestionCards,
  useAiSuggestionPopover,
  useBlockMarkerOverlay,
  type AiSuggestionCardClassNames,
  type AiSuggestionCardStyles,
  type AiSuggestionCardsPanelProps,
  type AiSuggestionPopoverProps,
  type UseAiSuggestionPopoverOptions,
} from "./ai";

type EntryTypes = [
  ReviewAction, ReviewRefusalNoticeProps, ReviewRefusalState, SuggestionRefusalText, TrackChangesDisplayItem,
  TrackChangesPanelProps, TrackChangesPopoverProps, HeaderFooterRibbonItem, HeaderFooterRibbonProps,
  AiSuggestionCardClassNames, AiSuggestionCardStyles, AiSuggestionCardsPanelProps, AiSuggestionPopoverProps,
  UseAiSuggestionPopoverOptions,
];

const entries = {
  ReviewRefusalNotice, TrackChangesPanel, TrackChangesPopover, describeSuggestionRefusal, useReviewAction,
  useTrackChangesPanel, useTrackChangesPopover, HeaderFooterRibbon, useHeaderFooterRibbon,
  AiSuggestionCardsPanel, AiSuggestionPopover, useAiSuggestionCards, useAiSuggestionPopover, useBlockMarkerOverlay,
};

it("each component built on an optional package is in its entry and not the root", () => {
  const types: EntryTypes | null = null;
  expect(types).toBeNull();
  for (const [name, value] of Object.entries(entries)) {
    expect(value, name).toBeTypeOf("function");
    expect(Object.keys(root), name).not.toContain(name);
  }
});

it("the root does not re-export collaboration, the entry that loads Yjs", () => {
  expect(Object.keys(root)).not.toContain("Collaboration");
  expect(Object.keys(root)).not.toContain("CollaborationCursor");
});
