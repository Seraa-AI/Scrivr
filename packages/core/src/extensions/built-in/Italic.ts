import { toggleMark } from "prosemirror-commands";
import { Extension } from "../Extension";
import type { ParsedFont } from "../../layout/StyleResolver";
import type { FontModifier } from "../types";

interface ItalicOptions {
  shortcut: boolean;
}

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
          { tag: "em" },
          { tag: "i", getAttrs: (node) => (node as HTMLElement).style.fontStyle !== "normal" && null },
          { style: "font-style=italic" },
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
      isActive: (marks: string[]) => marks.includes("italic"),
    }];
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
