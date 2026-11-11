export { Extension } from "./Extension";
export { ExtensionManager, getSchema, flattenExtensions } from "./ExtensionManager";
export { StarterKit } from "./StarterKit";
export { KeymapPriority, DEFAULT_SLASH_ORDER } from "./types";

// Built-in extensions — individually importable
export { Document } from "./built-in/Document";
export { HardBreak } from "./built-in/HardBreak";
export { Field, listSignerFields } from "./built-in/Field";
export type {
  FieldFill,
  FieldKind,
  InsertFieldOptions,
  SignerFieldDescriptor,
} from "./built-in/Field";
export type { FieldRangeKind, InsertFieldRangeOptions } from "./built-in/fieldRange";
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
// A list container from another extension declares List's wrapper to be drawn as a list.
export { listWrap } from "./built-in/listLayout";
export { Pagination } from "./built-in/Pagination";
export { Image, prepareDocxImages, IMAGE_PLACEMENT_ATTRS } from "./built-in/Image";
export { CodeBlock } from "./built-in/CodeBlock";
export { HorizontalRule } from "./built-in/HorizontalRule";
export { PageBreak } from "./built-in/PageBreak";
export { Sections } from "./built-in/Sections";
export { Table } from "./built-in/Table";
export { SourcedBlockExtension } from "./built-in/SourcedBlock";
// Reconciliation is the host's job — it owns the trigger (there is no safe one
// under collaborative editing), core only supplies the pure parts: read the
// provenance out of a document, recompute a content hash to compare against a
// source, and read which instances have drifted.
export {
  collectSourcedBlocks,
  computeBlockHash,
  sourcedBlockDivergenceKey,
  NORMALIZER_VERSION,
} from "./built-in/SourcedBlock";
// The provider contract a host implements, and the events it is handed.
export type {
  SourceProvider,
  SourceContent,
  SourceSearchResult,
  SourceCapability,
  SourcedBlockEvent,
  SourcedBlockChangedEvent,
  SourcedBlockOptions,
  SourcedBlockRecord,
  SourcedBlockDivergenceState,
} from "./built-in/SourcedBlock";
export { UniqueId, findNodeById, COLLAB_SYNC_META, NORMALIZATION_META } from "./built-in/UniqueId";
export { TrailingNode } from "./built-in/TrailingNode";
export { Typography } from "./built-in/Typography";
export { ClearFormatting } from "./built-in/ClearFormatting";
export { DefaultContent, type DefaultContentOptions } from "./built-in/DefaultContent";

export type {
  ExtensionConfig,
  ExtensionContext,
  ScrivrNodeSpec,
  PasteTransform,
  PasteHtmlTransform,
  CopyHtmlTransform,
  PasteFileHandler,
  PasteFileSpec,
  InitialDocContext,
  IBaseEditor,
  IEditor,
  ResolvedExtension,
  MarkDecorator,
  SpanRect,
  FontModifier,
  ToolbarItemSpec,
  BlockAncestor,
  BlockInfo,
  ToolbarState,
  SlashCommandSpec,
  SlashCommandContribution,
  SlashCommandResolver,
  OverlayRenderHandler,
  CloneHandler,
  CloneHandlerContext,
} from "./types";
// Node actions: the contract an extension contributes and a UI renders.
export type {
  NodeAction,
  NodeActionContribution,
  NodeActionContext,
  ResolvedNodeAction,
} from "../selection/types";
export type {
  GestureContext,
  HitTarget,
  HitTestContext,
  HitTester,
  SelectionBehavior,
  SelectionCapabilities,
  SelectionDescribeContext,
  SelectionDescriptor,
  SelectionGeometryContext,
  SelectionGesture,
  SelectionGestureProvider,
  SelectionHandle,
  SelectionPrimitive,
  SelectionRect,
  SelectionRole,
} from "../selection/types";
export type {
  HoverTarget,
  HoverEvent,
  HoverResolver,
  MarkHoverResolver,
  NodeHoverResolver,
} from "../hover/types";
export type { TableShape } from "../table/describeTable";
// The seam's public API speaks ProseMirror `Selection`; re-export it so
// extension authors get the whole selection vocabulary from "@scrivr/core".
export type { Selection } from "prosemirror-state";
export type {
  FormatHandlers,
  ExportContributionMap,
  FormatImportHandlers,
  ImportContributionMap,
} from "./export";
