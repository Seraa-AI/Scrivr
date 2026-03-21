import { toggleMark } from "prosemirror-commands";
import { Extension } from "../Extension";
import type { MarkDecorator, SpanRect } from "../types";

export const Strikethrough = Extension.create({
  name: "strikethrough",

  addMarks() {
    return {
      strikethrough: {
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
      decoratePost(ctx: CanvasRenderingContext2D, rect: SpanRect) {
        ctx.save();
        ctx.strokeStyle = "#1e293b";
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
