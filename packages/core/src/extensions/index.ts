export { Extension } from "./Extension";
export { ExtensionManager } from "./ExtensionManager";
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
export { Alignment } from "./built-in/Alignment";
export { List } from "./built-in/List";
export { Table } from "./built-in/Table";

export type {
  ExtensionConfig,
  ExtensionContext,
  ResolvedExtension,
  MarkDecorator,
  SpanRect,
  FontModifier,
  ToolbarItemSpec,
} from "./types";
