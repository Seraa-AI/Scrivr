import { toggleMark } from "prosemirror-commands";
import { Extension } from "../Extension";
import type { MarkDecorator, SpanRect } from "../types";

interface HighlightOptions {
  /** Default highlight color. Default: "rgba(255, 220, 0, 0.4)" */
  color: string;
  /** Allow multiple highlight colors via attrs. Default: false */
  multicolor: boolean;
}

/**
 * Highlight — yellow background behind text.
 *
 * This extension demonstrates the full mark extension pattern:
 *   - addMarks()           → ProseMirror schema contribution
 *   - addMarkDecorators()  → canvas rendering (pre-paint background)
 *
 * Bold/italic don't need a MarkDecorator because they only affect the
 * font string. Highlight needs one because it draws a colored rectangle
 * BEHIND the text — something StyleResolver cannot express.
 */
export const Highlight = Extension.create<HighlightOptions>({
  name: "highlight",

  defaultOptions: {
    color: "rgba(255, 220, 0, 0.4)",
    multicolor: false,
  },

  addMarks() {
    const attrs = this.options.multicolor
      ? { color: { default: this.options.color }, dataTracked: { default: [] } }
      : { dataTracked: { default: [] } };

    return {
      highlight: {
        attrs,
        parseDOM: [
          {
            tag: "mark",
            getAttrs: (node) =>
              this.options.multicolor
                ? { color: (node as HTMLElement).style.backgroundColor || this.options.color }
                : {},
          },
        ],
        toDOM: (mark) => {
          const style = this.options.multicolor
            ? `background-color:${mark.attrs.color}`
            : `background-color:${this.options.color}`;
          return ["mark", { style }, 0];
        },
      },
    };
  },

  addKeymap() {
    return {
      "Mod-Shift-h": toggleMark(this.schema.marks["highlight"]!),
    };
  },

  addCommands() {
    return {
      toggleHighlight:
        (color?: unknown) =>
        toggleMark(
          this.schema.marks["highlight"]!,
          this.options.multicolor && color ? { color } : undefined
        ),
    };
  },

  addMarkDecorators() {
    const defaultColor = this.options.color;
    const multicolor = this.options.multicolor;

    const decorator: MarkDecorator = {
      /**
       * decoratePre — drawn BEFORE the text.
       * Fills the glyph bounding box with the highlight color.
       *
       * Using pre (not post) so the text sits on top of the highlight.
       * If we used post, the highlight would cover the text.
       */
      decoratePre(ctx: CanvasRenderingContext2D, rect: SpanRect) {
        const color = multicolor
          ? (rect.markAttrs.color as string | undefined) ?? defaultColor
          : defaultColor;

        ctx.save();
        ctx.fillStyle = color;
        ctx.fillRect(
          rect.x,
          rect.y - rect.ascent,
          rect.width,
          rect.ascent + rect.descent
        );
        ctx.restore();
      },
    };

    return {
      highlight: decorator,
    };
  },

  addToolbarItems() {
    return [{
      command: "toggleHighlight",
      label: "H",
      title: "Highlight (⌘⇧H)",
      group: "highlight",
      isActive: (marks: string[]) => marks.includes("highlight"),
    }];
  },
});
