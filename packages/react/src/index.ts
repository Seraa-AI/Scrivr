// React adapter for @inscribe/core

export { useInscribeEditor } from "./useInscribeEditor";
export { BubbleMenu } from "./BubbleMenu";
export { FloatingMenu } from "./FloatingMenu";
export { LinkPopover } from "./LinkPopover";
export { ImageMenu } from "./ImageMenu";
export { SlashMenu } from "./SlashMenu";
export type { SlashMenuItem } from "./SlashMenu";
export { TrackChangesPopover } from "./TrackChangesPopover";
export type { UseCanvasEditorOptions } from "./useInscribeEditor";

export { Inscribe } from "./Inscribe";
export type { InscribeProps } from "./Inscribe";

export { useInscribeState as useEditorState, shallowEqual, deepEqual } from "./useInscribeState";
export type { UseEditorStateOptions, EditorStateContext } from "./useInscribeState";

// Re-export core types consumers need when building with this adapter
export type { Editor, SelectionSnapshot } from "@inscribe/core";
export { StarterKit, Pagination, defaultPageConfig, ViewManager, FontFamily, Link } from "@inscribe/core";
export type { PageConfig, DocumentLayout, Extension, ViewManagerOptions } from "@inscribe/core";
export { Collaboration, CollaborationCursor } from "@inscribe/plugins";
