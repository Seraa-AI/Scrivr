import { Extension } from "../Extension";
import type { FontModifier, ToolbarItemSpec } from "../types";
import type { ParsedFont } from "../../layout/StyleResolver";

interface FontFamilyOptions {
  /** Font family presets shown in the toolbar. */
  families: string[];
}

const DEFAULT_FAMILIES = [
  "Georgia",
  "Times New Roman",
  "Arial",
  "Verdana",
  "Courier New",
  "Trebuchet MS",
];

/**
 * FontFamily — inline font family via the `font_family` mark.
 *
 * The family name is stored as-is and passed to ctx.font by the FontModifier.
 * StyleResolver already has a built-in fallback for `font_family`, but
 * registering a proper modifier here keeps things explicit.
 *
 * Commands:
 *   setFontFamily(family: string)  — applies the font_family mark to the selection
 *   unsetFontFamily()              — removes the font_family mark from the selection
 */
export const FontFamily = Extension.create<FontFamilyOptions>({
  name: "fontFamily",

  defaultOptions: {
    families: DEFAULT_FAMILIES,
  },

  addMarks() {
    return {
      font_family: {
        attrs: { family: {} },
        excludes: "font_family",
        parseDOM: [
          {
            style: "font-family",
            getAttrs: (value) => ({ family: (value as string).replace(/['"]/g, "").trim() }),
          },
        ],
        toDOM: (mark) => [
          "span",
          { style: `font-family:${mark.attrs["family"] as string}` },
          0,
        ],
      },
    };
  },

  addCommands() {
    return {
      setFontFamily:
        (family: unknown) =>
        (state, dispatch) => {
          const markType = this.schema.marks["font_family"];
          if (!markType) return false;
          if (dispatch) {
            const { from, to } = state.selection;
            dispatch(state.tr.addMark(from, to, markType.create({ family })));
          }
          return true;
        },
      unsetFontFamily:
        () =>
        (state, dispatch) => {
          const markType = this.schema.marks["font_family"];
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
        "font_family",
        (parsed: ParsedFont, attrs: Record<string, unknown>) => {
          const family = attrs["family"];
          if (typeof family === "string") {
            parsed.family = family;
          }
        },
      ],
    ]);
  },

  addToolbarItems() {
    const items: ToolbarItemSpec[] = this.options.families.map((family) => ({
      command: "setFontFamily",
      args: [family],
      label: family,
      title: `Font: ${family}`,
      labelStyle: { fontFamily: family },
      group: "family",
      isActive: (_activeMarks, _blockType, _blockAttrs, activeMarkAttrs) =>
        activeMarkAttrs?.["font_family"]?.["family"] === family,
    }));
    return items;
  },
});
