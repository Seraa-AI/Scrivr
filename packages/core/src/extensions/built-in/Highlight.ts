import { toggleMark } from "prosemirror-commands";
import { Extension } from "../Extension";
import type { MarkDecorator, SpanRect } from "../types";
import type { DocxMarkHandler } from "../../exports/docx";

// ── OOXML highlight name lookup + CSS → hex (used by addExports) ───────────

const OOXML_HIGHLIGHT_NAMES = [
  "black", "blue", "cyan", "darkBlue", "darkCyan", "darkGray", "darkGreen",
  "darkMagenta", "darkRed", "darkYellow", "green", "lightGray", "magenta",
  "none", "red", "white", "yellow",
] as const;

const HIGHLIGHT_BY_LOWER: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const n of OOXML_HIGHLIGHT_NAMES) out[n.toLowerCase()] = n;
  return out;
})();

function canonicalHighlightName(value: string): string | null {
  return HIGHLIGHT_BY_LOWER[value.trim().toLowerCase()] ?? null;
}

function cssColorToHex(value: string): string | null {
  const v = value.trim();
  const six = /^#([0-9a-f]{6})$/i.exec(v);
  if (six && six[1]) return six[1].toUpperCase();
  const three = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (three) {
    return (
      three[1]! + three[1]! + three[2]! + three[2]! + three[3]! + three[3]!
    ).toUpperCase();
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (rgb && rgb[1]) {
    const parts = rgb[1].split(",").map((s) => s.trim());
    if (parts.length < 3) return null;
    const channels = parts.slice(0, 3).map((s) => Number(s));
    if (channels.some((n) => !Number.isFinite(n))) return null;
    return channels
      .map((n) =>
        Math.max(0, Math.min(255, Math.round(n)))
          .toString(16)
          .padStart(2, "0")
          .toUpperCase(),
      )
      .join("");
  }
  return null;
}

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
      decoratePre(ctx, rect, _theme, _effectiveTextColor) {
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

  addExports() {
    // OOXML's `<w:highlight>` only accepts a fixed set of named values per
    // the spec. Anything else (hex, rgb(), rgba()) has to use
    // `<w:shd w:val="clear" w:fill="HEX">` instead — Word's run-shading
    // accepts arbitrary fills and renders identically. The mark handler
    // decides which DocxRunProps field to populate; the walker emits both
    // as plain data with no parsing.
    const fallback = this.options.color;
    const handler: DocxMarkHandler = (props, mark) => {
      const raw = mark.attrs["color"];
      const value = typeof raw === "string" && raw.length > 0 ? raw : fallback;
      const named = canonicalHighlightName(value);
      if (named) return { ...props, highlight: named };
      const hex = cssColorToHex(value);
      if (hex) return { ...props, shadingFill: hex };
      // Unparseable — fall back to the canonical yellow so something paints.
      return { ...props, highlight: "yellow" };
    };
    return { docx: { marks: { highlight: handler } } };
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

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    highlight: {
      /** Toggle a highlight mark on the selection. */
      toggleHighlight: (color?: string) => ReturnType;
    };
  }

  interface MarkAttributes {
    highlight: {
      /** Highlight color — only used in multicolor mode */
      color?: string;
    };
  }
}
