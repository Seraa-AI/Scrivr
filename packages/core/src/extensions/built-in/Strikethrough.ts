import { toggleMark } from "prosemirror-commands";
import { Extension } from "../Extension";
import type { MarkDecorator, SpanRect } from "../types";
import type { DocxMarkHandler, DocxMarkTransform } from "../../exports/docx";

export const Strikethrough = Extension.create({
  name: "strikethrough",

  addMarks() {
    return {
      strikethrough: {
        attrs: { dataTracked: { default: [] } },
        parseDOM: [
          { tag: "s" },
          { tag: "del" },
          { style: "text-decoration=line-through" },
        ],
        toDOM: () => ["s", 0],
      },
    };
  },

  addKeymap() {
    return {
      "Mod-Shift-s": toggleMark(this.schema.marks["strikethrough"]!),
    };
  },

  addCommands() {
    return {
      toggleStrikethrough: () => toggleMark(this.schema.marks["strikethrough"]!),
    };
  },

  addMarkDecorators() {
    const decorator: MarkDecorator = {
      // Follows theme.defaultText, not the per-span color mark — Word/Docs
      // convention: colored text gets the same strike color as plain text.
      decoratePost(ctx, rect, theme, _effectiveTextColor) {
        ctx.save();
        ctx.strokeStyle = theme.defaultText;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const strikeY = rect.y - rect.ascent * 0.35;
        ctx.moveTo(rect.x, strikeY);
        ctx.lineTo(rect.x + rect.width, strikeY);
        ctx.stroke();
        ctx.restore();
      },
    };
    return { strikethrough: decorator };
  },

  addToolbarItems() {
    return [{
      command: "toggleStrikethrough",
      label: "S\u0336",
      title: "Strikethrough (⌘⇧S)",
      group: "format",
      isActive: (marks: string[]) => marks.includes("strikethrough"),
    }];
  },

  addExports() {
    const handler: DocxMarkHandler = (props) => ({ ...props, strike: true });
    return { docx: { marks: { strikethrough: handler } } };
  },

  addImports() {
    const handler: DocxMarkTransform = (mark, ctx) => {
      if (mark.attrs?.["val"] === "false" || mark.attrs?.["val"] === "0") {
        return null;
      }
      const t = ctx.schema.marks["strikethrough"];
      return t ? t.create() : null;
    };
    return { docx: { marks: { strike: handler } } };
  },

  // GFM strikethrough (~~text~~) — parser token requires markdown-it-strikethrough plugin,
  // so we only add the serializer rule for now. HTML paste handles <s>/<del> via parseDOM.
  addMarkdownSerializerRules() {
    return {
      marks: {
        strikethrough: { open: "~~", close: "~~", mixable: true },
      },
    };
  },
});

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    strikethrough: {
      /** Toggle the strikethrough mark on the selection. */
      toggleStrikethrough: () => ReturnType;
    };
  }
}
