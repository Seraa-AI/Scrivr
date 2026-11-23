// React adapter for @scrivr/core. Needs only @scrivr/core: components built on
// @scrivr/plugins live in "./track-changes" and "./header-footer", those on
// @scrivr/ai in "./ai".

export { useScrivrEditor } from "./hooks/useScrivrEditor";
export { useZoom, useZoomRequest } from "./hooks/useZoom";
export { BubbleMenu } from "./components/BubbleMenu";
export { useBubbleMenu } from "./hooks/useBubbleMenu";
export { FloatingMenu } from "./components/FloatingMenu";
export { useFloatingMenu } from "./hooks/useFloatingMenu";
export { LinkPopover } from "./components/LinkPopover";
export { useLinkPopover } from "./hooks/useLinkPopover";
export { ImageMenu } from "./components/ImageMenu";
export { useImageMenu } from "./hooks/useImageMenu";
export { TableMenu } from "./components/TableMenu";
export { useTableMenu } from "./hooks/useTableMenu";
export { SlashMenu } from "./components/SlashMenu";
export { useSlashMenu } from "./hooks/useSlashMenu";
export type { SlashMenuProps } from "./components/SlashMenu";
export type { SlashMenuItem, UseSlashMenuOptions } from "./hooks/useSlashMenu";
export type { BubbleMenuProps } from "./components/BubbleMenu";
export type { FloatingMenuProps } from "./components/FloatingMenu";
export type { LinkPopoverProps, LinkPopoverState } from "./components/LinkPopover";
export type { UseLinkPopoverOptions } from "./hooks/useLinkPopover";
export type { ImageMenuProps, ImageMenuState } from "./components/ImageMenu";
export type { UseImageMenuOptions } from "./hooks/useImageMenu";
export type { TableMenuProps, TableMenuState } from "./components/TableMenu";
export type { UseTableMenuOptions } from "./hooks/useTableMenu";
export type { ImageVerticalAlign, ImageWrappingMode } from "./hooks/useImageMenu";
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
// The font lane, so an app configuring one never has to reach past the adapter.
export { DefaultFontProvider } from "@scrivr/core";
export type {
  ActiveFontFamily,
  DefaultFontProviderOptions,
  FontFamilyOption,
  FontKey,
  FontSynthesis,
  FontProvider,
  FontRequest,
  FontResource,
  FontResolution,
  FontShortfall,
} from "@scrivr/core";
