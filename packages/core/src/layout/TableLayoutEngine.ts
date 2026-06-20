/**
 * TableLayoutEngine — canvas-native layout for `table` rows.
 *
 * Each `tableRow` becomes one `kind: "tableRow"` LayoutBlock whose `cells`
 * carry per-cell rectangles and the laid-out child blocks of each cell. The
 * engine:
 *   1. Derives column x-offsets from the table's `grid` widths.
 *   2. Lays out every cell's child blocks (paragraphs, headings, …) inside the
 *      cell's content box (column width minus padding) by reusing `layoutBlock`.
 *   3. Sizes the row to its tallest cell; every cell fills that height.
 *
 * Position model (matches the line model so the measure cache can reuse a row
 * at any page y): cell `x` is absolute (horizontal position never changes with
 * pagination), but cell `y` and the child blocks' `y` are RELATIVE to the row
 * block's top. The renderer and CharacterMap add the row block's final `y` at
 * paint time.
 *
 * vMerge note (v1): vertically merged cells are laid out per row — a "restart"
 * cell's content lives in its own row; "continue" cells are empty placeholders.
 * Cross-row content flow is not modelled yet; the merge is a render-time border
 * concern handled by `TableRowStrategy`.
 */
import type { Node } from "prosemirror-model";
import { layoutBlock, type LayoutBlock, type CellSubBlock } from "./BlockLayout";
import type { TextMeasurerLike } from "./TextMeasurer";
import type { FontConfig } from "./FontConfig";
import type { FontModifier } from "../extensions/types";
import type { InlineRegistry } from "./BlockRegistry";

/** Horizontal cell padding (left + right) in CSS px. */
export const CELL_PADDING_H = 6;
/** Vertical cell padding (top + bottom) in CSS px. */
export const CELL_PADDING_V = 4;
/** Fallback width for a grid column the `grid` attr doesn't cover. */
const DEFAULT_COLUMN_WIDTH = 100;

export interface TableRowLayoutContext {
  /** Absolute x of the row's left edge (page left margin / indent). */
  x: number;
  /** Column widths in CSS px, from the table's `grid` attr. */
  columns: number[];
  /** Content width the row must fit within — columns scale to fill it. */
  availableWidth: number;
  /** Page this row sits on. */
  page: number;
  /** Absolute document position of the row node. */
  rowNodePos: number;
  measurer: TextMeasurerLike;
  fontConfig?: FontConfig;
  fontModifiers?: Map<string, FontModifier>;
  inlineRegistry?: InlineRegistry;
}

function readGridSpan(cell: Node): number {
  const v = cell.attrs["gridSpan"];
  if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 1) return v;
  return 1;
}

function columnWidth(columns: number[], index: number): number {
  return columns[index] ?? DEFAULT_COLUMN_WIDTH;
}

/**
 * Lay out one table row's cells. Returns the cell sub-blocks (with `y` relative
 * to the row top) and the row's content-driven height.
 */
export function layoutTableRowCells(
  rowNode: Node,
  ctx: TableRowLayoutContext,
): { cells: CellSubBlock[]; height: number } {
  // Scale the grid to fill the available content width (Word/Docs fit a table
  // to the page, never letting a wide grid overflow the margin). Proportions
  // from `grid` are preserved.
  const colCount = Math.max(ctx.columns.length, 1);
  let rawTotal = 0;
  for (let c = 0; c < colCount; c++) rawTotal += columnWidth(ctx.columns, c);
  const scale = ctx.availableWidth > 0 && rawTotal > 0 ? ctx.availableWidth / rawTotal : 1;
  const widthOf = (c: number): number => columnWidth(ctx.columns, c) * scale;

  // Cumulative x offset of each grid column from the row's left edge.
  const columnX: number[] = [];
  let acc = 0;
  for (let c = 0; c < colCount; c++) {
    columnX.push(acc);
    acc += widthOf(c);
  }

  const cells: CellSubBlock[] = [];
  let col = 0;

  rowNode.forEach((cellNode, offsetInRow) => {
    const span = readGridSpan(cellNode);
    const cellX = ctx.x + (columnX[col] ?? col * DEFAULT_COLUMN_WIDTH);

    let cellWidth = 0;
    for (let c = col; c < col + span; c++) cellWidth += widthOf(c);

    const contentX = cellX + CELL_PADDING_H;
    const contentWidth = Math.max(0, cellWidth - 2 * CELL_PADDING_H);
    const cellPos = ctx.rowNodePos + 1 + offsetInRow;

    // Lay out the cell's child blocks, stacking `y` relative to the row top.
    const blocks: LayoutBlock[] = [];
    let relY = CELL_PADDING_V;
    cellNode.forEach((childNode, childOffsetInCell) => {
      const childNodePos = cellPos + 1 + childOffsetInCell;
      const childBlock = layoutBlock(childNode, {
        nodePos: childNodePos,
        x: contentX,
        y: relY,
        availableWidth: contentWidth,
        page: ctx.page,
        measurer: ctx.measurer,
        // No `map`: the CharacterMap is populated at paint time (TableRowStrategy),
        // matching the convention for cached, position-independent layouts.
        ...(ctx.fontConfig ? { fontConfig: ctx.fontConfig } : {}),
        ...(ctx.fontModifiers ? { fontModifiers: ctx.fontModifiers } : {}),
        ...(ctx.inlineRegistry ? { inlineRegistry: ctx.inlineRegistry } : {}),
      });
      blocks.push(childBlock);
      relY += childBlock.spaceBefore + childBlock.height + childBlock.spaceAfter;
    });

    const contentHeight = relY - CELL_PADDING_V;
    const cellHeight = contentHeight + 2 * CELL_PADDING_V;

    cells.push({
      cellPos,
      x: cellX,
      y: 0, // cell top aligns with the row top
      width: cellWidth,
      height: cellHeight,
      blocks,
    });

    col += span;
  });

  const rowHeight = cells.reduce((max, c) => Math.max(max, c.height), 0);
  // Every cell fills the row height (top-aligned content in v1).
  for (const cell of cells) cell.height = rowHeight;

  return { cells, height: rowHeight };
}
