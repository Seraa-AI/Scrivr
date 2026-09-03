import type { BlockStrategy, BlockRenderContext } from "../layout/BlockRegistry";
import type { LayoutBlock, CellSubBlock } from "../layout/BlockLayout";
import type { CharacterMap } from "../layout/CharacterMap";
import { drawBlock } from "./PageRenderer";

/**
 * Renders a `kind: "tableRow"` block: paints each cell's border (and optional
 * background), then paints the cell's child blocks by reusing `drawBlock` — the
 * same text/glyph path body blocks use — so cell text, marks, and CharacterMap
 * hit-testing all work identically inside cells.
 *
 * Cell `y` values are relative to the row block's top; this adds the row block's
 * final `y` to place them absolutely at paint time.
 */
const BORDER_COLOR = "#9ca3af"; // neutral gray
const BORDER_WIDTH = 1;

/**
 * Paints the row's grid lines, each exactly once, so internal borders (shared
 * by adjacent cells/rows) aren't double-stroked and heavier than the outer
 * edge. Ownership: every cell draws its LEFT and TOP; the row draws one RIGHT
 * edge; only the last row draws BOTTOM (otherwise the row below owns that line
 * as its TOP). A vMerge continuation skips its TOP so the merge reads as one
 * cell.
 */
function paintRowGrid(
  ctx: CanvasRenderingContext2D,
  block: LayoutBlock,
  cells: CellSubBlock[],
  isLastRow: boolean,
): void {
  if (cells.length === 0) return;

  for (const cell of cells) {
    if (cell.background) {
      ctx.fillStyle = cell.background;
      ctx.fillRect(cell.x, block.y + cell.y, cell.width, cell.height);
    }
  }

  ctx.save();
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = BORDER_WIDTH;
  ctx.beginPath();
  for (const cell of cells) {
    const top = block.y + cell.y;
    const bottom = top + cell.height;
    const left = cell.x;
    const right = cell.x + cell.width;
    ctx.moveTo(left, top);
    ctx.lineTo(left, bottom);
    if (cell.vMerge !== "continue") {
      ctx.moveTo(left, top);
      ctx.lineTo(right, top);
    }
    if (isLastRow) {
      ctx.moveTo(left, bottom);
      ctx.lineTo(right, bottom);
    }
  }
  const last = cells[cells.length - 1]!;
  const lastTop = block.y + last.y;
  ctx.moveTo(last.x + last.width, lastTop);
  ctx.lineTo(last.x + last.width, lastTop + last.height);
  ctx.stroke();
  ctx.restore();
}

export const TableRowStrategy: BlockStrategy = {
  render(block: LayoutBlock, renderCtx: BlockRenderContext, map: CharacterMap): number {
    const { ctx, pageNumber, measurer, theme, markDecorators, blockRegistry, inlineRegistry } = renderCtx;
    let lineIndexOffset = renderCtx.lineIndexOffset;
    const cells = block.cells ?? [];

    paintRowGrid(ctx, block, cells, block.isLastRow === true);

    for (const cell of cells) {
      // Paint each child block at its absolute y (block.y + relative offsets).
      for (const child of cell.blocks) {
        const absoluteChild: LayoutBlock = { ...child, y: block.y + child.y };
        const strategy = blockRegistry?.get(absoluteChild.blockType);
        if (strategy) {
          lineIndexOffset = strategy.render(
            absoluteChild,
            { ...renderCtx, lineIndexOffset },
            map,
          );
        } else {
          lineIndexOffset = drawBlock(
            ctx,
            absoluteChild,
            measurer,
            map,
            pageNumber,
            lineIndexOffset,
            theme,
            markDecorators,
            inlineRegistry,
          );
        }
      }
    }

    return lineIndexOffset;
  },
};
