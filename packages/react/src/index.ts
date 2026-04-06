// React adapter for @scrivr/core

export { useScrivrEditor } from "./useScrivrEditor";
export { BubbleMenu } from "./BubbleMenu";
export { FloatingMenu } from "./FloatingMenu";
export { LinkPopover } from "./LinkPopover";
export { ImageMenu } from "./ImageMenu";
export { SlashMenu } from "./SlashMenu";
export { AiSuggestionCardsPanel, useAiSuggestionCards } from "./AiSuggestionCards";
export type { SlashMenuItem } from "./SlashMenu";
export { TrackChangesPopover } from "./TrackChangesPopover";
export { AiSuggestionPopover } from "./AiSuggestionPopover";
export type {
  AiSuggestionCardsPanelProps,
  AiSuggestionCardClassNames,
  AiSuggestionCardStyles,
} from "./AiSuggestionCards";
export { TrackChangesPanel } from "./TrackChangesPanel";
export type { UseCanvasEditorOptions } from "./useScrivrEditor";

export { Scrivr } from "./Scrivr";
export type { ScrivrProps } from "./Scrivr";

export { useScrivrState as useEditorState, shallowEqual, deepEqual } from "./useScrivrState";
export type { UseEditorStateOptions, EditorStateContext } from "./useScrivrState";

// Re-export core types consumers need when building with this adapter
export type { Editor, SelectionSnapshot } from "@scrivr/core";
export { StarterKit, Pagination, defaultPageConfig, DEFAULT_FONT_FAMILY, ViewManager, FontFamily, Link } from "@scrivr/core";
export type { PageConfig, DocumentLayout, Extension, ViewManagerOptions } from "@scrivr/core";
export { Collaboration, CollaborationCursor } from "@scrivr/plugins";
