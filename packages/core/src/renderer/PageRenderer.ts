import { LayoutPage, PageConfig } from "../layout/PageLayout";
import { LayoutBlock, computeAlignmentOffset } from "../layout/BlockLayout";
import { CharacterMap } from "../layout/CharacterMap";
import { TextMeasurer } from "../layout/TextMeasurer";
import { clearCanvas } from "./canvas";
import type { MarkDecorator } from "../extensions/types";
import type { BlockRegistry } from "../layout/BlockRegistry";

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
  /** Mark decorators from extensions — draws underlines, strikethroughs, highlights */
  markDecorators?: Map<string, MarkDecorator>;
  /** Block registry from extensions — dispatches each block to its strategy */
  blockRegistry?: BlockRegistry;
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
    markDecorators,
    blockRegistry,
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
  // lineIndexOffset accumulates across blocks so every line on the page has
  // a unique index in the CharacterMap. Without this, each block resets to 0
  // and posAtCoords can't distinguish lines in different paragraphs.
  let lineIndexOffset = 0;
  for (const block of page.blocks) {
    const strategy = blockRegistry?.get(block.blockType);
    if (strategy) {
      lineIndexOffset = strategy.render(
        block,
        {
          ctx,
          pageNumber: page.pageNumber,
          lineIndexOffset,
          dpr,
          measurer,
          ...(markDecorators ? { markDecorators } : {}),
        },
        map,
      );
    } else {
      lineIndexOffset = drawBlock(ctx, block, measurer, map, page.pageNumber, lineIndexOffset, markDecorators);
    }
  }
}

// ── Private ───────────────────────────────────────────────────────────────────

/**
 * Draws one block and registers its glyphs + lines into the CharacterMap.
 *
 * @param lineIndexOffset — page-global line count before this block.
 * @returns updated offset (lineIndexOffset + block.lines.length) for the
 *          next block to continue from.
 */
function drawBlock(
  ctx: CanvasRenderingContext2D,
  block: LayoutBlock,
  measurer: TextMeasurer,
  map: CharacterMap,
  pageNumber: number,
  lineIndexOffset: number,
  markDecorators?: Map<string, MarkDecorator>
): number {
  const contentWidth = block.availableWidth;

  for (let li = 0; li < block.lines.length; li++) {
    const line = block.lines[li]!;
    const globalLineIndex = lineIndexOffset + li;

    // Alignment offset — must match what BlockLayout computed
    const lineOffsetX = computeAlignmentOffset(block.align, contentWidth, line.width);
    const lineY = block.y + getTotalLineHeight(block.lines, li);
    const baseline = lineY + line.ascent;

    for (const span of line.spans) {
      const spanX = block.x + lineOffsetX + span.x;
      const run = measurer.measureRun(span.text, span.font);
      const spanRect = {
        x: spanX,
        y: baseline,
        width: run.totalWidth,
        ascent: line.ascent,
        descent: line.descent,
        markAttrs: {} as Record<string, unknown>,
      };

      // decoratePre for all marks
      if (markDecorators && span.marks) {
        for (const markInfo of span.marks) {
          const dec = markDecorators.get(markInfo.name);
          if (dec?.decoratePre) dec.decoratePre(ctx, { ...spanRect, markAttrs: markInfo.attrs });
        }
      }

      ctx.font = span.font;

      // Allow marks to override text fill color (e.g. Color extension).
      let fillColor = "#1e293b";
      if (markDecorators && span.marks) {
        for (const markInfo of span.marks) {
          const dec = markDecorators.get(markInfo.name);
          if (dec?.decorateFill) {
            const override = dec.decorateFill({ ...spanRect, markAttrs: markInfo.attrs });
            if (override !== undefined) fillColor = override;
          }
        }
      }
      ctx.fillStyle = fillColor;
      ctx.fillText(span.text, spanX, baseline);

      // decoratePost for all marks
      if (markDecorators && span.marks) {
        for (const markInfo of span.marks) {
          const dec = markDecorators.get(markInfo.name);
          if (dec?.decoratePost) dec.decoratePost(ctx, { ...spanRect, markAttrs: markInfo.attrs });
        }
      }

      // ── Populate CharacterMap (just-in-time, on first render of this page) ─
      if (!map.hasGlyph(span.docPos)) {
        for (let ci = 0; ci < span.text.length; ci++) {
          const charX = spanX + run.charPositions[ci]!;
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
            lineIndex: globalLineIndex,
          });
        }
      }
    }

    // Register line entry with the page-global index
    if (!map.hasLine(pageNumber, globalLineIndex)) {
      map.registerLine({
        page: pageNumber,
        lineIndex: globalLineIndex,
        y: lineY,
        height: line.lineHeight,
        x: block.x,
        contentWidth: block.availableWidth,
        startDocPos: line.spans[0]?.docPos ?? block.nodePos + 1,
        endDocPos:
          (line.spans[line.spans.length - 1]?.docPos ?? block.nodePos + 1) +
          (line.spans[line.spans.length - 1]?.text.length ?? 0),
      });
    }

    // Register end-of-line caret sentinel on the last line only.
    // See populateCharMap for the full explanation. Guard with hasGlyph
    // so we don't duplicate when populateCharMap ran first.
    const isLastLine = li === block.lines.length - 1;
    const lastSpan = line.spans[line.spans.length - 1];
    if (isLastLine && lastSpan && lastSpan.text !== "\u200B") {
      const endDocPos = lastSpan.docPos + lastSpan.text.length;
      if (!map.hasGlyph(endDocPos)) {
        const lastRun = measurer.measureRun(lastSpan.text, lastSpan.font);
        const lastLineOffsetX = computeAlignmentOffset(block.align, contentWidth, line.width);
        map.registerGlyph({
          docPos: endDocPos,
          x: block.x + lastLineOffsetX + lastSpan.x + lastRun.totalWidth,
          y: lineY,
          width: 0,
          height: line.lineHeight,
          page: pageNumber,
          lineIndex: globalLineIndex,
        });
      }
    }
  }

  return lineIndexOffset + block.lines.length;
}

function getTotalLineHeight(
  lines: LayoutBlock["lines"],
  upToIndex: number
): number {
  return lines.slice(0, upToIndex).reduce((sum, l) => sum + l.lineHeight, 0);
}

