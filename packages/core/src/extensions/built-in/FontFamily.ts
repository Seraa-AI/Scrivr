import type { Command } from "prosemirror-state";
import { Extension } from "../Extension";
import type { FontModifier, ToolbarItemSpec } from "../types";
import type { ParsedFont } from "../../layout/StyleResolver";

interface FontFamilyOptions {
  /** Font family presets shown in the toolbar. */
  families: string[];
}

const DEFAULT_FAMILIES = [
  "Arial",
  "Georgia",
  "Times New Roman",
  "Verdana",
  "Trebuchet MS",
  "Courier New",
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
            getAttrs: (value) => {
              // Take only the primary (first) family name — strips the
              // fallback stack (e.g. "Arial,sans-serif" → "Arial") so the
              // value matches toolbar presets and blockAttrs comparisons.
              const primary = (value as string)
                .replace(/['"]/g, "")
                .split(",")[0]
                ?.trim() ?? "";
              return primary ? { family: primary } : false;
            },
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
    const setBlockFamily = (family: string | null): Command => (state, dispatch) => {
      const { $from, $to } = state.selection;
      let tr = state.tr;
      let changed = false;
      const fontFamilyMark = state.schema.marks["font_family"];

      state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
        if (!node.isTextblock) return;
        if (!("fontFamily" in node.attrs)) return;
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, fontFamily: family });
        // Remove inline font_family marks from this block's entire content.
        // Pasted content (e.g. from Google Docs) carries font_family marks on
        // every span — without this, those inline marks override the block attr
        // and the toolbar font-family change appears to have no effect.
        if (fontFamilyMark) {
          tr = tr.removeMark(pos + 1, pos + node.nodeSize - 1, fontFamilyMark);
        }
        changed = true;
      });

      if (!changed) return false;
      if (dispatch) dispatch(tr);
      return true;
    };

    return {
      // Inline (character-level) — applies font_family mark to selected text
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

      // Block-level — sets fontFamily attr on every text block in the selection
      setBlockFontFamily: (family: unknown) => setBlockFamily(family as string),
      unsetBlockFontFamily: () => setBlockFamily(null),
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
      command: "setBlockFontFamily",
      args: [family],
      label: family,
      title: `Font: ${family}`,
      labelStyle: { fontFamily: family },
      group: "family",
      // Active when the block attr is set, OR when every character in the
      // selection carries the font_family mark for this family.
      isActive: (_activeMarks, _blockType, blockAttrs, activeMarkAttrs) =>
        blockAttrs["fontFamily"] === family ||
        activeMarkAttrs?.["font_family"]?.["family"] === family,
    }));
    return items;
  },
});
