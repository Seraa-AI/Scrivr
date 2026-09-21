/**
 * PDF export handler for `tableRow` blocks.
 *
 * Draws through `ctx.draw`, the surface core itself declares, so this works in
 * layout pixels and plain `Rgb` and never names a PDF library. The runtime
 * guard is still here because the export pipeline hands handlers an untyped
 * context.
 *
 * Mirrors the canvas `TableRowStrategy`: per cell, fill the shading, draw
 * borders (top suppressed for a vMerge continuation so a vertical merge reads
 * as one cell), then dispatch each child block to its own handler at its
 * absolute y — fill before stroke, so a border sits on top of its own cell's
 * shading rather than under it.
 */
import type { LayoutBlock } from "../layout/BlockLayout";
import { parseCssColor } from "../model/cssColor";
import type { PdfDrawSurface, PdfPoint } from "../exports/pdf";
import type { Rgb } from "../model/cssColor";

/** #9ca3af */
const BORDER_COLOR: Rgb = { r: 156, g: 163, b: 175 };

/** What this handler needs of the context it is handed. */
interface PdfContextLike {
  draw: PdfDrawSurface;
  /**
   * The pipeline's block dispatch. A cell holds ordinary blocks, and each
   * belongs to whichever extension defines it — the same division the import
   * side uses when a cell's content is read back with `walkBlocks`. Drawing
   * them here would make a table cell the one place a node type renders
   * differently.
   */
  blocks(blocks: readonly LayoutBlock[]): void;
}

function isPdfContext(value: unknown): value is PdfContextLike {
  if (typeof value !== "object" || value === null) return false;
  if (!("draw" in value) || !("blocks" in value)) return false;
  return typeof value.blocks === "function";
}

export function renderTableRowPdf(block: LayoutBlock, ctx: unknown): void {
  if (!isPdfContext(ctx)) return;
  const cells = block.cells ?? [];
  if (cells.length === 0) return;
  const isLastRow = block.isLastRow === true;

  const stroke = (from: PdfPoint, to: PdfPoint): void =>
    ctx.draw.line({ from, to, thicknessPx: 1, color: BORDER_COLOR });

  // Each grid line once (same ownership as the canvas): cell owns LEFT + TOP,
  // the row owns one RIGHT edge, only the last row draws BOTTOM.
  for (const cell of cells) {
    const left = cell.x;
    const right = cell.x + cell.width;
    const top = block.y + cell.y;
    const bottom = top + cell.height;

    const fill = cell.background === null ? null : parseCssColor(cell.background);
    if (fill !== null && fill.alpha > 0) {
      ctx.draw.rect({
        x: left,
        y: top,
        width: cell.width,
        height: cell.height,
        color: { r: fill.r, g: fill.g, b: fill.b },
        opacity: fill.alpha,
      });
    }

    stroke({ x: left, y: top }, { x: left, y: bottom });
    if (cell.vMerge !== "continue") stroke({ x: left, y: top }, { x: right, y: top });
    if (isLastRow) stroke({ x: left, y: bottom }, { x: right, y: bottom });

    // Positioned relative to the row, then dispatched — see `CellSubBlock.y`.
    ctx.blocks(cell.blocks.map((child) => ({ ...child, y: block.y + child.y })));
  }

  const last = cells[cells.length - 1]!;
  const rx = last.x + last.width;
  const top = block.y + last.y;
  stroke({ x: rx, y: top }, { x: rx, y: top + last.height });
}
