import { toggleMark } from "prosemirror-commands";
import { Extension } from "../Extension";
import type { ParsedFont } from "../../layout/StyleResolver";
import type { FontModifier } from "../types";
import type { DocxMarkHandler, DocxMarkTransform } from "../../exports/docx";

interface BoldOptions {
  /** Set to false to disable Mod-b shortcut. Default: true */
  shortcut: boolean;
}

/** Under 500: drawn regular. */
const isRegularWeight = (weight: string) => /^(normal|lighter|[1-9]\d?|[1-4]\d{2})$/i.test(weight);
/** 500 up: drawn bold. */
const isBoldWeight = (weight: string) => /^(bold(er)?|[5-9]\d{2}|1000)$/i.test(weight);

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
        attrs: { dataTracked: { default: [] } },
        parseDOM: [
          { tag: "strong", getAttrs: (node) => !isRegularWeight(node.style.fontWeight) && null },
          { tag: "b", getAttrs: (node) => !isRegularWeight(node.style.fontWeight) && null },
          {
            style: "font-weight",
            getAttrs: (value) => isRegularWeight(value) && null,
            clearMark: (m) => m.type.name === "bold",
          },
          { style: "font-weight", getAttrs: (value) => isBoldWeight(value) && null },
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
      group: "format",
      isActive: ({ activeMarks }) => activeMarks.includes("bold"),
    }];
  },

  addExports() {
    const handler: DocxMarkHandler = (props) => ({ ...props, bold: true });
    return { docx: { marks: { bold: handler } } };
  },

  addImports() {
    // OOXML `<w:b/>` (optionally `w:val="false"` to disable). Same
    // single-source-of-truth pattern as addExports — Bold owns its
    // mapping in both directions.
    const handler: DocxMarkTransform = (mark, ctx) => {
      if (mark.attrs?.["val"] === "false" || mark.attrs?.["val"] === "0") {
        return null;
      }
      const t = ctx.schema.marks["bold"];
      return t ? t.create() : null;
    };
    return { docx: { marks: { b: handler } } };
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

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    bold: {
      /** Toggle the bold mark on the selection. */
      toggleBold: () => ReturnType;
    };
  }
}
