import type { Node } from "prosemirror-model";
import { parseCssColor } from "../model/cssColor";

/**
 * The values each cell attr may hold. They live here, with the node layer that
 * owns the attrs, and the DOM layer reads them when translating markup.
 */
export const VALID_HALIGNS = ["left", "center", "right", "justify"] as const;
export const VALID_VALIGNS = ["top", "center", "bottom"] as const;
export const VALID_VMERGE = ["none", "restart", "continue"] as const;

export type CellHAlign = (typeof VALID_HALIGNS)[number];
export type CellVAlign = (typeof VALID_VALIGNS)[number];
export type CellVMerge = (typeof VALID_VMERGE)[number];

/**
 * Node-attr readers for table nodes — the counterpart to `domAttrs`, which
 * reads the same values off HTML.
 *
 * Attrs are `unknown` at the type level and arbitrary at runtime: collab peers,
 * paste, DOCX import, and older documents all write them. Every reader answers
 * with a usable value rather than reporting a problem, so callers can lay out
 * and paint a table without branching on malformed input. `normalize` is what
 * writes the canonical values back into the document.
 */

/** The cell's horizontal span in grid columns — at least 1. */
export function cellGridSpan(cell: Node): number {
  const value = cell.attrs["gridSpan"];
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }
  return 1;
}

/** The cell's vertical-merge role. */
export function cellVMerge(cell: Node): CellVMerge {
  const value = cell.attrs["vMerge"];
  return typeof value === "string" && isVMerge(value) ? value : "none";
}

/** The cell's horizontal alignment; "left" when unset or unrecognised. */
export function cellHAlign(cell: Node): CellHAlign {
  const value = cell.attrs["hAlign"];
  return typeof value === "string" && isHAlign(value) ? value : "left";
}

/** The cell's vertical alignment; "top" when unset or unrecognised. */
export function cellVAlign(cell: Node): CellVAlign {
  const value = cell.attrs["vAlign"];
  return typeof value === "string" && isVAlign(value) ? value : "top";
}

/**
 * The cell's fill, or null when it has none.
 *
 * A fill reaches the model from paste, DOCX import, collab, and `setContent`,
 * and only one of those is gated on the way in. It is gated here instead, at
 * the point every lane reads it: canvas assigns it straight to `fillStyle`,
 * where an unpaintable value is a silent no-op that leaves the previous cell's
 * colour on the brush, and the exporters need to resolve it anyway.
 */
export function cellBackground(cell: Node): string | null {
  const value = cell.attrs["background"];
  if (typeof value !== "string") return null;
  const colour = parseCssColor(value);
  return colour === null || colour.alpha === 0 ? null : value;
}

/** The same gate, for a fill still on its way in from markup. */
export function storableFill(value: string): string | null {
  const colour = parseCssColor(value);
  return colour === null || colour.alpha === 0 ? null : value;
}

/** The table's column widths in CSS px, or an empty grid when unset. */
export function tableGrid(table: Node): number[] {
  const value = table.attrs["grid"];
  if (!Array.isArray(value)) return [];
  const grid: number[] = [];
  for (const width of value) {
    if (typeof width === "number" && Number.isFinite(width)) grid.push(width);
  }
  return grid;
}

// One narrowing per union, shared with the DOM layer so a value added to a
// list above is recognised everywhere at once.
export function isHAlign(value: string): value is CellHAlign {
  const candidates: readonly string[] = VALID_HALIGNS;
  return candidates.includes(value);
}

export function isVAlign(value: string): value is CellVAlign {
  const candidates: readonly string[] = VALID_VALIGNS;
  return candidates.includes(value);
}

export function isVMerge(value: string): value is CellVMerge {
  const candidates: readonly string[] = VALID_VMERGE;
  return candidates.includes(value);
}
