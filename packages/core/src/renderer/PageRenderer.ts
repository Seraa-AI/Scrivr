import { LayoutPage, PageConfig, FloatLayout } from "../layout/PageLayout";
import { LayoutBlock, computeAlignmentOffset } from "../layout/BlockLayout";
import { CharacterMap } from "../layout/CharacterMap";
import { TextMeasurer } from "../layout/TextMeasurer";
import { clearCanvas } from "./canvas";
import type { MarkDecorator } from "../extensions/types";
import type { BlockRegistry, InlineRegistry } from "../layout/BlockRegistry";

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
  /** Inline object registry — dispatches inline spans to their render strategies */
  inlineRegistry?: InlineRegistry;
  /** Float images on this page — rendered after (or before for 'behind') regular blocks */
  floats?: FloatLayout[];
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
    inlineRegistry,
    floats,
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

  // Floats on this page, partitioned by render order.
  const pageFloats = floats?.filter((f) => f.page === page.pageNumber) ?? [];
  const behindFloats = pageFloats.filter((f) => f.mode === "behind");
  const frontFloats  = pageFloats.filter((f) => f.mode !== "behind");

  // ── Draw 'behind' floats BEFORE blocks ────────────────────────────────────
  for (const float of behindFloats) {
    drawFloat(ctx, float, map, inlineRegistry);
  }

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
          ...(inlineRegistry ? { inlineRegistry } : {}),
        },
        map,
      );
    } else {
      lineIndexOffset = drawBlock(ctx, block, measurer, map, page.pageNumber, lineIndexOffset, markDecorators);
    }
  }

  // ── Draw front/square floats AFTER blocks ─────────────────────────────────
  for (const float of frontFloats) {
    drawFloat(ctx, float, map, inlineRegistry);
  }

  // ── Re-stamp float objectRects with real dimensions ────────────────────────
  // TextBlockStrategy.render registers 0×0 objectRects for float anchor spans
  // (the zero-width in-flow placeholders). For 'behind' floats drawn before
  // blocks, this overwrites the real dimensions set by drawFloat above.
  // Re-register after all rendering so renderHandles and getNodeViewportRect
  // always see the correct visual bounds regardless of draw order.
  for (const float of pageFloats) {
    map.registerObjectRect({
      docPos: float.docPos,
      x: float.x,
      y: float.y,
      width: float.width,
      height: float.height,
      page: float.page,
    });
  }
}

/**
 * Draws a single float image at its absolute position and registers its
 * ObjectRect in the CharacterMap so handles and popovers work.
 */
function drawFloat(
  ctx: CanvasRenderingContext2D,
  float: FloatLayout,
  map: CharacterMap,
  inlineRegistry?: InlineRegistry,
): void {
  const { x, y, width, height, node, docPos, page } = float;

  // Always register with actual float dimensions. populateCharMap registers a
  // 0×0 placeholder for the zero-width anchor span; we overwrite it here so
  // getNodeViewportRect / createImageMenu sees the real visual rect.
  map.registerObjectRect({ docPos, x, y, width, height, page });
  // Only register the anchor glyph if populateCharMap hasn't already done it.
  if (!map.hasGlyph(docPos)) {
    map.registerGlyph({
      docPos,
      x,
      y,
      lineY: y,
      width: 0,
      height: 0,
      page,
      lineIndex: 0,
    });
  }

  // Use inline strategy if available.
  const strategy = inlineRegistry?.get(node.type.name);
  if (strategy) {
    strategy.render(ctx, x, y, width, height, node);
    return;
  }

  // Fallback: draw a placeholder rect.
  ctx.save();
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
}

// ── Private ───────────────────────────────────────────────────────────────────

/**
 * Draws one block and registers its glyphs + lines into the CharacterMap.
 *
 * @param lineIndexOffset — page-global line count before this block.
 * @returns updated offset (lineIndexOffset + block.lines.length) for the
 *          next block to continue from.
 */
export function drawBlock(
  ctx: CanvasRenderingContext2D,
  block: LayoutBlock,
  measurer: TextMeasurer,
  map: CharacterMap,
  pageNumber: number,
  lineIndexOffset: number,
  markDecorators?: Map<string, MarkDecorator>
): number {
  const contentWidth = block.availableWidth;
  // Running Y accumulator — O(n) replacement for the getTotalLineHeight O(n²) reduce.
  let lineY = block.y;

  for (let li = 0; li < block.lines.length; li++) {
    const line = block.lines[li]!;
    const globalLineIndex = lineIndexOffset + li;

    // Alignment offset — must match what BlockLayout computed.
    // For float-constrained lines, constraintX shifts the line right (square-left floats).
    const lineConstraintX = line.constraintX ?? 0;
    const lineOffsetX = lineConstraintX + computeAlignmentOffset(block.align, line.effectiveWidth ?? contentWidth, line.width);
    const baseline = lineY + line.ascent;
    // textY: where the cursor draws — aligned to the text, not the full line.
    const textY = line.textAscent > 0
      ? lineY + line.ascent - line.textAscent
      : lineY + Math.max(0, line.lineHeight - line.cursorHeight) / 2;

    // Tracks the last text span + its measurement within this line.
    // Reused by the end-of-line sentinel to avoid a second measureRun call.
    let lastTextRun: { span: typeof line.spans[0] & { kind: "text" }; run: ReturnType<TextMeasurer["measureRun"]> } | null = null;

    for (const span of line.spans) {
      if (span.kind === "object") {
        // Fallback: object spans in drawBlock — no inline strategy available here.
        // Register two glyphs with cursorHeight so caret and hit-testing work.
        const objX = block.x + lineOffsetX + span.x;
        // Full-width glyph: midpoint at image center → 50/50 click split.
        // y = textY so cursor draws at the text baseline, not the image top.
        if (!map.hasGlyph(span.docPos)) {
          map.registerGlyph({
            docPos: span.docPos,
            x: objX,
            y: textY,
            lineY,
            width: span.width,
            height: line.cursorHeight,
            page: pageNumber,
            lineIndex: globalLineIndex,
          });
        }
        // Zero-width sentinel at right edge → coordsAtPos draws cursor at
        // the right edge of the image, not its center.
        if (!map.hasGlyph(span.docPos + 1)) {
          map.registerGlyph({
            docPos: span.docPos + 1,
            x: objX + span.width,
            y: textY,
            lineY,
            width: 0,
            height: line.cursorHeight,
            page: pageNumber,
            lineIndex: globalLineIndex,
          });
        }
        continue;
      }

      const spanX = block.x + lineOffsetX + span.x;
      const run = measurer.measureRun(span.text, span.font);
      lastTextRun = { span, run };
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
        const textY = line.textAscent > 0
          ? lineY + line.ascent - line.textAscent
          : lineY + Math.max(0, line.lineHeight - line.cursorHeight) / 2;
        for (let ci = 0; ci < span.text.length; ci++) {
          const charX = spanX + run.charPositions[ci]!;
          const charWidth =
            ci < span.text.length - 1
              ? run.charPositions[ci + 1]! - run.charPositions[ci]!
              : run.totalWidth - run.charPositions[ci]!;

          map.registerGlyph({
            docPos: span.docPos + ci,
            x: charX,
            y: textY,
            lineY,
            width: charWidth,
            height: line.cursorHeight,
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
        endDocPos: (() => {
          const s = line.spans[line.spans.length - 1];
          if (!s) return block.nodePos + 1;
          return s.kind === "text" ? s.docPos + s.text.length : s.docPos + 1;
        })(),
      });
    }

    // Register end-of-line caret sentinel on the last line only, and only
    // when the last span is text (object spans already register a right-half
    // glyph at docPos+1). Guard with hasGlyph so we don't duplicate when
    // populateCharMap ran first.
    const isLastLine = li === block.lines.length - 1;
    if (isLastLine && lastTextRun && lastTextRun.span.text !== "\u200B") {
      const { span: lastSpan, run: lastRun } = lastTextRun;
      const endDocPos = lastSpan.docPos + lastSpan.text.length;
      if (!map.hasGlyph(endDocPos)) {
        const sentinelX = block.x + lineOffsetX + lastSpan.x + lastRun.totalWidth;
        const textY = line.textAscent > 0
          ? lineY + line.ascent - line.textAscent
          : lineY + Math.max(0, line.lineHeight - line.cursorHeight) / 2;
        map.registerGlyph({
          docPos: endDocPos,
          x: sentinelX,
          y: textY,
          lineY,
          width: 0,
          height: line.cursorHeight,
          page: pageNumber,
          lineIndex: globalLineIndex,
        });
      }
    }

    lineY += line.lineHeight;
  }

  return lineIndexOffset + block.lines.length;
}

