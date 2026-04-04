import { Extension } from "../Extension";
import type { FontModifier, ToolbarItemSpec } from "../types";
import type { ParsedFont } from "../../layout/StyleResolver";

interface FontSizeOptions {
  /** Font size presets shown as toolbar buttons (px values). */
  sizes: number[];
}

/**
 * FontSize — inline font size via the `font_size` mark.
 *
 * Size is stored in px (matching ctx.font convention).
 * The font metric change is handled by a FontModifier — no MarkDecorator needed.
 *
 * Commands:
 *   setFontSize(size: number)  — applies the font_size mark to the selection
 *   unsetFontSize()            — removes the font_size mark from the selection
 */
export const FontSize = Extension.create<FontSizeOptions>({
  name: "fontSize",

  defaultOptions: {
    sizes: [10, 12, 14, 16, 18, 24, 32],
  },

  addMarks() {
    return {
      font_size: {
        attrs: { size: {}, dataTracked: { default: [] } },
        excludes: "font_size",
        parseDOM: [
          {
            style: "font-size",
            getAttrs: (value) => {
              const raw = value as string;
              let px: number;
              if (raw.endsWith("pt")) {
                // 1pt = 96/72 px (≈ 1.333px) at standard 96 DPI
                px = Math.round(parseFloat(raw) * (96 / 72));
              } else {
                // px, or bare number — take as-is
                px = parseFloat(raw);
              }
              return isNaN(px) ? false : { size: px };
            },
          },
        ],
        toDOM: (mark) => [
          "span",
          { style: `font-size:${mark.attrs["size"] as number}px` },
          0,
        ],
      },
    };
  },

  addCommands() {
    return {
      setFontSize:
        (size: unknown) =>
        (state, dispatch) => {
          const markType = this.schema.marks["font_size"];
          if (!markType) return false;
          if (dispatch) {
            const { from, to } = state.selection;
            dispatch(state.tr.addMark(from, to, markType.create({ size })));
          }
          return true;
        },
      unsetFontSize:
        () =>
        (state, dispatch) => {
          const markType = this.schema.marks["font_size"];
          if (!markType) return false;
          if (dispatch) {
            const { from, to } = state.selection;
            dispatch(state.tr.removeMark(from, to, markType));
          }
          return true;
        },
    };
  },

  addFontModifiers() {
    return new Map<string, FontModifier>([
      [
        "font_size",
        (parsed: ParsedFont, attrs: Record<string, unknown>) => {
          const size = attrs["size"];
          if (typeof size === "number") {
            parsed.size = `${size}px`;
          }
        },
      ],
    ]);
  },

  addToolbarItems() {
    const items: ToolbarItemSpec[] = this.options.sizes.map((size) => ({
      command: "setFontSize",
      args: [size],
      label: String(size),
      title: `Font size ${size}px`,
      group: "size",
      isActive: (_activeMarks, _blockType, _blockAttrs, activeMarkAttrs) =>
        activeMarkAttrs?.["font_size"]?.["size"] === size,
    }));
    return items;
  },
});
