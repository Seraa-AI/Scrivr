import { toggleMark } from "prosemirror-commands";
import { Extension } from "../Extension";
import type { ParsedFont } from "../../layout/StyleResolver";
import type { FontModifier } from "../types";

interface BoldOptions {
  /** Set to false to disable Mod-b shortcut. Default: true */
  shortcut: boolean;
}

/**
 * Bold — the `bold` mark.
 *
 * Font rendering is handled by StyleResolver (font weight → "bold 14px Georgia").
 * No MarkDecorator needed — bold is purely a font metric change, not a visual overlay.
 */
export const Bold = Extension.create<BoldOptions>({
  name: "bold",

  defaultOptions: {
    shortcut: true,
  },

  addMarks() {
    return {
      bold: {
        parseDOM: [
          { tag: "strong" },
          { tag: "b", getAttrs: (node) => (node as HTMLElement).style.fontWeight !== "normal" && null },
          { style: "font-weight=400", clearMark: (m) => m.type.name === "bold" },
          { style: "font-weight", getAttrs: (value) => /^(bold(er)?|[5-9]\d{2})$/.test(value as string) && null },
        ],
        toDOM: () => ["strong", 0],
      },
    };
  },

  addKeymap() {
    if (!this.options.shortcut) return {};
    return {
      "Mod-b": toggleMark(this.schema.marks["bold"]!),
    };
  },

  addCommands() {
    return {
      toggleBold: () => toggleMark(this.schema.marks["bold"]!),
    };
  },

  addFontModifiers() {
    return new Map<string, FontModifier>([
      ["bold", (parsed: ParsedFont) => { parsed.weight = "bold"; }],
    ]);
  },

  addToolbarItems() {
    return [{
      command: "toggleBold",
      label: "B",
      title: "Bold (⌘B)",
      isActive: (marks: string[]) => marks.includes("bold"),
    }];
  },

  addMarkdownParserTokens() {
    return { strong: { mark: "bold" } };
  },

  addMarkdownSerializerRules() {
    return {
      marks: {
        bold: { open: "**", close: "**", mixable: true, expelEnclosingWhitespace: true },
      },
    };
  },
});
