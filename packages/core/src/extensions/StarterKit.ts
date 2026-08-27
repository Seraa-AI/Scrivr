import { Extension } from "./Extension";
import { Document } from "./built-in/Document";
import { HardBreak } from "./built-in/HardBreak";
import { Paragraph } from "./built-in/Paragraph";
import { Heading, type HeadingLevel } from "./built-in/Heading";
import { Bold } from "./built-in/Bold";
import { Italic } from "./built-in/Italic";
import { History } from "./built-in/History";
import { BaseEditing } from "./built-in/BaseEditing";
import { Underline } from "./built-in/Underline";
import { Strikethrough } from "./built-in/Strikethrough";
import { Highlight } from "./built-in/Highlight";
import { Color } from "./built-in/Color";
import { FontSize } from "./built-in/FontSize";
import { FontFamily } from "./built-in/FontFamily";
import { Link } from "./built-in/Link";
import { List } from "./built-in/List";
import { Alignment } from "./built-in/Alignment";
import { Indent } from "./built-in/Indent";
import { CodeBlock } from "./built-in/CodeBlock";
import { HorizontalRule } from "./built-in/HorizontalRule";
import { PageBreak } from "./built-in/PageBreak";
import { Sections } from "./built-in/Sections";
import { Image } from "./built-in/Image";
import { Table } from "./built-in/Table";
import { SourcedBlockExtension } from "./built-in/SourcedBlock";
import { UniqueId } from "./built-in/UniqueId";
import { Typography } from "./built-in/Typography";
import { TrailingNode } from "./built-in/TrailingNode";
import { ClearFormatting } from "./built-in/ClearFormatting";
import { defaultPageConfig } from "../layout/PageLayout";
import type { PageConfig } from "../layout/PageLayout";

interface StarterKitOptions {
  /** Page dimensions and margins. Pass false to exclude the Pagination extension entirely. Defaults to A4 with 1-inch margins. */
  pagination?: false | Partial<PageConfig>;
  /** Pass false to exclude this extension entirely */
  document?: false;
  /**
   * The `hardBreak` inline node (Shift-Enter line breaks inside a block).
   * Pass `false` to drop the node entirely, or `{ shortcut: false }` to
   * keep the node + insertHardBreak command but remove the Shift-Enter
   * binding (useful when a different extension wants to own that key).
   */
  hardBreak?: false | { shortcut?: boolean };
  paragraph?: false;
  heading?: false | { levels?: HeadingLevel[] };
  bold?: false | { shortcut?: boolean };
  italic?: false | { shortcut?: boolean };
  history?: false | { depth?: number; newGroupDelay?: number };
  underline?: false;
  strikethrough?: false;
  highlight?: false | { color?: string; multicolor?: boolean };
  color?: false | { colors?: string[] };
  fontSize?: false | { sizes?: number[] };
  fontFamily?: false | { families?: string[] };
  link?: false;
  list?: false;
  alignment?: false;
  codeBlock?: false;
  horizontalRule?: false;
  pageBreak?: false;
  /**
   * `Sections` — the `sectionBreak` node and `finalSection` doc attr that
   * partition the document for columns and (later) per-section page chrome
   * and geometry. A document with no breaks is one implicit section, which is
   * exactly today's behavior. Pass `false` to exclude it.
   */
  sections?: false;
  image?: false;
  /**
   * Tables are an opt-in preview while the layout/render/export pipeline
   * is filled in (Phases 2–4 of `docs/tables.md`). Default is `false` —
   * pass `true` to register the Table schema/commands/placeholder render.
   *
   * @example
   * StarterKit.configure({ table: true })
   */
  table?: true;
  /**
   * Sourced blocks are opt-in. Default is `false` — pass `true` to register the schema/commands/actions.
   */
  sourcedBlock?: true;
  typography?: false;
  trailingNode?: false;
  clearFormatting?: false;
  /**
   * `UniqueId` — stamps every new block with a stable `nodeId` at edit-time so
   * ids persist and stay stable across reloads (needed for track changes,
   * diffs, and semantic chunking, with or without the AI toolkit). Pass `false`
   * to exclude it.
   */
  uniqueId?: false;
}

/**
 * StarterKit — batteries-included default for new editors.
 *
 * It contributes nothing of its own except the page config; it is a *list*.
 * `addExtensions()` hands its children to `ExtensionManager`, which flattens
 * them and collects their contributions exactly as if the consumer had listed
 * each one directly. That is deliberate: a kit that forwarded contributions by
 * hand would silently drop every seam added after it was last edited, which is
 * the bug that produced the Tab keymap, image selection, and table
 * `onViewReady` regressions.
 *
 * @example
 * new Editor({ extensions: [StarterKit] })
 * new Editor({ extensions: [StarterKit.configure({ history: false })] })
 * new Editor({ extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } })] })
 * new Editor({ extensions: [StarterKit, Highlight, MyImageExtension] })
 */
export const StarterKit = Extension.create<StarterKitOptions>({
  name: "starterKit",

  /**
   * This list carries exactly ONE ordering constraint, and it is a schema one:
   * **Paragraph must come first.** ProseMirror fills a `block+` content
   * expression with the first matching block type in the schema, so whichever
   * block node registers first becomes the default — put CodeBlock ahead of
   * Paragraph and an empty document opens as a code block.
   *
   * Keybinding precedence is NOT decided here. It comes from each extension's
   * `keymapPriority` (see `ExtensionManager.buildKeymap`), because the keymap
   * needs a different order than the schema does — Table before CodeBlock
   * before List before Paragraph — and one list cannot encode two orderings.
   * Reordering anything below the first entry is therefore safe.
   */
  addExtensions() {
    const opts = this.options;
    const extensions: Extension[] = [];

    // Must be first — see above.
    if (opts.paragraph !== false) extensions.push(Paragraph);

    // ── Structure ────────────────────────────────────────────────────────────
    if (opts.document !== false) extensions.push(Document);
    if (opts.hardBreak !== false) extensions.push(HardBreak.configure(opts.hardBreak));
    if (opts.heading !== false) extensions.push(Heading.configure(opts.heading));
    if (opts.list !== false) extensions.push(List);
    if (opts.codeBlock !== false) extensions.push(CodeBlock.configure(opts.codeBlock));
    if (opts.table === true) extensions.push(Table);
    if (opts.sourcedBlock === true) extensions.push(SourcedBlockExtension);
    if (opts.horizontalRule !== false) extensions.push(HorizontalRule);
    if (opts.pageBreak !== false) extensions.push(PageBreak);
    if (opts.sections !== false) extensions.push(Sections);
    if (opts.image !== false) extensions.push(Image);
    // Backspace + Delete are not optional — the editor is unusable without them.
    extensions.push(BaseEditing);

    // ── Marks ────────────────────────────────────────────────────────────────
    if (opts.bold !== false) extensions.push(Bold.configure(opts.bold));
    if (opts.italic !== false) extensions.push(Italic.configure(opts.italic));
    if (opts.underline !== false) extensions.push(Underline);
    if (opts.strikethrough !== false) extensions.push(Strikethrough);
    if (opts.highlight !== false) extensions.push(Highlight.configure(opts.highlight));
    if (opts.color !== false) extensions.push(Color.configure(opts.color));
    if (opts.fontSize !== false) extensions.push(FontSize.configure(opts.fontSize));
    if (opts.fontFamily !== false) extensions.push(FontFamily.configure(opts.fontFamily));
    if (opts.link !== false) extensions.push(Link);

    // ── Block formatting ─────────────────────────────────────────────────────
    if (opts.alignment !== false) extensions.push(Alignment);
    extensions.push(Indent);
    if (opts.clearFormatting !== false) extensions.push(ClearFormatting);

    // ── Behaviour ────────────────────────────────────────────────────────────
    if (opts.history !== false) extensions.push(History.configure(opts.history));
    if (opts.typography !== false) extensions.push(Typography);
    if (opts.trailingNode !== false) extensions.push(TrailingNode);
    if (opts.uniqueId !== false) extensions.push(UniqueId);

    return extensions;
  },

  addPageConfig() {
    // Resolve StarterKit's nested `pagination` option into a PageConfig the
    // manager can hand to layout. Three states:
    //   undefined  — unset; StarterKit holds no opinion, let a downstream
    //                extension (or Editor's defaultPageConfig fallback) win
    //   false      — explicit opt-out; contribute nothing
    //   object     — explicit override; merge over defaults
    //
    // Returning undefined for the unset case is what lets the common
    // `[StarterKit, Pagination.configure(usLetter)]` pattern resolve to
    // usLetter — StarterKit doesn't claim the slot it never opted into.
    const opt = this.options.pagination;
    if (opt === false || opt === undefined) return undefined;
    return { ...defaultPageConfig, ...opt };
  },
});
