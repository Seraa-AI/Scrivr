// React adapter for @inscribe/core

export { useCanvasEditor } from "./useCanvasEditor";
export type { UseCanvasEditorOptions } from "./useCanvasEditor";

export { Canvas } from "./Canvas";
export type { CanvasProps } from "./Canvas";

export { useEditorState, shallowEqual, deepEqual } from "./useEditorState";
export type { UseEditorStateOptions, EditorStateContext } from "./useEditorState";

// Re-export core types consumers need when building with this adapter
export type { Editor, SelectionSnapshot } from "@inscribe/core";
export { StarterKit, Pagination, defaultPageConfig, ViewManager, Collaboration, CollaborationCursor, FontFamily, Link } from "@inscribe/core";
export type { PageConfig, DocumentLayout, Extension, ViewManagerOptions } from "@inscribe/core";
