// React adapter for @scrivr/core

export { useScrivrEditor } from "./hooks/useScrivrEditor";
export { BubbleMenu } from "./components/BubbleMenu";
export { useBubbleMenu } from "./hooks/useBubbleMenu";
export { FloatingMenu } from "./components/FloatingMenu";
export { useFloatingMenu } from "./hooks/useFloatingMenu";
export { LinkPopover } from "./components/LinkPopover";
export { useLinkPopover } from "./hooks/useLinkPopover";
export { ImageMenu } from "./components/ImageMenu";
export { useImageMenu } from "./hooks/useImageMenu";
export { SlashMenu } from "./components/SlashMenu";
export { useSlashMenu } from "./hooks/useSlashMenu";
export { AiSuggestionCardsPanel } from "./components/AiSuggestionCards";
export { useAiSuggestionCards } from "./hooks/useAiSuggestionCards";
export type { SlashMenuProps } from "./components/SlashMenu";
export type { SlashMenuItem, UseSlashMenuOptions } from "./hooks/useSlashMenu";
export { TrackChangesPopover } from "./components/TrackChangesPopover";
export { useTrackChangesPopover } from "./hooks/useTrackChangesPopover";
export { AiSuggestionPopover } from "./components/AiSuggestionPopover";
export { useAiSuggestionPopover } from "./hooks/useAiSuggestionPopover";
export type { BubbleMenuProps } from "./components/BubbleMenu";
export type { FloatingMenuProps } from "./components/FloatingMenu";
export type { LinkPopoverProps } from "./components/LinkPopover";
export type { ImageMenuProps } from "./components/ImageMenu";
export type { ImageVerticalAlign, ImageWrappingMode } from "./hooks/useImageMenu";
export type { TrackChangesPopoverProps } from "./components/TrackChangesPopover";
export type { AiSuggestionPopoverProps } from "./components/AiSuggestionPopover";
export type { UseAiSuggestionPopoverOptions } from "./hooks/useAiSuggestionPopover";
export type {
  AiSuggestionCardsPanelProps,
  AiSuggestionCardClassNames,
  AiSuggestionCardStyles,
} from "./components/AiSuggestionCards";
export { TrackChangesPanel } from "./components/TrackChangesPanel";
export { useTrackChangesPanel } from "./hooks/useTrackChangesPanel";
export type { TrackChangesPanelProps } from "./components/TrackChangesPanel";
export { HeaderFooterRibbon } from "./components/HeaderFooterRibbon";
export { useHeaderFooterRibbon } from "./hooks/useHeaderFooterRibbon";
export type {
  HeaderFooterRibbonItem,
} from "./hooks/useHeaderFooterRibbon";
export type { HeaderFooterRibbonProps } from "./components/HeaderFooterRibbon";
export type { UseCanvasEditorOptions } from "./hooks/useScrivrEditor";

export { Scrivr } from "./components/Scrivr";
export type { ScrivrProps } from "./components/Scrivr";

export { useScrivrState as useEditorState, shallowEqual, deepEqual } from "./hooks/useScrivrState";
export type { UseEditorStateOptions, EditorStateContext } from "./hooks/useScrivrState";

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
