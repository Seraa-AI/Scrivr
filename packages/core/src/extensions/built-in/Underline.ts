import { toggleMark } from "prosemirror-commands";
import { Extension } from "../Extension";
import type { MarkDecorator, SpanRect } from "../types";

export const Underline = Extension.create({
  name: "underline",

  addMarks() {
    return {
      underline: {
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
      decoratePost(ctx: CanvasRenderingContext2D, rect: SpanRect) {
        ctx.save();
        ctx.strokeStyle = "#1e293b";
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

  // No standard markdown syntax for underline — serialize as HTML <u> tag
  addMarkdownSerializerRules() {
    return {
      marks: {
        underline: { open: "<u>", close: "</u>", mixable: true },
      },
    };
  },
});
