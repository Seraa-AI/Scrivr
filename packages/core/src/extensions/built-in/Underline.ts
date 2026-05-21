import { toggleMark } from "prosemirror-commands";
import { Extension } from "../Extension";
import type { MarkDecorator, SpanRect } from "../types";
import type { DocxMarkHandler, DocxMarkTransform } from "../../exports/docx";

export const Underline = Extension.create({
  name: "underline",

  addMarks() {
    return {
      underline: {
        attrs: { dataTracked: { default: [] } },
        parseDOM: [
          { tag: "u" },
          { style: "text-decoration=underline" },
        ],
        toDOM: () => ["u", 0],
      },
    };
  },

  addKeymap() {
    return {
      "Mod-u": toggleMark(this.schema.marks["underline"]!),
    };
  },

  addCommands() {
    return {
      toggleUnderline: () => toggleMark(this.schema.marks["underline"]!),
    };
  },

  addMarkDecorators() {
    const decorator: MarkDecorator = {
      // Underline follows the theme's default text color, not the per-span
      // color mark — preserves Word/Docs convention where colored text gets
      // the same underline color as plain text. Theme switching (e.g. dark
      // mode) updates underline color via theme.defaultText.
      decoratePost(ctx, rect, theme, _effectiveTextColor) {
        ctx.save();
        ctx.strokeStyle = theme.defaultText;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const underlineY = rect.y + Math.ceil(rect.descent * 0.6);
        ctx.moveTo(rect.x, underlineY);
        ctx.lineTo(rect.x + rect.width, underlineY);
        ctx.stroke();
        ctx.restore();
      },
    };
    return { underline: decorator };
  },

  addToolbarItems() {
    return [{
      command: "toggleUnderline",
      label: "U",
      title: "Underline (⌘U)",
      group: "format",
      isActive: (marks: string[]) => marks.includes("underline"),
    }];
  },

  addExports() {
    const handler: DocxMarkHandler = (props) => ({ ...props, underline: true });
    return { docx: { marks: { underline: handler } } };
  },

  addImports() {
    // `<w:u w:val="none"/>` explicitly turns underline off. Anything else
    // (single / double / dotted / wavyDouble / …) collapses to the single
    // Scrivr `underline` mark — style variants aren't modeled.
    const handler: DocxMarkTransform = (mark, ctx) => {
      if (mark.attrs?.["val"] === "none") return null;
      const t = ctx.schema.marks["underline"];
      return t ? t.create() : null;
    };
    return { docx: { marks: { u: handler } } };
  },

  // No standard markdown syntax for underline — serialize as HTML <u> tag
  addMarkdownSerializerRules() {
    return {
      marks: {
        underline: { open: "<u>", close: "</u>", mixable: true },
      },
    };
  },
});

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    underline: {
      /** Toggle the underline mark on the selection. */
      toggleUnderline: () => ReturnType;
    };
  }
}
