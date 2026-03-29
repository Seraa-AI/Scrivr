import type { CharacterMap } from "./CharacterMap";
import type { LayoutBlock } from "./BlockLayout";
import { computeAlignmentOffset, computeJustifySpaceBonus, countSpaces } from "./BlockLayout";
import { computeObjectRenderY } from "./LineBreaker";
import type { BlockStrategy, BlockRenderContext } from "./BlockRegistry";

/**
 * TextBlockStrategy — the default render strategy for text-based block nodes.
 *
 * Handles any block whose layout is expressed as LayoutLines of LayoutSpans
 * (paragraph, heading, list item, etc.). Draws each span with mark decorators
 * and registers glyph positions into the CharacterMap for cursor hit-testing.
 *
 * Text spans are drawn directly. Object spans (inline images, widgets) are
 * dispatched to the InlineRegistry — the Image extension registers an
 * InlineStrategy there.
 */
export const TextBlockStrategy: BlockStrategy = {
  render(block: LayoutBlock, renderCtx: BlockRenderContext, map: CharacterMap): number {
    const { ctx, pageNumber, lineIndexOffset, measurer, markDecorators, inlineRegistry } = renderCtx;
    const { lines, x, availableWidth, align } = block;

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!;
      const globalLineIndex = lineIndexOffset + li;
      const isLastLine = li === lines.length - 1;
      // For justify alignment, the "last line" exception (no stretching) applies only
      // to the very last line of the whole block — not the last rendered line of a
      // split part that continues on the next page.
      const isLastLineOfBlock = isLastLine && !block.continuesOnNextPage;

      const lineConstraintX = line.constraintX ?? 0;
      const lineOffsetX = lineConstraintX + computeAlignmentOffset(align, line.effectiveWidth ?? availableWidth, line.width);
      const spaceBonus = computeJustifySpaceBonus(align, line.spans, line.effectiveWidth ?? availableWidth, line.width, isLastLineOfBlock);
      const lineY = block.y + getTotalLineHeight(lines, li);
      const baseline = lineY + line.ascent;

      // textY: top of cursor rectangles for text glyphs on this line.
      // When a baseline image inflates line.ascent, text renders near the bottom
      // of the tall line. Align the cursor to the actual text position.
      const textY = line.textAscent > 0
        ? lineY + line.ascent - line.textAscent
        : lineY + Math.max(0, line.lineHeight - line.cursorHeight) / 2;

      let spacesBeforeSpan = 0;
      for (const span of line.spans) {
        // ── Inline object span (image, widget, …) ─────────────────────────────
        if (span.kind === "object") {
          const spanX = x + lineOffsetX + span.x;
          const objY = computeObjectRenderY(lineY, line, span);
          const strategy = inlineRegistry?.get(span.node.type.name);
          if (strategy) {
            strategy.render(ctx, spanX, objY, span.width, span.height, span.node);
          }
          // Store the full visual rect so the overlay can draw resize handles.
          map.registerObjectRect({ docPos: span.docPos, x: spanX, y: objY, width: span.width, height: span.height, page: pageNumber });
          // y = textY so cursor draws at the text baseline, not the image top.
          // Full-width glyph: midpoint at image center → 50/50 click split.
          if (!map.hasGlyph(span.docPos)) {
            map.registerGlyph({
              docPos: span.docPos,
              x: spanX,
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
              x: spanX + span.width,
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

        // ── Text span ─────────────────────────────────────────────────────────
        const run = measurer.measureRun(span.text, span.font);

        const drawSpan = (fillColor: string) => {
          if (spaceBonus === 0) {
            const spanX = x + lineOffsetX + span.x;
            ctx.fillStyle = fillColor;
            ctx.fillText(span.text, spanX, baseline);
          } else {
            let spacesWithinSpan = 0;
            for (let ci = 0; ci < span.text.length; ci++) {
              const charX =
                x + lineOffsetX + span.x + run.charPositions[ci]! +
                (spacesBeforeSpan + spacesWithinSpan) * spaceBonus;
              ctx.fillStyle = fillColor;
              ctx.fillText(span.text[ci]!, charX, baseline);
              if (span.text[ci] === " ") spacesWithinSpan++;
            }
          }
        };

        const spanX = x + lineOffsetX + span.x;
        const spanRect = {
          x: spanX,
          y: baseline,
          width: run.totalWidth,
          ascent: line.ascent,
          descent: line.descent,
          markAttrs: {} as Record<string, unknown>,
        };

        if (markDecorators && span.marks) {
          for (const markInfo of span.marks) {
            const dec = markDecorators.get(markInfo.name);
            if (dec?.decoratePre) dec.decoratePre(ctx, { ...spanRect, markAttrs: markInfo.attrs });
          }
        }

        ctx.font = span.font;

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
        drawSpan(fillColor);

        if (markDecorators && span.marks) {
          for (const markInfo of span.marks) {
            const dec = markDecorators.get(markInfo.name);
            if (dec?.decoratePost) dec.decoratePost(ctx, { ...spanRect, markAttrs: markInfo.attrs });
          }
        }

        if (!map.hasGlyph(span.docPos)) {
          let spacesWithinSpan = 0;
          for (let ci = 0; ci < span.text.length; ci++) {
            const charX =
              spanX + run.charPositions[ci]! +
              (spacesBeforeSpan + spacesWithinSpan) * spaceBonus;
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

            if (span.text[ci] === " ") spacesWithinSpan++;
          }
        }

        spacesBeforeSpan += countSpaces(span.text);
      }

      if (!map.hasLine(pageNumber, globalLineIndex)) {
        const lastSpan = line.spans[line.spans.length - 1];
        map.registerLine({
          page: pageNumber,
          lineIndex: globalLineIndex,
          y: lineY,
          height: line.lineHeight,
          x,
          contentWidth: availableWidth,
          startDocPos: line.spans[0]?.docPos ?? 0,
          endDocPos: lastSpan
            ? (lastSpan.kind === "text" ? lastSpan.docPos + lastSpan.text.length : lastSpan.docPos + 1)
            : 0,
        });
      }
    }

    return lineIndexOffset + lines.length;
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTotalLineHeight(lines: LayoutBlock["lines"], upToIndex: number): number {
  return lines.slice(0, upToIndex).reduce((sum, l) => sum + l.lineHeight, 0);
}
