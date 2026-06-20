/**
 * PDF export handler for `tableRow` blocks.
 *
 * Follows the structural-context pattern used by the header/footer PDF export:
 * a minimal `PdfContextLike` shape lets the handler draw without importing
 * `@scrivr/export-pdf` or `pdf-lib` (which would create a dependency cycle and
 * pull a rendering library into core). The export pipeline passes its real
 * `PdfContext`; the runtime guard narrows to the fields used here.
 *
 * Mirrors the canvas `TableRowStrategy`: per cell, draw borders (top suppressed
 * for a vMerge continuation so a vertical merge reads as one cell) then render
 * each child block's text via `ctx.draw.lines` at its absolute y.
 */
import type { LayoutBlock } from "../layout/BlockLayout";

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
  const pageHeightPt = ctx.layout.pageConfig.pageHeight * PT_PER_PX;
  const thickness = PT_PER_PX;

  const stroke = (a: PdfPoint, b: PdfPoint): void =>
    ctx.page.drawLine({ start: a, end: b, thickness, color: BORDER_COLOR });

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    const top = block.y + cell.y;
    const rowNode = block.node.childCount > i ? block.node.child(i) : null;
    const skipTop = rowNode?.attrs["vMerge"] === "continue";

    // CSS px (top-left origin) → PDF points (bottom-left origin).
    const lx = cell.x * PT_PER_PX;
    const rx = (cell.x + cell.width) * PT_PER_PX;
    const ty = pageHeightPt - top * PT_PER_PX;
    const by = pageHeightPt - (top + cell.height) * PT_PER_PX;

    stroke({ x: lx, y: ty }, { x: lx, y: by }); // left
    stroke({ x: rx, y: ty }, { x: rx, y: by }); // right
    stroke({ x: lx, y: by }, { x: rx, y: by }); // bottom
    if (!skipTop) stroke({ x: lx, y: ty }, { x: rx, y: ty }); // top

    // Cell text: render each child block at its absolute y (row y + relative).
    for (const child of cell.blocks) {
      ctx.draw.lines({ ...child, y: block.y + child.y }, ctx);
    }
  }
}
