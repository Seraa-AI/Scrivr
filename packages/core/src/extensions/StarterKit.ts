import { Extension } from "./Extension";
import { Document } from "./built-in/Document";
import { Paragraph } from "./built-in/Paragraph";
import { Heading } from "./built-in/Heading";
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
import { CodeBlock, insertCodeIndent } from "./built-in/CodeBlock";
import { HorizontalRule } from "./built-in/HorizontalRule";
import { Image } from "./built-in/Image";
import { Typography } from "./built-in/Typography";
import { Pagination } from "./built-in/Pagination";
import { TrailingNode } from "./built-in/TrailingNode";
import { chainCommands } from "prosemirror-commands";
import type { InputRule } from "prosemirror-inputrules";
import type { Command } from "prosemirror-state";
import type { NodeSpec, MarkSpec } from "prosemirror-model";
import type { FontModifier, MarkDecorator, ToolbarItemSpec, MarkdownBlockRule, MarkdownParserTokenSpec, MarkdownSerializerRules, IEditor } from "./types";
import type { BlockStyle } from "../layout/FontConfig";
import type { BlockStrategy } from "../layout/BlockRegistry";
import type { PageConfig } from "../layout/PageLayout";

interface StarterKitOptions {
  /** Page dimensions and margins. Pass false to exclude the Pagination extension entirely. Defaults to A4 with 1-inch margins. */
  pagination?: false | Partial<PageConfig>;
  /** Pass false to exclude this extension entirely */
  document?: false;
  paragraph?: false;
  heading?: false | { levels?: number[] };
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
  image?: false;
  typography?: false;
  trailingNode?: false;
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

  addNodes() {
    const nodes: Record<string, NodeSpec> = {};
    const opts = this.options;

    if (opts.document !== false) {
      Object.assign(nodes, Document.resolve().nodes);
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
    if (opts.image !== false) {
      Object.assign(nodes, Image.resolve().nodes);
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

    return plugins;
  },

  addKeymap() {
    const km: Record<string, Command> = {};
    const opts = this.options;

    // BaseEditing is always included — Backspace + Delete are not optional
    Object.assign(km, BaseEditing.resolve(this.schema).keymap);

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

    return km;
  },

  addCommands() {
    const cmds: Record<string, (...args: unknown[]) => Command> = {};
    const opts = this.options;

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
    if (opts.codeBlock !== false) {
      Object.assign(cmds, CodeBlock.resolve(this.schema).commands);
    }
    if (opts.horizontalRule !== false) {
      Object.assign(cmds, HorizontalRule.resolve(this.schema).commands);
    }
    if (opts.image !== false) {
      Object.assign(cmds, Image.resolve(this.schema).commands);
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
    if (opts.image !== false) {
      Object.assign(handlers, Image.resolve().layoutHandlers);
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
    if (opts.image !== false) {
      Object.assign(styles, Image.resolve().blockStyles);
    }
    return styles;
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
    if (opts.image !== false) {
      items.push(...Image.resolve().toolbarItems);
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

  addMarkdownParserTokens(): Record<string, MarkdownParserTokenSpec> {
    const tokens: Record<string, MarkdownParserTokenSpec> = {};
    const opts = this.options;
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

  onEditorReady(editor: IEditor) {
    const cleanups: Array<() => void> = [];
    const opts = this.options;

    // Aggregate onEditorReady from sub-extensions that need runtime setup.
    if (opts.image !== false) {
      const resolved = Image.resolve();
      const cleanup = resolved.editorReadyCallback?.(editor);
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

    return { nodes, marks };
  },
});
