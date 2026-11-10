import type { BlockStrategy } from "../layout/BlockRegistry";
import type { LaidRegion, LayoutBlock } from "../layout/BlockLayout";
import { cellDataOf } from "./layout";

/**
 * Paints a table row's decoration: each cell's background and the grid lines.
 * What the cells hold is painted by the engine, as any composite's regions.
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
  cells: readonly LaidRegion[],
  isLastRow: boolean,
): void {
  const last = cells[cells.length - 1];
  if (!last) return;

  for (const cell of cells) {
    const { background } = cellDataOf(cell);
    if (background) {
      ctx.fillStyle = background;
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
    if (cellDataOf(cell).vMerge !== "continue") {
      ctx.moveTo(left, top);
      ctx.lineTo(right, top);
    }
    if (isLastRow) {
      ctx.moveTo(left, bottom);
      ctx.lineTo(right, bottom);
    }
  }
  const lastTop = block.y + last.y;
  ctx.moveTo(last.x + last.width, lastTop);
  ctx.lineTo(last.x + last.width, lastTop + last.height);
  ctx.stroke();
  ctx.restore();
}

export const tableRowPainter: BlockStrategy = {
  render(block, renderCtx) {
    paintRowGrid(renderCtx.ctx, block, block.regions ?? [], block.lastUnit === true);
    return renderCtx.lineIndexOffset;
  },
};
