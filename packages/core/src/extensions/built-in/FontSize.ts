import { Extension } from "../Extension";
import type { FontModifier, ToolbarItemSpec } from "../types";
import type { ParsedFont } from "../../layout/StyleResolver";
import type { DocxMarkHandler, DocxMarkTransform } from "../../exports/docx";

interface FontSizeOptions {
  /** Font size presets shown as toolbar buttons (px values). */
  sizes: number[];
}

/**
 * FontSize — inline font size via the `fontSize` mark.
 *
 * Size is stored in px (matching ctx.font convention).
 * The font metric change is handled by a FontModifier — no MarkDecorator needed.
 *
 * Commands:
 *   setFontSize(size: number)  — applies the fontSize mark to the selection
 *   unsetFontSize()            — removes the fontSize mark from the selection
 */
export const FontSize = Extension.create<FontSizeOptions>({
  name: "fontSize",

  defaultOptions: {
    sizes: [10, 12, 14, 16, 18, 24, 32],
  },

  addMarks() {
    return {
      fontSize: {
        attrs: { size: {}, dataTracked: { default: [] } },
        excludes: "fontSize",
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
          const markType = this.schema.marks["fontSize"];
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
          const markType = this.schema.marks["fontSize"];
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
        "fontSize",
        (parsed: ParsedFont, attrs: Record<string, unknown>) => {
          const size = attrs["size"];
          if (typeof size === "number") {
            parsed.size = `${size}px`;
          }
        },
      ],
    ]);
  },

  addExports() {
    const handler: DocxMarkHandler = (props, mark) => {
      const v = mark.attrs["size"];
      return typeof v === "number" ? { ...props, fontSize: v } : props;
    };
    return { docx: { marks: { fontSize: handler } } };
  },

  addImports() {
    // OOXML `<w:sz w:val="HALFPOINTS"/>`. Inverse of the exporter:
    // half-points ÷ 1.5 = px (exporter does px × 1.5).
    const handler: DocxMarkTransform = (mark, ctx) => {
      const raw = mark.attrs?.["val"];
      if (typeof raw !== "string" || raw.length === 0) return null;
      const halfPoints = Number(raw);
      if (!Number.isFinite(halfPoints) || halfPoints <= 0) return null;
      const t = ctx.schema.marks["fontSize"];
      if (!t) return null;
      return t.create({ size: Math.round(halfPoints / 1.5) });
    };
    return { docx: { marks: { sz: handler } } };
  },

  addToolbarItems() {
    const items: ToolbarItemSpec[] = this.options.sizes.map((size) => ({
      command: "setFontSize",
      args: [size],
      label: String(size),
      title: `Font size ${size}px`,
      group: "size",
      isActive: (_activeMarks, _blockType, _blockAttrs, activeMarkAttrs) =>
        activeMarkAttrs?.["fontSize"]?.["size"] === size,
    }));
    return items;
  },
});

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    fontSize: {
      /** Set the font size (in px) for the selection. */
      setFontSize: (size: number) => ReturnType;
      /** Remove the font size mark from the selection. */
      unsetFontSize: () => ReturnType;
    };
  }

  interface MarkAttributes {
    fontSize: {
      /** Font size in px */
      size: number;
    };
  }
}
