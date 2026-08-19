import type { Command } from "prosemirror-state";
import { Extension } from "../Extension";
import type { ToolbarItemSpec } from "../types";
import {
  normalizeParagraphBorders,
  normalizeShading,
  mergeBorderSide,
  hasAnyBorders,
  outsideBorders,
  DEFAULT_PARAGRAPH_BORDER,
} from "../../model/paragraphBorders";
import type {
  ParagraphBorders as Borders,
  ParagraphBorderEdge,
  ParagraphBorderSide,
  ParagraphShading,
} from "../../model/paragraphBorders";

/**
 * ParagraphBorders — per-paragraph borders (OOXML `w:pBdr`) and shading
 * (`w:shd`), applied across every text block in the selection. A cross-cutting
 * extension (like Alignment / Indent) over the `borders`/`shading` attrs that
 * live on the paragraph and heading node specs.
 *
 * Phase 1: standalone per-side borders + shading. Grouping (`between`),
 * dashed/dotted/double styles, and the `bar` border land in later phases —
 * their values are already preserved on the model and through DOCX.
 */

/**
 * Apply `patch(attrs)` to every text block in the selection that carries a
 * `borders` attr (paragraph, heading). A `null` patch skips that block.
 */
function applyToBlocks(
  patch: (attrs: Record<string, unknown>) => Record<string, unknown> | null,
): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    let tr = state.tr;
    let changed = false;

    state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (!node.isTextblock) return;
      if (!("borders" in node.attrs)) return;
      const next = patch(node.attrs);
      if (next === null) return;
      tr = tr.setNodeMarkup(pos, undefined, next, node.marks);
      changed = true;
    });

    if (!changed) return false;
    if (dispatch) dispatch(tr);
    return true;
  };
}

function setParagraphBorders(borders: Borders | null): Command {
  const normalized = normalizeParagraphBorders(borders);
  return applyToBlocks((attrs) => ({ ...attrs, borders: normalized }));
}

/** Set or clear a single edge, merging against each block's own borders. */
function setParagraphBorderSide(
  edge: ParagraphBorderEdge,
  side: ParagraphBorderSide | undefined,
): Command {
  const normalized = side ? normalizeParagraphBorders({ [edge]: side }) : null;
  const resolvedSide = normalized?.[edge];
  return applyToBlocks((attrs) => {
    const current = normalizeParagraphBorders(attrs["borders"]);
    return { ...attrs, borders: mergeBorderSide(current, edge, resolvedSide) };
  });
}

function setParagraphShading(shading: ParagraphShading | null): Command {
  const normalized = normalizeShading(shading);
  return applyToBlocks((attrs) => ({ ...attrs, shading: normalized }));
}

/** Read the block's current borders for toolbar active-state checks. */
function activeBorders(blockAttrs: Record<string, unknown>): Borders | null {
  return normalizeParagraphBorders(blockAttrs["borders"]);
}

export const ParagraphBorders = Extension.create({
  name: "paragraphBorders",

  addCommands() {
    return {
      setParagraphBorders: (borders: Borders | null) =>
        setParagraphBorders(borders),
      setParagraphBorderSide: (
        edge: ParagraphBorderEdge,
        side: ParagraphBorderSide | undefined,
      ) => setParagraphBorderSide(edge, side),
      clearParagraphBorders: () => setParagraphBorders(null),
      setParagraphShading: (shading: ParagraphShading | null) =>
        setParagraphShading(shading),
    };
  },

  addToolbarItems(): ToolbarItemSpec[] {
    return [
      {
        command: "setParagraphBorders",
        args: [outsideBorders()],
        label: "▢",
        title: "All borders",
        group: "borders",
        isActive: (_m, _t, ba) => {
          const b = activeBorders(ba);
          return !!b && !!b.top && !!b.right && !!b.bottom && !!b.left;
        },
      },
      {
        command: "setParagraphBorderSide",
        args: ["bottom", DEFAULT_PARAGRAPH_BORDER],
        label: "▁",
        title: "Bottom border",
        group: "borders",
        isActive: (_m, _t, ba) => !!activeBorders(ba)?.bottom,
      },
      {
        command: "clearParagraphBorders",
        label: "▭",
        title: "No border",
        group: "borders",
        isActive: (_m, _t, ba) => {
          const b = activeBorders(ba);
          return !b || !hasAnyBorders(b);
        },
      },
    ];
  },
});

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    paragraphBorders: {
      /** Replace the border set on every selected paragraph (null clears). */
      setParagraphBorders: (borders: Borders | null) => ReturnType;
      /** Set or clear a single edge, preserving the other sides. */
      setParagraphBorderSide: (
        edge: ParagraphBorderEdge,
        side: ParagraphBorderSide | undefined,
      ) => ReturnType;
      /** Remove all borders from every selected paragraph. */
      clearParagraphBorders: () => ReturnType;
      /** Set or clear paragraph shading fill (null clears). */
      setParagraphShading: (shading: ParagraphShading | null) => ReturnType;
    };
  }
}
