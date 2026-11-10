/**
 * A table as a composite: each row is a unit, each cell a region. The table
 * says where its cells sit — its `grid` scaled to the width it is laid out in,
 * a cell spanning `gridSpan` columns, inset by the cell padding — and the
 * engine lays out what each cell holds, as it does any region.
 */
import type { Node } from "prosemirror-model";
import type { CompositeLayout, CompositeUnit, RegionInset, RegionPlacement } from "../layout/BlockRegistry";
import type { LaidRegion, LayoutBlock } from "../layout/BlockLayout";
import { cellBackground, cellGridSpan, cellVMerge, type CellVMerge } from "./attrs";

/** Space a cell keeps clear inside its edges, in CSS px. */
export const CELL_INSET: RegionInset = { top: 4, right: 6, bottom: 4, left: 6 };
/** Width of a grid column the `grid` attr doesn't cover. */
const DEFAULT_COLUMN_WIDTH = 100;

/** What a row carries for its cells: the table's column grid. */
interface RowData {
  columns: number[];
}

/** What a cell carries for the row painter and exporters. */
export interface CellData {
  vMerge: CellVMerge;
  background: string | null;
}

function isRowData(value: unknown): value is RowData {
  return typeof value === "object" && value !== null && "columns" in value && Array.isArray(value.columns);
}

/** A laid-out cell's merge and background; a region that is no cell has neither. */
export function cellDataOf(region: LaidRegion): CellData {
  const data = region.data;
  if (typeof data === "object" && data !== null && "vMerge" in data && "background" in data) {
    const { vMerge, background } = data;
    return {
      vMerge: vMerge === "restart" || vMerge === "continue" ? vMerge : "none",
      background: typeof background === "string" ? background : null,
    };
  }
  return { vMerge: "none", background: null };
}

/** A table's laid-out row: a unit of the table composite. */
export function isTableRowBlock(block: LayoutBlock): boolean {
  return block.kind === "composite" && block.node.type.name === "tableRow";
}

/** The table's column widths, from its `grid` attr; empty when it has none. */
function gridOf(table: Node): number[] {
  const grid = table.attrs["grid"];
  return Array.isArray(grid) ? grid.filter((w): w is number => typeof w === "number" && Number.isFinite(w)) : [];
}

/** Sum of `gridSpan` across a row's cells — its column count. */
function rowColumnCount(row: Node): number {
  let n = 0;
  row.forEach((cell) => { n += cellGridSpan(cell); });
  return n;
}

export const tableLayout: CompositeLayout = {
  units(table, pos) {
    const columns = gridOf(table);
    const units: CompositeUnit[] = [];
    table.forEach((row, offset) => {
      units.push({ node: row, pos: pos + 1 + offset, data: { columns } satisfies RowData });
    });
    return units;
  },

  regions(unit, width) {
    const row = unit.node;
    const declared = isRowData(unit.data) ? unit.data.columns : [];
    // A table with no grid gets one even column per cell, so a row is never zero-width.
    const columns = declared.length > 0
      ? declared
      : Array.from({ length: Math.max(rowColumnCount(row), 1) }, () => DEFAULT_COLUMN_WIDTH);
    const widthAt = (c: number) => columns[c] ?? DEFAULT_COLUMN_WIDTH;

    // Scale the grid to fill the width (Word and Docs fit a table to the
    // page, never letting a wide grid overflow the margin), keeping its
    // proportions.
    let total = 0;
    for (let c = 0; c < columns.length; c++) total += widthAt(c);
    const scale = width > 0 && total > 0 ? width / total : 1;
    const columnWidth = (c: number) => widthAt(c) * scale;

    const regions: RegionPlacement[] = [];
    let col = 0;
    let x = 0;
    row.forEach((cell, offset) => {
      const span = cellGridSpan(cell);
      let cellWidth = 0;
      for (let c = col; c < col + span; c++) cellWidth += columnWidth(c);
      regions.push({
        node: cell,
        pos: unit.pos + 1 + offset,
        x,
        width: cellWidth,
        inset: CELL_INSET,
        data: { vMerge: cellVMerge(cell), background: cellBackground(cell) } satisfies CellData,
      });
      x += cellWidth;
      col += span;
    });
    return regions;
  },
};
