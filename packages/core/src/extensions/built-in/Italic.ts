import { toggleMark } from "prosemirror-commands";
import { Extension } from "../Extension";
import type { ParsedFont } from "../../layout/StyleResolver";
import type { FontModifier } from "../types";
import type { DocxMarkHandler, DocxMarkTransform } from "../../exports/docx";

interface ItalicOptions {
  shortcut: boolean;
}

const isNormalStyle = (style: string) => /^normal$/i.test(style);

export const Italic = Extension.create<ItalicOptions>({
  name: "italic",

  defaultOptions: {
    shortcut: true,
  },

  addMarks() {
    return {
      italic: {
        attrs: { dataTracked: { default: [] } },
        parseDOM: [
          // A tag set to normal style is declined, not a `skip: true` rule: a skipped
          // element's own style is never read, so it would lose its colour too.
          { tag: "em", getAttrs: (node) => !isNormalStyle(node.style.fontStyle) && null },
          { tag: "i", getAttrs: (node) => !isNormalStyle(node.style.fontStyle) && null },
          { style: "font-style=italic" },
          {
            style: "font-style",
            getAttrs: (value) => isNormalStyle(value) && null,
            clearMark: (m) => m.type.name === "italic",
          },
        ],
        toDOM: () => ["em", 0],
      },
    };
  },

  addKeymap() {
    if (!this.options.shortcut) return {};
    return {
      "Mod-i": toggleMark(this.schema.marks["italic"]!),
    };
  },

  addCommands() {
    return {
      toggleItalic: () => toggleMark(this.schema.marks["italic"]!),
    };
  },

  addFontModifiers() {
    return new Map<string, FontModifier>([
      ["italic", (parsed: ParsedFont) => { parsed.style = "italic"; }],
    ]);
  },

  addToolbarItems() {
    return [{
      command: "toggleItalic",
      label: "I",
      title: "Italic (⌘I)",
      group: "format",
      isActive: ({ activeMarks }) => activeMarks.includes("italic"),
    }];
  },

  addExports() {
    const handler: DocxMarkHandler = (props) => ({ ...props, italic: true });
    return { docx: { marks: { italic: handler } } };
  },

  addImports() {
    const handler: DocxMarkTransform = (mark, ctx) => {
      if (mark.attrs?.["val"] === "false" || mark.attrs?.["val"] === "0") {
        return null;
      }
      const t = ctx.schema.marks["italic"];
      return t ? t.create() : null;
    };
    return { docx: { marks: { i: handler } } };
  },

  addMarkdownParserTokens() {
    return { em: { mark: "italic" } };
  },

  addMarkdownSerializerRules() {
    return {
      marks: {
        italic: { open: "*", close: "*", mixable: true, expelEnclosingWhitespace: true },
      },
    };
  },
});

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    italic: {
      /** Toggle the italic mark on the selection. */
      toggleItalic: () => ReturnType;
    };
  }
}
