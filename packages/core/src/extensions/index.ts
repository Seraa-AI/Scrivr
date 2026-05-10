export { Extension } from "./Extension";
export { ExtensionManager, getSchema } from "./ExtensionManager";
export { StarterKit } from "./StarterKit";

// Built-in extensions — individually importable
export { Document } from "./built-in/Document";
export { Paragraph } from "./built-in/Paragraph";
export { Heading } from "./built-in/Heading";
export { Bold } from "./built-in/Bold";
export { Italic } from "./built-in/Italic";
export { History } from "./built-in/History";
export { Highlight } from "./built-in/Highlight";
export { Underline } from "./built-in/Underline";
export { Strikethrough } from "./built-in/Strikethrough";
export { Color } from "./built-in/Color";
export { FontSize } from "./built-in/FontSize";
export { FontFamily } from "./built-in/FontFamily";
export { Link } from "./built-in/Link";
export { Alignment } from "./built-in/Alignment";
export { Indent, INDENT_STEP, TEXT_INDENT_STEP } from "./built-in/Indent";
export { List } from "./built-in/List";
export { Pagination } from "./built-in/Pagination";
export { Image } from "./built-in/Image";
export { CodeBlock } from "./built-in/CodeBlock";
export { HorizontalRule } from "./built-in/HorizontalRule";
export { PageBreak } from "./built-in/PageBreak";
export { ClearFormatting } from "./built-in/ClearFormatting";
export { DefaultContent, type DefaultContentOptions } from "./built-in/DefaultContent";

export type {
  ExtensionConfig,
  ExtensionContext,
  InitialDocContext,
  IBaseEditor,
  IEditor,
  ResolvedExtension,
  MarkDecorator,
  SpanRect,
  FontModifier,
  ToolbarItemSpec,
  OverlayRenderHandler,
} from "./types";
export type { FormatHandlers, ExportContributionMap } from "./export";
