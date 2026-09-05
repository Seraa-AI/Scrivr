import type { Node } from "prosemirror-model";
import type { CellHAlign, CellVAlign, CellVMerge } from "./domAttrs";
import { VALID_HALIGNS, VALID_VALIGNS } from "./domAttrs";

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
  if (value === "restart" || value === "continue") return value;
  return "none";
}

export function cellHAlign(cell: Node): CellHAlign {
  const value = cell.attrs["hAlign"];
  return typeof value === "string" ? asHAlign(value) : "left";
}

export function cellVAlign(cell: Node): CellVAlign {
  const value = cell.attrs["vAlign"];
  return typeof value === "string" ? asVAlign(value) : "top";
}

/** The cell's fill, or null when it has none. */
export function cellBackground(cell: Node): string | null {
  const value = cell.attrs["background"];
  return typeof value === "string" && value.trim() !== "" ? value : null;
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

// Matching against the valid list is what narrows a bare string to the union —
// kept here so each reader above stays a single line.
function asHAlign(value: string): CellHAlign {
  for (const candidate of VALID_HALIGNS) if (candidate === value) return candidate;
  return "left";
}

function asVAlign(value: string): CellVAlign {
  for (const candidate of VALID_VALIGNS) if (candidate === value) return candidate;
  return "top";
}
