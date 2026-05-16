// React adapter for @scrivr/core

export { useScrivrEditor } from "./useScrivrEditor";
export { BubbleMenu, useBubbleMenu } from "./BubbleMenu";
export { FloatingMenu, useFloatingMenu } from "./FloatingMenu";
export { LinkPopover, useLinkPopover } from "./LinkPopover";
export { ImageMenu, useImageMenu } from "./ImageMenu";
export { SlashMenu, useSlashMenu } from "./SlashMenu";
export { AiSuggestionCardsPanel, useAiSuggestionCards } from "./AiSuggestionCards";
export type { SlashMenuItem, SlashMenuProps, UseSlashMenuOptions } from "./SlashMenu";
export { TrackChangesPopover, useTrackChangesPopover } from "./TrackChangesPopover";
export { AiSuggestionPopover, useAiSuggestionPopover } from "./AiSuggestionPopover";
export type { BubbleMenuProps } from "./BubbleMenu";
export type { FloatingMenuProps } from "./FloatingMenu";
export type { LinkPopoverProps } from "./LinkPopover";
export type { ImageMenuProps } from "./ImageMenu";
export type { ImageVerticalAlign, ImageWrappingMode } from "./ImageMenu";
export type { TrackChangesPopoverProps } from "./TrackChangesPopover";
export type { AiSuggestionPopoverProps, UseAiSuggestionPopoverOptions } from "./AiSuggestionPopover";
export type {
  AiSuggestionCardsPanelProps,
  AiSuggestionCardClassNames,
  AiSuggestionCardStyles,
} from "./AiSuggestionCards";
export { TrackChangesPanel, useTrackChangesPanel } from "./TrackChangesPanel";
export type { TrackChangesPanelProps } from "./TrackChangesPanel";
export { HeaderFooterRibbon, useHeaderFooterRibbon } from "./HeaderFooterRibbon";
export type {
  HeaderFooterRibbonItem,
  HeaderFooterRibbonProps,
} from "./HeaderFooterRibbon";
export type { UseCanvasEditorOptions } from "./useScrivrEditor";

export { Scrivr } from "./Scrivr";
export type { ScrivrProps } from "./Scrivr";

export { useScrivrState as useEditorState, shallowEqual, deepEqual } from "./useScrivrState";
export type { UseEditorStateOptions, EditorStateContext } from "./useScrivrState";

// Re-export core types consumers need when building with this adapter
export type { Editor, SelectionSnapshot } from "@scrivr/core";
export { StarterKit, Pagination, defaultPageConfig, DEFAULT_FONT_FAMILY, FontFamily, Link } from "@scrivr/core";
export type { PageConfig, DocumentLayout, Extension } from "@scrivr/core";
export {
  defaultEditorTheme,
  defaultPdfTheme,
  mergeEditorTheme,
  themeContainsCssVars,
} from "@scrivr/core";
export type { EditorTheme, ResolvedTheme } from "@scrivr/core";
export { Collaboration, CollaborationCursor } from "@scrivr/plugins";
