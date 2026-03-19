import { LayoutPage, PageConfig } from "../layout/PageLayout";
import { LayoutBlock } from "../layout/BlockLayout";
import { CharacterMap } from "../layout/CharacterMap";
import { TextMeasurer } from "../layout/TextMeasurer";
import { clearCanvas } from "./canvas";

export interface RenderPageOptions {
  ctx: CanvasRenderingContext2D;
  page: LayoutPage;
  pageConfig: PageConfig;
  /**
   * The layout version this render was scheduled for.
   * If it doesn't match currentVersion, the render is aborted.
   * Prevents stale renders when the doc changes mid-scroll.
   */
  renderVersion: number;
  currentVersion: () => number;
  dpr: number;
  measurer: TextMeasurer;
  map: CharacterMap;
  /** Draw margin guides — useful during development */
  showMarginGuides?: boolean;
}

/**
 * PageRenderer — draws one LayoutPage onto a canvas.
 *
 * Responsibilities:
 *   1. Stale render guard (version check)
 *   2. Clear canvas and draw page background
 *   3. Draw text for every block on the page
 *   4. Populate CharacterMap with glyph positions (just-in-time, per page)
 *
 * Does NOT own the canvas — receives ctx from the caller.
 * Does NOT run layout — receives a pre-computed LayoutPage.
 */
export function renderPage(options: RenderPageOptions): void {
  const {
    ctx,
    page,
    pageConfig,
    renderVersion,
    currentVersion,
    dpr,
    measurer,
    map,
    showMarginGuides = false,
  } = options;

  const { pageWidth, pageHeight, margins } = pageConfig;

  // ── Stale render guard ────────────────────────────────────────────────────
  if (renderVersion !== currentVersion()) return;

  // ── Clear + background ────────────────────────────────────────────────────
  clearCanvas(ctx, pageWidth, pageHeight, dpr);

  // ── Margin guides (dev mode) ──────────────────────────────────────────────
  if (showMarginGuides) {
    ctx.save();
    ctx.strokeStyle = "#dbeafe";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(
      margins.left,
      margins.top,
      pageWidth - margins.left - margins.right,
      pageHeight - margins.top - margins.bottom
    );
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Check stale again before drawing (layout may have changed) ───────────
  if (renderVersion !== currentVersion()) return;

  // ── Draw blocks ───────────────────────────────────────────────────────────
  for (const block of page.blocks) {
    drawBlock(ctx, block, measurer, map, page.pageNumber);
  }
}

// ── Private ───────────────────────────────────────────────────────────────────

function drawBlock(
  ctx: CanvasRenderingContext2D,
  block: LayoutBlock,
  measurer: TextMeasurer,
  map: CharacterMap,
  pageNumber: number
): void {
  const contentWidth = block.availableWidth;
  let lineIndex = 0;

  for (const line of block.lines) {
    // Alignment offset — must match what BlockLayout computed
    const lineOffsetX = computeAlignmentOffset(block.align, contentWidth, line.width);
    const lineY = block.y + getTotalLineHeight(block.lines, lineIndex);
    const baseline = lineY + line.ascent;

    for (const span of line.spans) {
      ctx.font = span.font;
      ctx.fillStyle = "#1e293b";
      ctx.fillText(span.text, block.x + lineOffsetX + span.x, baseline);

      // ── Populate CharacterMap (just-in-time, on first render of this page) ─
      if (!map.hasGlyph(span.docPos)) {
        const run = measurer.measureRun(span.text, span.font);

        for (let ci = 0; ci < span.text.length; ci++) {
          const charX =
            block.x + lineOffsetX + span.x + run.charPositions[ci]!;
          const charWidth =
            ci < span.text.length - 1
              ? run.charPositions[ci + 1]! - run.charPositions[ci]!
              : run.totalWidth - run.charPositions[ci]!;

          map.registerGlyph({
            docPos: span.docPos + ci,
            x: charX,
            y: lineY,
            width: charWidth,
            height: line.lineHeight,
            page: pageNumber,
            lineIndex: lineIndex + (block.lines.indexOf(line)),
          });
        }
      }
    }

    lineIndex++;
  }

  // Register lines if not yet registered
  let runningY = block.y;
  for (let li = 0; li < block.lines.length; li++) {
    const line = block.lines[li]!;
    if (!map.hasLine(pageNumber, li)) {
      map.registerLine({
        page: pageNumber,
        lineIndex: li,
        y: runningY,
        height: line.lineHeight,
        startDocPos: line.spans[0]?.docPos ?? 0,
        endDocPos:
          (line.spans.at(-1)?.docPos ?? 0) + (line.spans.at(-1)?.text.length ?? 0),
      });
    }
    runningY += line.lineHeight;
  }
}

function getTotalLineHeight(
  lines: LayoutBlock["lines"],
  upToIndex: number
): number {
  return lines.slice(0, upToIndex).reduce((sum, l) => sum + l.lineHeight, 0);
}

function computeAlignmentOffset(
  align: LayoutBlock["align"],
  availableWidth: number,
  lineWidth: number
): number {
  switch (align) {
    case "center": return Math.max(0, (availableWidth - lineWidth) / 2);
    case "right":  return Math.max(0, availableWidth - lineWidth);
    default:       return 0;
  }
}
