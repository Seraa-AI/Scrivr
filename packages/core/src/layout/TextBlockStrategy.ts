import type { CharacterMap } from "./CharacterMap";
import type { LayoutBlock } from "./BlockLayout";
import { computeAlignmentOffset, computeJustifySpaceBonus, countSpaces } from "./BlockLayout";
import type { BlockStrategy, BlockRenderContext } from "./BlockRegistry";

/**
 * TextBlockStrategy — the default render strategy for text-based block nodes.
 *
 * Handles any block whose layout is expressed as LayoutLines of LayoutSpans
 * (paragraph, heading, list item, etc.). Draws each span with mark decorators
 * and registers glyph positions into the CharacterMap for cursor hit-testing.
 *
 * Paragraph and Heading extensions register an instance of this strategy.
 * Future block types (image, code block, table) register their own strategies.
 */
export const TextBlockStrategy: BlockStrategy = {
  render(block: LayoutBlock, renderCtx: BlockRenderContext, map: CharacterMap): number {
    const { ctx, pageNumber, lineIndexOffset, measurer, markDecorators } = renderCtx;
    const { lines, x, availableWidth, align } = block;

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!;
      const globalLineIndex = lineIndexOffset + li;
      const isLastLine = li === lines.length - 1;

      const lineOffsetX = computeAlignmentOffset(align, availableWidth, line.width);
      const spaceBonus = computeJustifySpaceBonus(align, line.spans, availableWidth, line.width, isLastLine);
      const lineY = block.y + getTotalLineHeight(lines, li);
      const baseline = lineY + line.ascent;

      let spacesBeforeSpan = 0;
      for (const span of line.spans) {
        const run = measurer.measureRun(span.text, span.font);

        // For justify: draw each character individually at its adjusted x.
        // For other alignments spaceBonus is 0, so charX collapses to spanX + charPos.
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

        // decoratePre — backgrounds, highlights
        if (markDecorators && span.marks) {
          for (const markInfo of span.marks) {
            const dec = markDecorators.get(markInfo.name);
            if (dec?.decoratePre) dec.decoratePre(ctx, { ...spanRect, markAttrs: markInfo.attrs });
          }
        }

        ctx.font = span.font;

        // decorateFill — allow marks to override text color (e.g. Color extension)
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

        // decoratePost — underlines, strikethroughs
        if (markDecorators && span.marks) {
          for (const markInfo of span.marks) {
            const dec = markDecorators.get(markInfo.name);
            if (dec?.decoratePost) dec.decoratePost(ctx, { ...spanRect, markAttrs: markInfo.attrs });
          }
        }

        // Populate CharacterMap (guarded — only on first render of this page)
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
              y: lineY,
              width: charWidth,
              height: line.lineHeight,
              page: pageNumber,
              lineIndex: globalLineIndex,
            });

            if (span.text[ci] === " ") spacesWithinSpan++;
          }
        }

        spacesBeforeSpan += countSpaces(span.text);
      }

      // Register line entry with the page-global index
      if (!map.hasLine(pageNumber, globalLineIndex)) {
        map.registerLine({
          page: pageNumber,
          lineIndex: globalLineIndex,
          y: lineY,
          height: line.lineHeight,
          x,
          contentWidth: availableWidth,
          startDocPos: line.spans[0]?.docPos ?? 0,
          endDocPos:
            (line.spans[line.spans.length - 1]?.docPos ?? 0) +
            (line.spans[line.spans.length - 1]?.text.length ?? 0),
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

