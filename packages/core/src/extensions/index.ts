// Side-effect import — registers all built-in extension declare module blocks
import "./built-in/augmentations";

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
export { FontFamily } from "./built-in/FontFamily";
export { Link } from "./built-in/Link";
export { Alignment } from "./built-in/Alignment";
export { List } from "./built-in/List";
export { Pagination } from "./built-in/Pagination";
export { Image } from "./built-in/Image";
export { ClearFormatting } from "./built-in/ClearFormatting";

export type {
  ExtensionConfig,
  ExtensionContext,
  IBaseEditor,
  IEditor,
  ResolvedExtension,
  MarkDecorator,
  SpanRect,
  FontModifier,
  ToolbarItemSpec,
  OverlayRenderHandler,
} from "./types";
