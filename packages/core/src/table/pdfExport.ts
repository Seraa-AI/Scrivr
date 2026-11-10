/**
 * PDF export handler for a table row: its decoration, as the canvas row
 * painter draws it. What the cells hold is dispatched by the exporter, as any
 * composite's regions.
 *
 * Draws through `ctx.draw`, the surface core itself declares, so this works in
 * layout pixels and plain `Rgb` and never names a PDF library. Per cell: fill
 * the shading, then the borders (top suppressed for a vMerge continuation so a
 * vertical merge reads as one cell) — fill before stroke, so a border sits on
 * top of its own cell's shading rather than under it.
 */
import type { LayoutBlock } from "../layout/BlockLayout";
import { cellDataOf } from "./layout";
import { parseCssColor } from "../model/cssColor";
import type { PdfNodeContext, PdfPoint } from "../exports/pdf";
import type { Rgb } from "../model/cssColor";

/** #9ca3af */
const BORDER_COLOR: Rgb = { r: 156, g: 163, b: 175 };

export function renderTableRowPdf(
  block: LayoutBlock,
  ctx: Pick<PdfNodeContext, "draw">,
): void {
  const cells = block.regions ?? [];
  const last = cells[cells.length - 1];
  if (!last) return;
  const isLastRow = block.lastUnit === true;

  const stroke = (from: PdfPoint, to: PdfPoint): void =>
    ctx.draw.line({ from, to, thicknessPx: 1, color: BORDER_COLOR });

  // Each grid line once (same ownership as the canvas): cell owns LEFT + TOP,
  // the row owns one RIGHT edge, only the last row draws BOTTOM.
  for (const cell of cells) {
    const left = cell.x;
    const right = cell.x + cell.width;
    const top = block.y + cell.y;
    const bottom = top + cell.height;

    const { background, vMerge } = cellDataOf(cell);
    const fill = background === null ? null : parseCssColor(background);
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
    if (vMerge !== "continue") stroke({ x: left, y: top }, { x: right, y: top });
    if (isLastRow) stroke({ x: left, y: bottom }, { x: right, y: bottom });
  }

  const rx = last.x + last.width;
  const top = block.y + last.y;
  stroke({ x: rx, y: top }, { x: rx, y: top + last.height });
}
