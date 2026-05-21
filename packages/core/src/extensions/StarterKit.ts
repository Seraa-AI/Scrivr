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
import { CodeBlock, insertCodeIndent } from "./built-in/CodeBlock";
import { HorizontalRule } from "./built-in/HorizontalRule";
import { PageBreak } from "./built-in/PageBreak";
import { Image } from "./built-in/Image";
import { Table } from "./built-in/Table";
import { Typography } from "./built-in/Typography";
import { defaultPageConfig } from "../layout/PageLayout";
import { TrailingNode } from "./built-in/TrailingNode";
import { ClearFormatting } from "./built-in/ClearFormatting";
import { chainCommands } from "prosemirror-commands";
import type { InputRule } from "prosemirror-inputrules";
import type { Command } from "prosemirror-state";
import type { NodeSpec, MarkSpec } from "prosemirror-model";
import type { FontModifier, MarkDecorator, ToolbarItemSpec, MarkdownBlockRule, MarkdownParserTokenSpec, MarkdownSerializerRules, IEditor } from "./types";
import type { ExportContributionMap, ImportContributionMap } from "./export";
import type { BlockStyle } from "../layout/FontConfig";
import type { BlockStrategy, InlineStrategy } from "../layout/BlockRegistry";
import type { PageConfig } from "../layout/PageLayout";

// ── Export contribution aggregation (used by addExports below) ──────────────

interface MinimalContribBundle {
  nodes?: Record<string, unknown>;
  marks?: Record<string, unknown>;
  onBeforeExport?: (ctx: unknown) => void | Promise<void>;
  onBuildTreeComplete?: (ctx: unknown) => void | Promise<void>;
  onFinalize?: (ctx: unknown) => unknown;
}

function isMinimalContribBundle(v: unknown): v is MinimalContribBundle {
  return typeof v === "object" && v !== null;
}

function chainHooks(
  a: (ctx: unknown) => void | Promise<void>,
  b: (ctx: unknown) => void | Promise<void>,
): (ctx: unknown) => Promise<void> {
  return async (ctx) => {
    await a(ctx);
    await b(ctx);
  };
}

function mergeContribBundles(
  existing: MinimalContribBundle | undefined,
  incoming: MinimalContribBundle,
): MinimalContribBundle {
  const out: MinimalContribBundle = { ...existing };
  if (incoming.nodes) out.nodes = { ...out.nodes, ...incoming.nodes };
  if (incoming.marks) out.marks = { ...out.marks, ...incoming.marks };
  if (incoming.onBeforeExport) {
    out.onBeforeExport = out.onBeforeExport
      ? chainHooks(out.onBeforeExport, incoming.onBeforeExport)
      : incoming.onBeforeExport;
  }
  if (incoming.onBuildTreeComplete) {
    out.onBuildTreeComplete = out.onBuildTreeComplete
      ? chainHooks(out.onBuildTreeComplete, incoming.onBuildTreeComplete)
      : incoming.onBuildTreeComplete;
  }
  // Last-writer-wins for onFinalize — overriding the whole packager is
  // unusual; silent composition would mask the override.
  if (incoming.onFinalize) out.onFinalize = incoming.onFinalize;
  return out;
}

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
}

/**
 * StarterKit — batteries-included default for new editors.
 *
 * @example
 * new Editor({ extensions: [StarterKit] })
 * new Editor({ extensions: [StarterKit.configure({ history: false })] })
 * new Editor({ extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } })] })
 * new Editor({ extensions: [StarterKit, Highlight, MyImageExtension] })
 */
export const StarterKit = Extension.create<StarterKitOptions>({
  name: "starterKit",

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

  addNodes() {
    const nodes: Record<string, NodeSpec> = {};
    const opts = this.options;

    if (opts.document !== false) {
      Object.assign(nodes, Document.resolve().nodes);
    }
    if (opts.hardBreak !== false) {
      const ext = typeof opts.hardBreak === "object" ? HardBreak.configure(opts.hardBreak) : HardBreak;
      Object.assign(nodes, ext.resolve().nodes);
    }
    if (opts.paragraph !== false) {
      Object.assign(nodes, Paragraph.resolve().nodes);
    }
    if (opts.heading !== false) {
      const ext = typeof opts.heading === "object"
        ? Heading.configure(opts.heading)
        : Heading;
      Object.assign(nodes, ext.resolve().nodes);
    }
    if (opts.list !== false) {
      Object.assign(nodes, List.resolve().nodes);
    }
    if (opts.codeBlock !== false) {
      Object.assign(nodes, CodeBlock.resolve().nodes);
    }
    if (opts.horizontalRule !== false) {
      Object.assign(nodes, HorizontalRule.resolve().nodes);
    }
    if (opts.pageBreak !== false) {
      Object.assign(nodes, PageBreak.resolve().nodes);
    }
    if (opts.image !== false) {
      Object.assign(nodes, Image.resolve().nodes);
    }
    if (opts.table === true) {
      Object.assign(nodes, Table.resolve().nodes);
    }

    return nodes;
  },

  addMarks() {
    const marks: Record<string, MarkSpec> = {};
    const opts = this.options;

    if (opts.bold !== false) {
      Object.assign(marks, Bold.resolve().marks);
    }
    if (opts.italic !== false) {
      Object.assign(marks, Italic.resolve().marks);
    }
    if (opts.underline !== false) {
      Object.assign(marks, Underline.resolve().marks);
    }
    if (opts.strikethrough !== false) {
      Object.assign(marks, Strikethrough.resolve().marks);
    }
    if (opts.highlight !== false) {
      const ext = typeof opts.highlight === "object" ? Highlight.configure(opts.highlight) : Highlight;
      Object.assign(marks, ext.resolve().marks);
    }
    if (opts.color !== false) {
      const ext = typeof opts.color === "object" ? Color.configure(opts.color) : Color;
      Object.assign(marks, ext.resolve().marks);
    }
    if (opts.fontSize !== false) {
      const ext = typeof opts.fontSize === "object" ? FontSize.configure(opts.fontSize) : FontSize;
      Object.assign(marks, ext.resolve().marks);
    }
    if (opts.fontFamily !== false) {
      const ext = typeof opts.fontFamily === "object" ? FontFamily.configure(opts.fontFamily) : FontFamily;
      Object.assign(marks, ext.resolve().marks);
    }
    if (opts.link !== false) {
      Object.assign(marks, Link.resolve().marks);
    }

    return marks;
  },

  addProseMirrorPlugins() {
    const opts = this.options;
    const plugins = [];

    if (opts.history !== false) {
      const ext = typeof opts.history === "object"
        ? History.configure(opts.history)
        : History;
      plugins.push(...ext.resolve(this.schema).plugins);
    }

    if (opts.trailingNode !== false) {
      plugins.push(...TrailingNode.resolve(this.schema).plugins);
    }

    if (opts.table === true) {
      plugins.push(...Table.resolve(this.schema).plugins);
    }

    return plugins;
  },

  addKeymap() {
    const km: Record<string, Command> = {};
    const opts = this.options;

    // BaseEditing is always included — Backspace + Delete are not optional
    Object.assign(km, BaseEditing.resolve(this.schema).keymap);

    if (opts.hardBreak !== false) {
      const ext = typeof opts.hardBreak === "object" ? HardBreak.configure(opts.hardBreak) : HardBreak;
      Object.assign(km, ext.resolve(this.schema).keymap);
    }
    if (opts.paragraph !== false) {
      Object.assign(km, Paragraph.resolve(this.schema).keymap);
    }
    if (opts.bold !== false) {
      const ext = typeof opts.bold === "object" ? Bold.configure(opts.bold) : Bold;
      Object.assign(km, ext.resolve(this.schema).keymap);
    }
    if (opts.italic !== false) {
      const ext = typeof opts.italic === "object" ? Italic.configure(opts.italic) : Italic;
      Object.assign(km, ext.resolve(this.schema).keymap);
    }
    if (opts.history !== false) {
      const ext = typeof opts.history === "object" ? History.configure(opts.history) : History;
      Object.assign(km, ext.resolve(this.schema).keymap);
    }
    if (opts.heading !== false) {
      const ext = typeof opts.heading === "object" ? Heading.configure(opts.heading) : Heading;
      Object.assign(km, ext.resolve(this.schema).keymap);
    }
    // Tab: chain codeBlock (spaces) → list (indent)
    {
      const tabCmds: Command[] = [];
      if (opts.codeBlock !== false) tabCmds.push(insertCodeIndent());
      if (opts.list !== false) {
        const listTab = List.resolve(this.schema).keymap["Tab"];
        if (listTab) tabCmds.push(listTab);
      }
      if (tabCmds.length > 0) km["Tab"] = chainCommands(...tabCmds);
    }

    // Merge remaining List keymaps except Tab (already handled above)
    if (opts.list !== false) {
      const { Tab: _tab, ...restListKm } = List.resolve(this.schema).keymap;
      Object.assign(km, restListKm);
    }

    if (opts.codeBlock !== false) {
      const { Tab: _tab, ...restCodeKm } = CodeBlock.resolve(this.schema).keymap;
      Object.assign(km, restCodeKm);
    }
    if (opts.alignment !== false) {
      Object.assign(km, Alignment.resolve(this.schema).keymap);
    }
    Object.assign(km, Indent.resolve(this.schema).keymap);
    if (opts.underline !== false) {
      Object.assign(km, Underline.resolve(this.schema).keymap);
    }
    if (opts.strikethrough !== false) {
      Object.assign(km, Strikethrough.resolve(this.schema).keymap);
    }
    if (opts.highlight !== false) {
      const ext = typeof opts.highlight === "object" ? Highlight.configure(opts.highlight) : Highlight;
      Object.assign(km, ext.resolve(this.schema).keymap);
    }
    if (opts.clearFormatting !== false) {
      Object.assign(km, ClearFormatting.resolve(this.schema).keymap);
    }
    if (opts.pageBreak !== false) {
      Object.assign(km, PageBreak.resolve(this.schema).keymap);
    }

    return km;
  },

  addCommands() {
    const cmds: Record<string, (...args: unknown[]) => Command> = {};
    const opts = this.options;

    if (opts.hardBreak !== false) {
      const ext = typeof opts.hardBreak === "object" ? HardBreak.configure(opts.hardBreak) : HardBreak;
      Object.assign(cmds, ext.resolve(this.schema).commands);
    }
    if (opts.bold !== false) {
      const ext = typeof opts.bold === "object" ? Bold.configure(opts.bold) : Bold;
      Object.assign(cmds, ext.resolve(this.schema).commands);
    }
    if (opts.italic !== false) {
      const ext = typeof opts.italic === "object" ? Italic.configure(opts.italic) : Italic;
      Object.assign(cmds, ext.resolve(this.schema).commands);
    }
    if (opts.history !== false) {
      const ext = typeof opts.history === "object" ? History.configure(opts.history) : History;
      Object.assign(cmds, ext.resolve(this.schema).commands);
    }
    if (opts.heading !== false) {
      const ext = typeof opts.heading === "object" ? Heading.configure(opts.heading) : Heading;
      Object.assign(cmds, ext.resolve(this.schema).commands);
    }
    if (opts.underline !== false) {
      Object.assign(cmds, Underline.resolve(this.schema).commands);
    }
    if (opts.strikethrough !== false) {
      Object.assign(cmds, Strikethrough.resolve(this.schema).commands);
    }
    if (opts.highlight !== false) {
      const ext = typeof opts.highlight === "object" ? Highlight.configure(opts.highlight) : Highlight;
      Object.assign(cmds, ext.resolve(this.schema).commands);
    }
    if (opts.color !== false) {
      const ext = typeof opts.color === "object" ? Color.configure(opts.color) : Color;
      Object.assign(cmds, ext.resolve(this.schema).commands);
    }
    if (opts.fontSize !== false) {
      const ext = typeof opts.fontSize === "object" ? FontSize.configure(opts.fontSize) : FontSize;
      Object.assign(cmds, ext.resolve(this.schema).commands);
    }
    if (opts.fontFamily !== false) {
      const ext = typeof opts.fontFamily === "object" ? FontFamily.configure(opts.fontFamily) : FontFamily;
      Object.assign(cmds, ext.resolve(this.schema).commands);
    }
    if (opts.link !== false) {
      Object.assign(cmds, Link.resolve(this.schema).commands);
    }
    if (opts.list !== false) {
      Object.assign(cmds, List.resolve(this.schema).commands);
    }
    if (opts.alignment !== false) {
      Object.assign(cmds, Alignment.resolve(this.schema).commands);
    }
    Object.assign(cmds, Indent.resolve(this.schema).commands);
    if (opts.codeBlock !== false) {
      Object.assign(cmds, CodeBlock.resolve(this.schema).commands);
    }
    if (opts.horizontalRule !== false) {
      Object.assign(cmds, HorizontalRule.resolve(this.schema).commands);
    }
    if (opts.pageBreak !== false) {
      Object.assign(cmds, PageBreak.resolve(this.schema).commands);
    }
    if (opts.image !== false) {
      Object.assign(cmds, Image.resolve(this.schema).commands);
    }
    if (opts.table === true) {
      Object.assign(cmds, Table.resolve(this.schema).commands);
    }
    if (opts.clearFormatting !== false) {
      Object.assign(cmds, ClearFormatting.resolve(this.schema).commands);
    }

    return cmds;
  },

  addInputHandlers() {
    // BaseEditing is always included — arrow keys are not optional
    return BaseEditing.resolve().inputHandlers;
  },

  addFontModifiers() {
    const map = new Map<string, FontModifier>();
    const opts = this.options;

    if (opts.bold !== false) {
      const ext = typeof opts.bold === "object" ? Bold.configure(opts.bold) : Bold;
      for (const [k, v] of ext.resolve().fontModifiers) map.set(k, v);
    }
    if (opts.italic !== false) {
      const ext = typeof opts.italic === "object" ? Italic.configure(opts.italic) : Italic;
      for (const [k, v] of ext.resolve().fontModifiers) map.set(k, v);
    }
    if (opts.fontSize !== false) {
      const ext = typeof opts.fontSize === "object" ? FontSize.configure(opts.fontSize) : FontSize;
      for (const [k, v] of ext.resolve().fontModifiers) map.set(k, v);
    }
    if (opts.fontFamily !== false) {
      const ext = typeof opts.fontFamily === "object" ? FontFamily.configure(opts.fontFamily) : FontFamily;
      for (const [k, v] of ext.resolve().fontModifiers) map.set(k, v);
    }

    return map;
  },

  addMarkDecorators() {
    const opts = this.options;
    const result: Record<string, MarkDecorator> = {};
    if (opts.underline !== false) {
      for (const [k, v] of Underline.resolve().markDecorators) result[k] = v;
    }
    if (opts.strikethrough !== false) {
      for (const [k, v] of Strikethrough.resolve().markDecorators) result[k] = v;
    }
    if (opts.highlight !== false) {
      const ext = typeof opts.highlight === "object" ? Highlight.configure(opts.highlight) : Highlight;
      for (const [k, v] of ext.resolve().markDecorators) result[k] = v;
    }
    if (opts.color !== false) {
      for (const [k, v] of Color.resolve().markDecorators) result[k] = v;
    }
    if (opts.link !== false) {
      for (const [k, v] of Link.resolve().markDecorators) result[k] = v;
    }
    return result;
  },

  addLayoutHandlers() {
    const handlers: Record<string, BlockStrategy> = {};
    const opts = this.options;
    if (opts.paragraph !== false) {
      Object.assign(handlers, Paragraph.resolve().layoutHandlers);
    }
    if (opts.heading !== false) {
      const ext = typeof opts.heading === "object" ? Heading.configure(opts.heading) : Heading;
      Object.assign(handlers, ext.resolve().layoutHandlers);
    }
    if (opts.list !== false) {
      Object.assign(handlers, List.resolve().layoutHandlers);
    }
    if (opts.codeBlock !== false) {
      Object.assign(handlers, CodeBlock.resolve().layoutHandlers);
    }
    if (opts.horizontalRule !== false) {
      Object.assign(handlers, HorizontalRule.resolve().layoutHandlers);
    }
    // Image is now an inline node — it registers an InlineStrategy, not a BlockStrategy.
    if (opts.table === true) {
      Object.assign(handlers, Table.resolve().layoutHandlers);
    }
    return handlers;
  },

  addBlockStyles() {
    const styles: Record<string, BlockStyle> = {};
    const opts = this.options;
    if (opts.paragraph !== false) {
      Object.assign(styles, Paragraph.resolve().blockStyles);
    }
    if (opts.heading !== false) {
      const ext = typeof opts.heading === "object" ? Heading.configure(opts.heading) : Heading;
      Object.assign(styles, ext.resolve().blockStyles);
    }
    if (opts.list !== false) {
      Object.assign(styles, List.resolve().blockStyles);
    }
    if (opts.codeBlock !== false) {
      Object.assign(styles, CodeBlock.resolve().blockStyles);
    }
    if (opts.horizontalRule !== false) {
      Object.assign(styles, HorizontalRule.resolve().blockStyles);
    }
    // Image is now an inline node — no block styles needed.
    return styles;
  },

  addInlineHandlers() {
    const handlers: Record<string, InlineStrategy> = {};
    const opts = this.options;
    if (opts.image !== false) {
      Object.assign(handlers, Image.resolve().inlineHandlers);
    }
    return handlers;
  },

  addToolbarItems() {
    const items: ToolbarItemSpec[] = [];
    const opts = this.options;

    if (opts.heading !== false) {
      const ext = typeof opts.heading === "object" ? Heading.configure(opts.heading) : Heading;
      items.push(...ext.resolve().toolbarItems);
    }
    if (opts.alignment !== false) {
      items.push(...Alignment.resolve().toolbarItems);
    }
    items.push(...Indent.resolve().toolbarItems);
    if (opts.bold !== false) {
      const ext = typeof opts.bold === "object" ? Bold.configure(opts.bold) : Bold;
      items.push(...ext.resolve().toolbarItems);
    }
    if (opts.italic !== false) {
      const ext = typeof opts.italic === "object" ? Italic.configure(opts.italic) : Italic;
      items.push(...ext.resolve().toolbarItems);
    }
    if (opts.underline !== false) {
      items.push(...Underline.resolve().toolbarItems);
    }
    if (opts.strikethrough !== false) {
      items.push(...Strikethrough.resolve().toolbarItems);
    }
    if (opts.highlight !== false) {
      const ext = typeof opts.highlight === "object" ? Highlight.configure(opts.highlight) : Highlight;
      items.push(...ext.resolve().toolbarItems);
    }
    if (opts.color !== false) {
      const ext = typeof opts.color === "object" ? Color.configure(opts.color) : Color;
      items.push(...ext.resolve().toolbarItems);
    }
    if (opts.fontSize !== false) {
      const ext = typeof opts.fontSize === "object" ? FontSize.configure(opts.fontSize) : FontSize;
      items.push(...ext.resolve().toolbarItems);
    }
    if (opts.fontFamily !== false) {
      const ext = typeof opts.fontFamily === "object" ? FontFamily.configure(opts.fontFamily) : FontFamily;
      items.push(...ext.resolve().toolbarItems);
    }
    if (opts.link !== false) {
      items.push(...Link.resolve().toolbarItems);
    }
    if (opts.list !== false) {
      items.push(...List.resolve().toolbarItems);
    }
    if (opts.codeBlock !== false) {
      items.push(...CodeBlock.resolve().toolbarItems);
    }
    if (opts.horizontalRule !== false) {
      items.push(...HorizontalRule.resolve().toolbarItems);
    }
    if (opts.pageBreak !== false) {
      items.push(...PageBreak.resolve().toolbarItems);
    }
    if (opts.image !== false) {
      items.push(...Image.resolve().toolbarItems);
    }
    if (opts.table === true) {
      items.push(...Table.resolve().toolbarItems);
    }
    if (opts.clearFormatting !== false) {
      items.push(...ClearFormatting.resolve().toolbarItems);
    }

    return items;
  },

  addMarkdownRules(): MarkdownBlockRule[] {
    const rules: MarkdownBlockRule[] = [];
    const opts = this.options;
    // Heading markdown rules are handled natively by PasteTransformer; skip here.
    if (opts.codeBlock !== false) {
      rules.push(...CodeBlock.resolve().markdownRules);
    }
    if (opts.horizontalRule !== false) {
      rules.push(...HorizontalRule.resolve().markdownRules);
    }
    return rules;
  },

  addInputRules(): InputRule[] {
    const rules: InputRule[] = [];
    const opts = this.options;
    if (opts.heading !== false) {
      const ext = typeof opts.heading === "object" ? Heading.configure(opts.heading) : Heading;
      rules.push(...ext.resolve(this.schema).inputRules);
    }
    if (opts.list !== false) {
      rules.push(...List.resolve(this.schema).inputRules);
    }
    if (opts.codeBlock !== false) {
      rules.push(...CodeBlock.resolve(this.schema).inputRules);
    }
    if (opts.horizontalRule !== false) {
      rules.push(...HorizontalRule.resolve(this.schema).inputRules);
    }
    if (opts.typography !== false) {
      rules.push(...Typography.resolve(this.schema).inputRules);
    }
    return rules;
  },

  addExports(): ExportContributionMap {
    // Forward sub-extensions' addExports() contributions. Format-aware merge:
    // `nodes` and `marks` Object.assign together; lifecycle hooks chain
    // (a then b). `onFinalize` is last-writer-wins — overriding the whole
    // packager is rare and shouldn't silently compose.
    //
    // Loose typing because each format's bundle shape lives in its own
    // package (DocxHandlers in @scrivr/docx, PdfHandlers in
    // @scrivr/export-pdf). The runtime-checked `MinimalContribBundle` is
    // a structural subset that covers all known format shapes today.
    const result: Record<string, MinimalContribBundle> = {};

    const mergeFrom = (contrib: ExportContributionMap) => {
      const asRecord = contrib as Record<string, unknown>;
      for (const key of Object.keys(asRecord)) {
        const incoming = asRecord[key];
        if (!isMinimalContribBundle(incoming)) continue;
        result[key] = mergeContribBundles(result[key], incoming);
      }
    };

    const opts = this.options;

    // Nodes
    if (opts.paragraph !== false) mergeFrom(Paragraph.resolve().exports);
    if (opts.hardBreak !== false) {
      const ext = typeof opts.hardBreak === "object" ? HardBreak.configure(opts.hardBreak) : HardBreak;
      mergeFrom(ext.resolve().exports);
    }
    if (opts.heading !== false) {
      const ext = typeof opts.heading === "object" ? Heading.configure(opts.heading) : Heading;
      mergeFrom(ext.resolve().exports);
    }
    if (opts.codeBlock !== false) {
      const ext = typeof opts.codeBlock === "object" ? CodeBlock.configure(opts.codeBlock) : CodeBlock;
      mergeFrom(ext.resolve().exports);
    }
    if (opts.horizontalRule !== false) mergeFrom(HorizontalRule.resolve().exports);
    if (opts.pageBreak !== false) mergeFrom(PageBreak.resolve().exports);
    if (opts.list !== false) mergeFrom(List.resolve().exports);
    if (opts.image !== false) mergeFrom(Image.resolve().exports);

    // Marks
    if (opts.bold !== false) {
      const ext = typeof opts.bold === "object" ? Bold.configure(opts.bold) : Bold;
      mergeFrom(ext.resolve().exports);
    }
    if (opts.italic !== false) {
      const ext = typeof opts.italic === "object" ? Italic.configure(opts.italic) : Italic;
      mergeFrom(ext.resolve().exports);
    }
    if (opts.underline !== false) mergeFrom(Underline.resolve().exports);
    if (opts.strikethrough !== false) mergeFrom(Strikethrough.resolve().exports);
    if (opts.highlight !== false) {
      const ext = typeof opts.highlight === "object" ? Highlight.configure(opts.highlight) : Highlight;
      mergeFrom(ext.resolve().exports);
    }
    if (opts.color !== false) {
      const ext = typeof opts.color === "object" ? Color.configure(opts.color) : Color;
      mergeFrom(ext.resolve().exports);
    }
    if (opts.fontSize !== false) {
      const ext = typeof opts.fontSize === "object" ? FontSize.configure(opts.fontSize) : FontSize;
      mergeFrom(ext.resolve().exports);
    }
    if (opts.fontFamily !== false) {
      const ext = typeof opts.fontFamily === "object" ? FontFamily.configure(opts.fontFamily) : FontFamily;
      mergeFrom(ext.resolve().exports);
    }

    return result as ExportContributionMap;
  },

  addImports(): ImportContributionMap {
    // Mirror of addExports — forward each sub-extension's addImports().
    // Same loose-typing approach so different format bundles (DocxImports,
    // future MarkdownImports …) can coexist without StarterKit knowing
    // about their specific shapes.
    const result: Record<string, MinimalContribBundle> = {};

    const mergeFrom = (contrib: ImportContributionMap) => {
      const asRecord = contrib as Record<string, unknown>;
      for (const key of Object.keys(asRecord)) {
        const incoming = asRecord[key];
        if (!isMinimalContribBundle(incoming)) continue;
        result[key] = mergeContribBundles(result[key], incoming);
      }
    };

    const opts = this.options;

    // Nodes
    if (opts.paragraph !== false) mergeFrom(Paragraph.resolve().imports);
    if (opts.hardBreak !== false) {
      const ext = typeof opts.hardBreak === "object" ? HardBreak.configure(opts.hardBreak) : HardBreak;
      mergeFrom(ext.resolve().imports);
    }
    if (opts.heading !== false) {
      const ext = typeof opts.heading === "object" ? Heading.configure(opts.heading) : Heading;
      mergeFrom(ext.resolve().imports);
    }
    if (opts.codeBlock !== false) {
      const ext = typeof opts.codeBlock === "object" ? CodeBlock.configure(opts.codeBlock) : CodeBlock;
      mergeFrom(ext.resolve().imports);
    }
    if (opts.horizontalRule !== false) mergeFrom(HorizontalRule.resolve().imports);
    if (opts.pageBreak !== false) mergeFrom(PageBreak.resolve().imports);
    if (opts.list !== false) mergeFrom(List.resolve().imports);
    if (opts.image !== false) mergeFrom(Image.resolve().imports);

    // Marks
    if (opts.bold !== false) {
      const ext = typeof opts.bold === "object" ? Bold.configure(opts.bold) : Bold;
      mergeFrom(ext.resolve().imports);
    }
    if (opts.italic !== false) {
      const ext = typeof opts.italic === "object" ? Italic.configure(opts.italic) : Italic;
      mergeFrom(ext.resolve().imports);
    }
    if (opts.underline !== false) mergeFrom(Underline.resolve().imports);
    if (opts.strikethrough !== false) mergeFrom(Strikethrough.resolve().imports);
    if (opts.highlight !== false) {
      const ext = typeof opts.highlight === "object" ? Highlight.configure(opts.highlight) : Highlight;
      mergeFrom(ext.resolve().imports);
    }
    if (opts.color !== false) {
      const ext = typeof opts.color === "object" ? Color.configure(opts.color) : Color;
      mergeFrom(ext.resolve().imports);
    }
    if (opts.fontSize !== false) {
      const ext = typeof opts.fontSize === "object" ? FontSize.configure(opts.fontSize) : FontSize;
      mergeFrom(ext.resolve().imports);
    }
    if (opts.fontFamily !== false) {
      const ext = typeof opts.fontFamily === "object" ? FontFamily.configure(opts.fontFamily) : FontFamily;
      mergeFrom(ext.resolve().imports);
    }

    return result as ImportContributionMap;
  },

  addMarkdownParserTokens(): Record<string, MarkdownParserTokenSpec> {
    const tokens: Record<string, MarkdownParserTokenSpec> = {};
    const opts = this.options;
    if (opts.hardBreak !== false) {
      const ext = typeof opts.hardBreak === "object" ? HardBreak.configure(opts.hardBreak) : HardBreak;
      Object.assign(tokens, ext.resolve().markdownParserTokens);
    }
    if (opts.paragraph !== false) Object.assign(tokens, Paragraph.resolve().markdownParserTokens);
    if (opts.heading !== false) {
      const ext = typeof opts.heading === "object" ? Heading.configure(opts.heading) : Heading;
      Object.assign(tokens, ext.resolve().markdownParserTokens);
    }
    if (opts.bold !== false) {
      const ext = typeof opts.bold === "object" ? Bold.configure(opts.bold) : Bold;
      Object.assign(tokens, ext.resolve().markdownParserTokens);
    }
    if (opts.italic !== false) {
      const ext = typeof opts.italic === "object" ? Italic.configure(opts.italic) : Italic;
      Object.assign(tokens, ext.resolve().markdownParserTokens);
    }
    if (opts.list !== false) Object.assign(tokens, List.resolve().markdownParserTokens);
    if (opts.codeBlock !== false) Object.assign(tokens, CodeBlock.resolve().markdownParserTokens);
    if (opts.horizontalRule !== false) Object.assign(tokens, HorizontalRule.resolve().markdownParserTokens);
    return tokens;
  },

  onViewReady(editor: IEditor) {
    // Aggregate view-only lifecycle from sub-extensions. Image is the
    // only one today (its `redraw` request when an `<img>` finishes
    // loading is paint-only).
    const cleanups: Array<() => void> = [];
    const opts = this.options;

    if (opts.image !== false) {
      const resolved = Image.resolve();
      const cleanup = resolved.viewReadyCallback?.(editor);
      if (cleanup) cleanups.push(cleanup);
    }

    return cleanups.length > 0 ? () => cleanups.forEach((c) => c()) : undefined;
  },

  addMarkdownSerializerRules(): MarkdownSerializerRules {
    const nodes: Required<MarkdownSerializerRules>["nodes"] = {};
    const marks: Required<MarkdownSerializerRules>["marks"] = {};
    const opts = this.options;

    const merge = (rules: MarkdownSerializerRules) => {
      Object.assign(nodes, rules.nodes ?? {});
      Object.assign(marks, rules.marks ?? {});
    };

    if (opts.document !== false) merge(Document.resolve().markdownSerializerRules);
    if (opts.hardBreak !== false) {
      const ext = typeof opts.hardBreak === "object" ? HardBreak.configure(opts.hardBreak) : HardBreak;
      merge(ext.resolve().markdownSerializerRules);
    }
    if (opts.paragraph !== false) merge(Paragraph.resolve().markdownSerializerRules);
    if (opts.heading !== false) {
      const ext = typeof opts.heading === "object" ? Heading.configure(opts.heading) : Heading;
      merge(ext.resolve().markdownSerializerRules);
    }
    if (opts.bold !== false) {
      const ext = typeof opts.bold === "object" ? Bold.configure(opts.bold) : Bold;
      merge(ext.resolve().markdownSerializerRules);
    }
    if (opts.italic !== false) {
      const ext = typeof opts.italic === "object" ? Italic.configure(opts.italic) : Italic;
      merge(ext.resolve().markdownSerializerRules);
    }
    if (opts.underline !== false) merge(Underline.resolve().markdownSerializerRules);
    if (opts.strikethrough !== false) merge(Strikethrough.resolve().markdownSerializerRules);
    if (opts.link !== false) merge(Link.resolve().markdownSerializerRules);
    if (opts.list !== false) merge(List.resolve().markdownSerializerRules);
    if (opts.codeBlock !== false) merge(CodeBlock.resolve().markdownSerializerRules);
    if (opts.horizontalRule !== false) merge(HorizontalRule.resolve().markdownSerializerRules);
    if (opts.image !== false) merge(Image.resolve().markdownSerializerRules);
    if (opts.table === true) merge(Table.resolve().markdownSerializerRules);

    return { nodes, marks };
  },
});
