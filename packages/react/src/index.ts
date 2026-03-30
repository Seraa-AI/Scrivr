// React adapter for @inscribe/core

export { useCanvasEditor } from "./useCanvasEditor";
export { BubbleMenu } from "./BubbleMenu";
export { FloatingMenu } from "./FloatingMenu";
export { LinkPopover } from "./LinkPopover";
export { ImageMenu } from "./ImageMenu";
export { SlashMenu } from "./SlashMenu";
export type { SlashMenuItem } from "./SlashMenu";
export { TrackChangesPopover } from "./TrackChangesPopover";
export type { UseCanvasEditorOptions } from "./useCanvasEditor";

export { Canvas } from "./Canvas";
export type { CanvasProps } from "./Canvas";

export { useEditorState, shallowEqual, deepEqual } from "./useEditorState";
export type { UseEditorStateOptions, EditorStateContext } from "./useEditorState";

// Re-export core types consumers need when building with this adapter
// TODO: these re-exports force every @inscribe/react consumer to transitively
// install @inscribe/core and @inscribe/plugins even if they don't use
// Collaboration or AI. Fix by removing re-exports here and having consumers
// import directly from @inscribe/core / @inscribe/plugins themselves.
export type { Editor, SelectionSnapshot } from "@inscribe/core";
export { StarterKit, Pagination, defaultPageConfig, ViewManager, FontFamily, Link } from "@inscribe/core";
export type { PageConfig, DocumentLayout, Extension, ViewManagerOptions } from "@inscribe/core";
export { Collaboration, CollaborationCursor } from "@inscribe/plugins";
