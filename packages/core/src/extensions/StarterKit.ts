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
import { Image } from "./built-in/Image";
import { Table } from "./built-in/Table";
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
   * ORDER IS BEHAVIOUR — do not alphabetise this list.
   *
   * Keybindings compose in registration order (`ExtensionManager.buildKeymap`
   * chains colliding bindings), so a key's meaning is decided by who gets first
   * refusal. Three orderings below are load-bearing:
   *
   *   Table before CodeBlock before List — Tab means "next cell", then "indent
   *     code", then "sink list item". Each guard returns false when it doesn't
   *     apply. Matches Word: list indent inside a cell uses the indent control,
   *     not Tab.
   *   Table before BaseEditing — table's Backspace/Delete are cell-boundary
   *     guards that must run before the base delete.
   *   List before Paragraph — List's Enter chain ends in `splitBlockInheritAttrs`,
   *     which is precisely Paragraph's Enter. Reversed, Paragraph's binding
   *     would always succeed and `splitListItem` would never run, breaking Enter
   *     inside every list.
   *
   * Everything after that block is order-independent (distinct keys, distinct
   * schema names) and grouped by kind for readability.
   */
  addExtensions() {
    const opts = this.options;
    const extensions: Extension[] = [];

    // ── Order-sensitive: keymap precedence (see above) ───────────────────────
    if (opts.paragraph !== false) extensions.push(Paragraph);
    if (opts.table === true) extensions.push(Table);
    if (opts.codeBlock !== false) extensions.push(CodeBlock.configure(opts.codeBlock));
    if (opts.list !== false) extensions.push(List);
    // Backspace + Delete are not optional — the editor is unusable without them.
    extensions.push(BaseEditing);

    // ── Structure ────────────────────────────────────────────────────────────
    if (opts.document !== false) extensions.push(Document);
    if (opts.hardBreak !== false) extensions.push(HardBreak.configure(opts.hardBreak));
    if (opts.heading !== false) extensions.push(Heading.configure(opts.heading));
    if (opts.horizontalRule !== false) extensions.push(HorizontalRule);
    if (opts.pageBreak !== false) extensions.push(PageBreak);
    if (opts.image !== false) extensions.push(Image);

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
