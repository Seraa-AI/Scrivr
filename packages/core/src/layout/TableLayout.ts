import type { Node } from "prosemirror-model";
import { layoutBlock, type LayoutBlock, type TableCellLayout, type TableData } from "./BlockLayout";
import type { TextMeasurer } from "./TextMeasurer";
import type { FontConfig } from "./FontConfig";
import type { FontModifier } from "../extensions/types";

const CELL_PADDING = 8;
const BORDER = 1;
const TABLE_SPACE_BEFORE = 12;
const TABLE_SPACE_AFTER = 12;

export interface TableLayoutOptions {
  nodePos: number;
  x: number;
  y: number;
  availableWidth: number;
  page: number;
  measurer: TextMeasurer;
  fontConfig?: FontConfig;
  fontModifiers?: Map<string, FontModifier>;
}

/**
 * layoutTable — computes the full 2-D layout for a ProseMirror table node.
 *
 * Produces a single LayoutBlock with blockType "table" whose height covers
 * all rows. The per-cell LayoutBlocks are attached via LayoutBlock.tableData
 * so TableBlockStrategy can render them and register glyph positions.
 *
 * Column widths are split equally. Row height is the maximum cell height in
 * each row (same as how browsers handle table layout by default).
 */
export function layoutTable(node: Node, options: TableLayoutOptions): LayoutBlock {
  const { nodePos, x, y, availableWidth, page, measurer, fontConfig, fontModifiers } = options;

  const numRows = node.childCount;
  const numCols = numRows > 0 ? node.child(0).childCount : 0;

  if (numRows === 0 || numCols === 0) {
    return emptyTableBlock(node, nodePos, x, y, availableWidth);
  }

  // Equal column widths — (numCols + 1) borders, each colWidth has left border already
  const colWidth = (availableWidth - BORDER * (numCols + 1)) / numCols;
  const colWidths = Array<number>(numCols).fill(colWidth);

  const cells: TableCellLayout[] = [];
  const rowHeights: number[] = [];

  let rowY = y + BORDER; // top border

  node.forEach((rowNode, rowOffset, rowIndex) => {
    const rowNodePos = nodePos + 1 + rowOffset;
    const rowCells: TableCellLayout[] = [];
    let maxRowHeight = 0;

    rowNode.forEach((cellNode, cellOffset, colIndex) => {
      const cellNodePos = rowNodePos + 1 + cellOffset;
      const cellX = x + BORDER + colIndex * (colWidth + BORDER);
      const cellContentWidth = colWidth - CELL_PADDING * 2;

      // Layout every block inside this cell
      const contentBlocks: LayoutBlock[] = [];
      let contentY = rowY + CELL_PADDING;

      cellNode.forEach((contentNode, contentOffset) => {
        const contentNodePos = cellNodePos + 1 + contentOffset;
        const block = layoutBlock(contentNode, {
          nodePos: contentNodePos,
          x: cellX + CELL_PADDING,
          y: contentY,
          availableWidth: cellContentWidth,
          page,
          measurer,
          ...(fontConfig ? { fontConfig } : {}),
          ...(fontModifiers ? { fontModifiers } : {}),
        });
        contentBlocks.push(block);
        contentY += block.height;
      });

      const cellContentHeight = contentY - (rowY + CELL_PADDING);
      const cellHeight = cellContentHeight + CELL_PADDING * 2;
      maxRowHeight = Math.max(maxRowHeight, cellHeight);

      rowCells.push({
        nodePos: cellNodePos,
        x: cellX,
        y: rowY,
        width: colWidth,
        height: cellHeight, // normalised below
        contentBlocks,
        rowIndex,
        colIndex,
      });
    });

    // Normalise all cells in this row to the tallest cell
    for (const cell of rowCells) cell.height = maxRowHeight;
    cells.push(...rowCells);
    rowHeights.push(maxRowHeight);
    rowY += maxRowHeight + BORDER; // row bottom border
  });

  // rowY is now past the bottom border of the last row
  const tableHeight = rowY - y;

  const tableData: TableData = { cells, numRows, numCols, colWidths, rowHeights };

  return {
    node,
    x,
    y,
    width: availableWidth,
    height: tableHeight,
    lines: [],
    spaceBefore: TABLE_SPACE_BEFORE,
    spaceAfter: TABLE_SPACE_AFTER,
    blockType: "table",
    align: "left",
    availableWidth,
    tableData,
  };
}

function emptyTableBlock(
  node: Node,
  _nodePos: number,
  x: number,
  y: number,
  availableWidth: number,
): LayoutBlock {
  return {
    node,
    x,
    y,
    width: availableWidth,
    height: 2 * BORDER,
    lines: [],
    spaceBefore: TABLE_SPACE_BEFORE,
    spaceAfter: TABLE_SPACE_AFTER,
    blockType: "table",
    align: "left",
    availableWidth,
    tableData: { cells: [], numRows: 0, numCols: 0, colWidths: [], rowHeights: [] },
  };
}
