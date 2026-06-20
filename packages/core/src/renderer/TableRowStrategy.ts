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

function vMergeOf(rowNode: LayoutBlock["node"], cellIndex: number): string {
  const cell = rowNode.childCount > cellIndex ? rowNode.child(cellIndex) : null;
  const v = cell?.attrs["vMerge"];
  return typeof v === "string" ? v : "none";
}

function backgroundOf(rowNode: LayoutBlock["node"], cellIndex: number): string | null {
  const cell = rowNode.childCount > cellIndex ? rowNode.child(cellIndex) : null;
  const bg = cell?.attrs["background"];
  return typeof bg === "string" && bg.length > 0 ? bg : null;
}

function paintCellChrome(
  ctx: CanvasRenderingContext2D,
  cell: CellSubBlock,
  cellTop: number,
  background: string | null,
  suppressTopBorder: boolean,
): void {
  const x = cell.x;
  const w = cell.width;
  const h = cell.height;

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(x, cellTop, w, h);
  }

  ctx.save();
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = BORDER_WIDTH;
  const inset = BORDER_WIDTH / 2;
  ctx.beginPath();
  // left, right, bottom always; top suppressed for vMerge continuations so a
  // vertical merge reads as one cell.
  ctx.moveTo(x + inset, cellTop);
  ctx.lineTo(x + inset, cellTop + h);
  ctx.moveTo(x + w - inset, cellTop);
  ctx.lineTo(x + w - inset, cellTop + h);
  ctx.moveTo(x + inset, cellTop + h - inset);
  ctx.lineTo(x + w - inset, cellTop + h - inset);
  if (!suppressTopBorder) {
    ctx.moveTo(x + inset, cellTop + inset);
    ctx.lineTo(x + w - inset, cellTop + inset);
  }
  ctx.stroke();
  ctx.restore();
}

export const TableRowStrategy: BlockStrategy = {
  render(block: LayoutBlock, renderCtx: BlockRenderContext, map: CharacterMap): number {
    const { ctx, pageNumber, measurer, theme, markDecorators } = renderCtx;
    let lineIndexOffset = renderCtx.lineIndexOffset;
    const cells = block.cells ?? [];

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!;
      const cellTop = block.y + cell.y;

      paintCellChrome(
        ctx,
        cell,
        cellTop,
        backgroundOf(block.node, i),
        vMergeOf(block.node, i) === "continue",
      );

      // Paint each child block at its absolute y (block.y + relative offsets).
      for (const child of cell.blocks) {
        const absoluteChild: LayoutBlock = { ...child, y: block.y + child.y };
        lineIndexOffset = drawBlock(
          ctx,
          absoluteChild,
          measurer,
          map,
          pageNumber,
          lineIndexOffset,
          theme,
          markDecorators,
        );
      }
    }

    return lineIndexOffset;
  },
};
