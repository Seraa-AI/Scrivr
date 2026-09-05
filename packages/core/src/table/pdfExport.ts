/**
 * PDF export handler for `tableRow` blocks.
 *
 * Follows the structural-context pattern used by the header/footer PDF export:
 * a minimal `PdfContextLike` shape lets the handler draw without importing
 * `@scrivr/export-pdf` or `pdf-lib` (which would create a dependency cycle and
 * pull a rendering library into core). The export pipeline passes its real
 * `PdfContext`; the runtime guard narrows to the fields used here.
 *
 * Mirrors the canvas `TableRowStrategy`: per cell, fill the shading, draw
 * borders (top suppressed for a vMerge continuation so a vertical merge reads
 * as one cell), then render each child block's text via `ctx.draw.lines` at its
 * absolute y — fill before stroke, so a border sits on top of its own cell's
 * shading rather than under it.
 */
import type { LayoutBlock } from "../layout/BlockLayout";
import { parseCssColor } from "../model/cssColor";

/** 1 CSS pixel = 0.75 PDF points (96dpi → 72dpi). */
const PT_PER_PX = 72 / 96;
/** #9ca3af as a structural match for pdf-lib's `rgb()` Color (no import). */
const BORDER_COLOR = { type: "RGB", red: 0.612, green: 0.639, blue: 0.686 };

interface PdfPoint {
  x: number;
  y: number;
}

/** Minimal shape of the PDF context — avoids importing from @scrivr/export-pdf. */
interface PdfContextLike {
  layout: { pageConfig: { pageHeight: number } };
  page: {
    drawLine(opts: { start: PdfPoint; end: PdfPoint; thickness: number; color: unknown }): void;
    drawRectangle(opts: {
      x: number;
      y: number;
      width: number;
      height: number;
      color: unknown;
      opacity: number;
    }): void;
  };
  draw: { lines(block: LayoutBlock, ctx: unknown): void };
}

function isPdfContext(value: unknown): value is PdfContextLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "layout" in value &&
    "page" in value &&
    "draw" in value
  );
}

export function renderTableRowPdf(block: LayoutBlock, ctx: unknown): void {
  if (!isPdfContext(ctx)) return;
  const cells = block.cells ?? [];
  if (cells.length === 0) return;
  const pageHeightPt = ctx.layout.pageConfig.pageHeight * PT_PER_PX;
  const thickness = PT_PER_PX;
  const isLastRow = block.isLastRow === true;

  const stroke = (a: PdfPoint, b: PdfPoint): void =>
    ctx.page.drawLine({ start: a, end: b, thickness, color: BORDER_COLOR });
  // CSS px (top-left origin) → PDF points (bottom-left origin).
  const flipY = (yPx: number): number => pageHeightPt - yPx * PT_PER_PX;

  // Each grid line once (same ownership as the canvas): cell owns LEFT + TOP,
  // the row owns one RIGHT edge, only the last row draws BOTTOM.
  for (const cell of cells) {
    const lx = cell.x * PT_PER_PX;
    const rx = (cell.x + cell.width) * PT_PER_PX;
    const ty = flipY(block.y + cell.y);
    const by = flipY(block.y + cell.y + cell.height);

    const fill = cell.background === null ? null : parseCssColor(cell.background);
    if (fill !== null && fill.alpha > 0) {
      // pdf-lib measures a rectangle from its lower-left corner.
      ctx.page.drawRectangle({
        x: lx,
        y: by,
        width: rx - lx,
        height: ty - by,
        color: { type: "RGB", red: fill.r / 255, green: fill.g / 255, blue: fill.b / 255 },
        opacity: fill.alpha,
      });
    }

    stroke({ x: lx, y: ty }, { x: lx, y: by });
    if (cell.vMerge !== "continue") stroke({ x: lx, y: ty }, { x: rx, y: ty });
    if (isLastRow) stroke({ x: lx, y: by }, { x: rx, y: by });

    for (const child of cell.blocks) {
      ctx.draw.lines({ ...child, y: block.y + child.y }, ctx);
    }
  }
  const last = cells[cells.length - 1]!;
  const rx = (last.x + last.width) * PT_PER_PX;
  stroke({ x: rx, y: flipY(block.y + last.y) }, { x: rx, y: flipY(block.y + last.y + last.height) });
}
