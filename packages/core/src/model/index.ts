export { schema } from "./schema";
export type { NodeTypeName, MarkTypeName } from "./schema";
export { createEditorState, createEditorStateFromJSON } from "./state";
export type { EditorState } from "./state";
export * from "./commands";
export {
  defaultEditorTheme,
  defaultPdfTheme,
  mergeEditorTheme,
  themeContainsCssVars,
} from "./theme";
export type { EditorTheme, ResolvedTheme } from "./theme";
export { resolveTheme, resolveThemeColor, disposeProbe } from "./resolveTheme";
