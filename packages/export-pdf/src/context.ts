/**
 * The pdf-lib side of the export: the draw helpers, which flip top-down layout
 * pixels into pdf-lib's bottom-up points, and the context the exporter itself
 * carries. Handlers are typed against core's `PdfNodeContext`, not this.
 */

import {
  rgb,
  PDFHexString,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  TextRenderingMode,
  radians,
  setLineWidth,
  setLineJoin,
  LineJoinStyle,
  setTextRenderingMode,
  setStrokingRgbColor,
  type PDFDocument,
  type PDFPage,
  type PDFFont,
  type PDFImage,
} from "pdf-lib";
import {
  compositeColor,
  computeAlignmentOffset,
  computeJustifySpaceBonus,
  countSpaces,
  parseCssColor as parseColorLiteral,
  type PdfMarkHandler,
  type PdfBox,
  type PdfBlockDrawSurface,
  type PdfNodeContext,
  type PdfImageOp,
  type PdfLineOp,
  type PdfRectOp,
  type PdfTextOp,
  type Rgb,
  type FontResolutionId,
  type LayoutBlock,
  type LayoutLine,
  type ResolvedTheme,
} from "@scrivr/core";
import { SYNTHETIC_ITALIC_SHEAR, emboldenWidth, fontSizeOf } from "@scrivr/core";
import type { PdfNodeHandler } from "./augmentation";
import { resolvePdfSpanStyle, type ResolvedPdfSpanStyle } from "./spanStyle";

/**
 * Keeps an out-of-range channel or opacity from failing the whole export.
 * Only NaN gets a verdict of its own: everything else, Infinity included,
 * clamps toward the end it overshot, so "too big" never reads as "zero".
 */
const clamp01 = (value: number): number =>
  Number.isNaN(value) ? 0 : Math.min(1, Math.max(0, value));

/** 1 CSS pixel = 0.75 PDF points (96dpi → 72dpi) */
export const PT_PER_PX = 72 / 96;

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * The neutral contract every handler is typed against, plus the pdf-lib values
 * the exporter itself uses — lifecycle hooks reach the document to write
 * metadata and outlines.
 *
 * A node handler is typed against `PdfNodeContext`, so the compiler withholds
 * these from it. The runtime does not: the pipeline hands every handler this
 * same object. The narrowing says what a handler may rely on, not what it can
 * reach.
 */
export interface PdfContext extends PdfNodeContext {
  doc: PDFDocument;
  page: PDFPage;
  fonts: PdfFontRegistry;
  images: Map<string, PDFImage | null>;
}

export interface PdfFontRegistry {
  /**
   * Pick the PDFFont for a span. `resolution` is the id the layout recorded
   * when it measured — pass it whenever the span carries one, so the PDF
   * paints the face the geometry came from instead of guessing a second time
   * from the family name.
   */
  resolve(cssFont: string, resolution?: FontResolutionId): PDFFont;
  /**
   * True when `font` is an embedded face carrying its own glyphs. Standard
   * fonts encode WinAnsi only, so their text must be sanitized before drawing.
   */
  isUnicode(font: PDFFont): boolean;
  /** Fallback font (Helvetica normal). */
  fallback: PDFFont;
}

/** Core owns this shape; the name stays for consumers importing it from here. */
export type PdfDrawHelpers = PdfBlockDrawSurface;

// ── Flip helper ──────────────────────────────────────────────────────────────

/** Flip from top-left (layout) to bottom-left (PDF) coordinate space. */
function flipY(yPx: number, pageHeightPt: number): number {
  return pageHeightPt - yPx * PT_PER_PX;
}

// ── Draw helpers implementation ──────────────────────────────────────────────

export function createDrawHelpers(
  pdfDoc: PDFDocument,
  getPage: () => PDFPage,
  pageHeightPt: number,
  fontRegistry: PdfFontRegistry,
  theme: ResolvedTheme,
  /**
   * Whether a run may be stretched to the width the layout recorded for it.
   *
   * Only true when the layout was measured against the very faces being
   * painted, by a different engine. When the face itself differs — a document
   * measured in Georgia and painted in Times because nobody supplied the bytes
   * — the width gap is a different typeface, not engine disagreement, and
   * closing it letterspaces the text instead of setting it.
   */
  fitToMeasuredWidth: boolean,
  images: ReadonlyMap<string, PDFImage | null>,
  /** Shared with the body loop so both report a missing handler the same way. */
  resolveNodeHandler: (name: string) => PdfNodeHandler | undefined,
  markHandlers: ReadonlyMap<string, PdfMarkHandler>,
): PdfDrawHelpers {
  /** Core speaks in 0-255 channels; pdf-lib wants 0-1. */
  const toPdfColor = (color: Rgb) =>
    rgb(clamp01(color.r / 255), clamp01(color.g / 255), clamp01(color.b / 255));

  const alpha = (opacity: number | undefined) =>
    opacity === undefined ? {} : { opacity: clamp01(opacity) };

  // A surface op carries one opacity for the whole shape, but pdf-lib keeps
  // non-stroking alpha apart from stroking alpha — so anything with a border
  // has to set both or its outline stays opaque.
  const alphaWithBorder = (opacity: number | undefined) =>
    opacity === undefined
      ? {}
      : { opacity: clamp01(opacity), borderOpacity: clamp01(opacity) };

  function drawText(op: PdfTextOp): void {
    // The same guard the span path applies. A handler cannot apply it itself —
    // a font handle names a family, it does not say what the format made of it
    // — so the one layer holding both the resolved font and the text does it.
    const font = fontRegistry.resolve(op.font.cssFont, op.font.resolution);
    const text = fontRegistry.isUnicode(font)
      ? stripInvisible(op.text)
      : sanitizeForWinAnsi(op.text);
    if (!text) return;

    getPage().drawText(text, {
      x: op.x * PT_PER_PX,
      y: flipY(op.baselineY, pageHeightPt),
      size: op.sizePx * PT_PER_PX,
      font,
      color: toPdfColor(op.color),
      ...alpha(op.opacity),
    });
  }

  function drawLine(op: PdfLineOp): void {
    getPage().drawLine({
      start: { x: op.from.x * PT_PER_PX, y: flipY(op.from.y, pageHeightPt) },
      end: { x: op.to.x * PT_PER_PX, y: flipY(op.to.y, pageHeightPt) },
      thickness: op.thicknessPx * PT_PER_PX,
      color: toPdfColor(op.color),
      ...alpha(op.opacity),
    });
  }

  function drawRect(op: PdfRectOp): void {
    // pdf-lib fills black when neither a colour nor a border is named, so an
    // op that asks for neither has to be refused here rather than passed on.
    if (op.color === undefined && op.border === undefined) return;
    getPage().drawRectangle({
      x: op.x * PT_PER_PX,
      y: flipY(op.y + op.height, pageHeightPt),
      width: op.width * PT_PER_PX,
      height: op.height * PT_PER_PX,
      ...(op.color === undefined ? {} : { color: toPdfColor(op.color) }),
      ...(op.border === undefined
        ? {}
        : {
            borderColor: toPdfColor(op.border.color),
            borderWidth: op.border.widthPx * PT_PER_PX,
          }),
      ...alphaWithBorder(op.opacity),
    });
  }

  function drawImage(op: PdfImageOp): void {
    const image = images.get(op.image.src) ?? null;
    if (!image) return drawImagePlaceholder(op, op.opacity);
    getPage().drawImage(image, {
      x: op.x * PT_PER_PX,
      y: flipY(op.y + op.height, pageHeightPt),
      width: op.width * PT_PER_PX,
      height: op.height * PT_PER_PX,
      ...alpha(op.opacity),
    });
  }

  /**
   * Stands in for an image that could not be drawn, so a broken one still
   * occupies its space. Painted from the export's own palette: an anchored
   * image and a block image on the same page should not disagree about grey.
   */
  function drawImagePlaceholder(box: PdfBox, opacity?: number): void {
    getPage().drawRectangle({
      x: box.x * PT_PER_PX,
      y: flipY(box.y + box.height, pageHeightPt),
      width: box.width * PT_PER_PX,
      height: box.height * PT_PER_PX,
      color: parseCssColor(theme.imagePlaceholderBg),
      borderColor: parseCssColor(theme.imagePlaceholderBorder),
      borderWidth: 1,
      ...alphaWithBorder(opacity),
    });
  }

  /** Compute Y for inline object vertical alignment. */
  function computeObjectRenderY(
    lineY: number,
    line: LayoutLine,
    span: { height: number; verticalAlign: string },
  ): number {
    const baseline = lineY + line.ascent;
    switch (span.verticalAlign) {
      case "top":         return lineY;
      case "bottom":      return lineY + line.lineHeight - span.height;
      case "middle":
        return line.xHeight > 0
          ? baseline - line.xHeight / 2 - span.height / 2
          : lineY + Math.max(0, line.lineHeight - span.height) / 2;
      case "text-top":    return baseline - line.textAscent;
      case "text-bottom": return baseline + line.descent - span.height;
      default:            return baseline - span.height; // "baseline"
    }
  }

  /**
   * Ask each mark on the span what it does, in the order the marks arrive.
   * A mark with no handler contributes nothing rather than being guessed at.
   */
  function spanStyles(
    marks: Array<{ name: string; attrs: Record<string, unknown> }> | undefined,
    ctx: PdfNodeContext,
  ): ResolvedPdfSpanStyle[] {
    if (!marks) return [];
    const out: ResolvedPdfSpanStyle[] = [];
    for (const mark of marks) {
      const handler = markHandlers.get(mark.name);
      if (handler) out.push(resolvePdfSpanStyle(handler(mark, { theme: ctx.theme })));
    }
    return out;
  }

  /**
   * The colour the text is actually painted in. An authored colour beats one a
   * mark supplies for being what it is, so a coloured link keeps its colour —
   * the cascade OOXML applies, and what the canvas resolves to.
   */
  function resolveFill(
    styles: ResolvedPdfSpanStyle[],
    fallback: ReturnType<typeof rgb>,
  ): ReturnType<typeof rgb> {
    let authored: ReturnType<typeof rgb> | undefined;
    let defaulted: ReturnType<typeof rgb> | undefined;
    for (const style of styles) {
      if (style.color !== undefined) authored = style.color;
      if (style.defaultColor !== undefined) defaulted = style.defaultColor;
    }
    return authored ?? defaulted ?? fallback;
  }

  /**
   * Paint what sits behind the glyphs, before they are drawn — the order the
   * canvas uses, and the only one where an opaque highlight still leaves its
   * text readable.
   */
  function drawSpanBackgrounds(
    span: { font: string; width: number },
    styles: ResolvedPdfSpanStyle[],
    spanAbsX: number,
    baselineY: number,
  ): void {
    const page = getPage();
    const fontSize = extractFontSizePx(span.font);
    for (const style of styles) {
      if (!style.backgroundColor) continue;
      const fill = style.backgroundColor;
      page.drawRectangle({
        x: spanAbsX * PT_PER_PX,
        y: flipY(baselineY + fontSize * 0.2, pageHeightPt),
        width: span.width * PT_PER_PX,
        height: fontSize * 1.1 * PT_PER_PX,
        color: fill.color,
        opacity: fill.opacity,
      });
    }
  }

  /** Paint what runs along the glyphs, after them: underline, strikethrough. */
  function drawSpanRules(
    span: { font: string; width: number },
    styles: ResolvedPdfSpanStyle[],
    spanAbsX: number,
    baselineY: number,
    effectiveTextColor: ReturnType<typeof rgb>,
  ): void {
    if (styles.length === 0) return;
    const page = getPage();

    const fontSize = extractFontSizePx(span.font);
    const thickness = Math.max(1, fontSize * 0.06) * PT_PER_PX;
    const x1 = spanAbsX * PT_PER_PX;
    const x2 = x1 + span.width * PT_PER_PX;
    const rule = (y: number, color: ReturnType<typeof rgb>) =>
      page.drawLine({
        start: { x: x1, y: flipY(y, pageHeightPt) },
        end: { x: x2, y: flipY(y, pageHeightPt) },
        thickness,
        color,
      });

    for (const style of styles) {
      if (style.underline) {
        rule(
          baselineY + fontSize * 0.15,
          style.underlineColor ?? effectiveTextColor,
        );
      }
      if (style.strikethrough) rule(baselineY - fontSize * 0.3, effectiveTextColor);
    }
  }

  function drawLines(block: LayoutBlock, ctx: PdfNodeContext): void {
    const page = getPage();
    const themeListMarker = parseCssColor(theme.listMarker);
    const themeDefaultText = parseCssColor(theme.defaultText);

    // Draw list marker if present.
    const firstLine = block.lines[0];
    if (block.listMarker && block.listMarkerX !== undefined && firstLine) {
      // A marker labels its line, so it takes that line's face as well as its
      // size. Pinning it to the fallback puts the number of a numbered clause
      // in a different typeface from the clause.
      const firstSpan = firstLine.spans[0];
      const markerFont =
        firstSpan?.kind === "text"
          ? fontRegistry.resolve(firstSpan.font, firstSpan.resolution)
          : fontRegistry.fallback;
      const fontSize = extractFontSizePx(
        (firstSpan?.kind === "text" ? firstSpan.font : undefined) ?? "12px sans-serif",
      );
      const markerText = fontRegistry.isUnicode(markerFont)
        ? stripInvisible(block.listMarker)
        : sanitizeForWinAnsi(block.listMarker);
      page.drawText(markerText, {
        x: block.listMarkerX * PT_PER_PX,
        y: flipY(block.y + firstLine.ascent, pageHeightPt),
        size: fontSize * PT_PER_PX,
        font: markerFont,
        color: themeListMarker,
      });
    }

    let lineY = block.y;
    for (let li = 0; li < block.lines.length; li++) {
      const line = block.lines[li]!;
      const isLastLineOfBlock =
        li === block.lines.length - 1 && !block.continuesOnNextPage;
      const positioned = line.positioned === true;
      const lineOffsetX = positioned
        ? 0
        : computeAlignmentOffset(block.align, block.availableWidth, line.width);
      const spaceBonus = positioned
        ? 0
        : computeJustifySpaceBonus(
            block.align,
            line.spans,
            block.availableWidth,
            line.width,
            isLastLineOfBlock,
          );
      const baselineY = lineY + line.ascent;
      const pdfBaseline = flipY(baselineY, pageHeightPt);

      // Formatting changes split one anchor across spans; adjacent spans with
      // the same target merge so a bolded word inside a link does not become
      // its own hit area. Adjacent, not merely same-target: a float divides a
      // line into segments, and text flowing either side of one must not be
      // joined across the hole the float sits in.
      let linkRun: LinkRun | null = null;
      const flushLinkRun = (): void => {
        if (linkRun) {
          addLinkAnnotation(pdfDoc, page, linkRun.href, {
            x0: linkRun.x0 * PT_PER_PX,
            x1: linkRun.x1 * PT_PER_PX,
            y0: flipY(baselineY + line.descent, pageHeightPt),
            // textAscent, not ascent: an inline object taller than the text
            // inflates the line box, and a hit area sized from that would
            // cover the object sitting above the link.
            y1: flipY(baselineY - line.textAscent, pageHeightPt),
          });
        }
        linkRun = null;
      };

      let spacesBeforeSpan = 0;
      for (const span of line.spans) {
        const spanAbsX =
          block.x + lineOffsetX + span.x + spacesBeforeSpan * spaceBonus;
        const styles = spanStyles(span.kind === "text" ? span.marks : undefined, ctx);

        // Object spans have no marks, so an inline image inside an anchor
        // ends the run rather than continuing it. The last mark to name a
        // target wins, the same way the last one to name a colour does.
        const href =
          span.kind === "text"
            ? (styles.reduce<string | undefined>(
                (found, style) => style.link ?? found,
                undefined,
              ) ?? null)
            : null;
        const continues =
          href !== null &&
          linkRun !== null &&
          linkRun.href === href &&
          span.x <= linkRun.rawEnd + ADJACENT_EPSILON;
        if (continues && linkRun !== null) {
          linkRun.x1 = spanAbsX + span.width;
          linkRun.rawEnd = span.x + span.width;
        } else {
          flushLinkRun();
          if (href !== null) {
            linkRun = {
              href,
              x0: spanAbsX,
              x1: spanAbsX + span.width,
              rawEnd: span.x + span.width,
            };
          }
        }

        if (span.kind === "object") {
          // No branch on the node's name: an inline atom is drawn by whichever
          // extension defines it, exactly as the same node would be in the
          // body. Reproducing one here is how the image case drifted from its
          // own handler.
          const handler = resolveNodeHandler(span.node.type.name);
          if (handler) {
            const objY = computeObjectRenderY(lineY, line, span);
            // Inline atoms render as a one-shot leaf block inside the host
            // line — empty `lines` and `kind: "leaf"` keep the dispatched
            // handler on the leaf code path.
            const atomBlock: LayoutBlock = {
              ...block,
              kind: "leaf",
              node: span.node,
              x: spanAbsX,
              y: objY,
              width: span.width,
              height: span.height,
              lines: [],
            };
            const atomCtx: PdfNodeContext = {
              ...ctx,
              x: spanAbsX,
              y: objY,
              width: span.width,
              ...(span.font !== undefined
                ? {
                    font: {
                      cssFont: span.font,
                      ...(span.resolution !== undefined
                        ? { resolution: span.resolution }
                        : {}),
                    },
                  }
                : {}),
            };
            handler(atomBlock, atomCtx);
          }
          continue;
        }

        if (span.kind !== "text") continue;

        const font = fontRegistry.resolve(span.font, span.resolution);
        const text = fontRegistry.isUnicode(font)
          ? stripInvisible(span.text)
          : sanitizeForWinAnsi(span.text);
        if (!text) {
          spacesBeforeSpan += countSpaces(span.text);
          continue;
        }

        const fontSize = extractFontSizePx(span.font);
        const color = resolveFill(styles, themeDefaultText);
        // Only when the drawn text is the text that was measured: the
        // sanitizer may have dropped characters the width still accounts for.
        const tracking =
          fitToMeasuredWidth && text === span.text
            ? trackingFor(span.width, text, font, fontSize * PT_PER_PX)
            : 0;

        drawSpanBackgrounds(span, styles, spanAbsX, baselineY);

        // The same stand-ins the canvas paints, from the same numbers, so a
        // weight or slant nobody owns looks the same on both sides and neither
        // changes an advance width.
        const synthesis =
          span.resolution === undefined
            ? undefined
            : ctx.layout.fontResolutions?.get(span.resolution)?.synthesis;
        const sizePt = fontSize * PT_PER_PX;
        const embolden = emboldenWidth(synthesis, sizePt);
        const lean = synthesis?.style?.to === "italic" ? SYNTHETIC_ITALIC_SHEAR : 0;

        if (tracking !== 0) setCharacterSpacing(page, tracking);
        if (embolden > 0) {
          page.pushOperators(
            setTextRenderingMode(TextRenderingMode.FillAndOutline),
            setLineWidth(embolden),
            // Rounded like the canvas, so a sharp apex does not spike in one
            // lane and not the other.
            setLineJoin(LineJoinStyle.Round),
          );
          page.pushOperators(setStrokingRgbColor(color.red, color.green, color.blue));
        }
        page.drawText(text, {
          x: spanAbsX * PT_PER_PX,
          y: pdfBaseline,
          size: sizePt,
          font,
          color,
          // A positive ySkew leans the glyph tops to the right, which is the
          // `x' = x + k·y` shear a designed italic approximates.
          ...(lean !== 0 ? { ySkew: radians(Math.atan(lean)) } : {}),
        });
        if (embolden > 0) {
          page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
        }
        if (tracking !== 0) setCharacterSpacing(page, 0);

        drawSpanRules(span, styles, spanAbsX, baselineY, color);

        spacesBeforeSpan += countSpaces(span.text);
      }
      flushLinkRun();
      lineY += line.lineHeight;
    }
  }

  return {
    lines: drawLines,
    text: drawText,
    line: drawLine,
    rect: drawRect,
    image: drawImage,
    imagePlaceholder: drawImagePlaceholder,
  };
}

// ── Shared utilities ─────────────────────────────────────────────────────────

/**
 * The per-glyph adjustment that makes a run fill the width it was measured to.
 *
 * A run measured by one engine and painted by another ends short of its box.
 * Character spacing adds a fixed amount to every glyph advance, closing the gap
 * without touching the glyphs.
 *
 * Zero when the run was measured and painted from the same face, so an export
 * that typeset its own geometry emits nothing. Not exactly zero when the
 * sanitizer dropped characters the width was measured with.
 */
export function trackingFor(
  measuredPx: number,
  text: string,
  font: PDFFont,
  sizePt: number,
): number {
  const glyphs = [...text].length;
  if (glyphs === 0) return 0;
  let natural: number;
  try {
    natural = font.widthOfTextAtSize(text, sizePt);
  } catch {
    // A face that cannot measure this text will not paint it either; leave the
    // spacing alone rather than guessing an adjustment for it.
    return 0;
  }
  const gap = measuredPx * PT_PER_PX - natural;
  // Below this the adjustment is invisible and only costs an operator per span.
  if (Math.abs(gap) < 0.01) return 0;

  const perGlyph = gap / glyphs;
  // Above this the premise is false: two engines reading one face differ by a
  // fraction of a percent, so a gap this wide means the run was measured in
  // some other face. Stretching it then crushes or scatters the letters, which
  // is worse than leaving it short.
  return Math.abs(perGlyph) > sizePt * 0.02 ? 0 : perGlyph;
}

/** pdf-lib has no helper for `Tc`, though its operator table names it. */
function setCharacterSpacing(page: PDFPage, amount: number): void {
  page.pushOperators(
    PDFOperator.of(PDFOperatorNames.SetCharacterSpacing, [PDFNumber.of(amount)]),
  );
}


/** One anchor's horizontal extent on a single line, in layout pixels. */
interface LinkRun {
  href: string;
  x0: number;
  x1: number;
  /**
   * Where the run ends before alignment and justification are applied.
   * Adjacency has to be judged in that frame: the painted gap between two
   * spans grows with the justification bonus, while an actual hole in the
   * line does not.
   */
  rawEnd: number;
}

/** Sub-pixel slack, so measurement noise does not read as a hole in the line. */
const ADJACENT_EPSILON = 0.5;

/**
 * Make a rectangle clickable. `Border: [0,0,0]` because the link underline is
 * already painted; viewers would otherwise draw their own box over it.
 */
function addLinkAnnotation(
  pdfDoc: PDFDocument,
  page: PDFPage,
  href: string,
  rect: { x0: number; x1: number; y0: number; y1: number },
): void {
  if (rect.x1 <= rect.x0 || rect.y1 <= rect.y0) return;
  const annotation = pdfDoc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [rect.x0, rect.y0, rect.x1, rect.y1],
    Border: [0, 0, 0],
    A: {
      Type: "Action",
      S: "URI",
      URI: encodePdfUri(href),
    },
  });
  page.node.addAnnot(pdfDoc.context.register(annotation));
}

/** Not legal in a URI, and readers truncate the target where one appears. */
const SPACE = 0x20;

/** URI actions carry ASCII bytes; hex strings keep PDF delimiters literal. */
function encodePdfUri(href: string): PDFHexString {
  // TextEncoder, not encodeURIComponent: the latter throws on a lone surrogate
  // and would re-escape the `%` and separators an href already carries.
  const asciiHref = Array.from(new TextEncoder().encode(href), (byte) =>
    byte > 0x7f || byte === SPACE
      ? `%${byte.toString(16).toUpperCase().padStart(2, "0")}`
      : String.fromCharCode(byte),
  ).join("");
  return PDFHexString.of(
    Array.from(asciiHref, (char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
  );
}

/** Extract font size from CSS font shorthand: "bold italic 14px Georgia" → 14 */
/** One parser for both lanes, so a shorthand cannot mean two sizes. */
export const extractFontSizePx = fontSizeOf;

/** Characters that carry no ink, so no font needs to be asked about them. */
const INVISIBLE = /[\u200b\u200c\u200d\u00ad\ufeff]/g;

/**
 * The repertoire of pdf-lib's standard fonts: ASCII, the printable upper half
 * of Latin-1, and the scattered codepoints Windows-1252 maps into 0x80-0x9F.
 * Written out rather than approximated by a range because both directions of
 * error are costly - too wide and `drawText` throws mid-export, too narrow and
 * legitimate text (currency, guillemets) is silently replaced with "?".
 * `winAnsi.test.ts` holds this to what the encoder actually accepts.
 */
const NOT_WIN_ANSI =
  /[^\u0020-\u007e\u00a0-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018-\u201a\u201c-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]/g;

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, "");
}

/**
 * Reduce text to what a standard PDF font can encode.
 *
 * Only for standard fonts. An embedded font carries its own glyphs, and
 * running this over it would destroy the very text it was embedded to render.
 */
export function sanitizeForWinAnsi(text: string): string {
  return stripInvisible(text).replace(NOT_WIN_ANSI, "?");
}

/**
 * Any CSS color literal → a pdf-lib `rgb()`, black when the value is not a
 * color. The document decides the spelling, not this exporter: a `color` mark
 * stores whatever the author or the source page declared, so names, `hsl()`,
 * and space-separated syntax all arrive here. Resolving is `@scrivr/core`'s
 * job — one vocabulary for PDF, DOCX, and the canvas.
 *
 * PDF has no alpha on a text fill, so a translucent color is composited onto
 * the page the exporter paints, which `defaultPdfTheme` keeps white.
 */
export function parseCssColor(value: string): ReturnType<typeof rgb> {
  const colour = parseColorLiteral(value);
  if (colour === null) return rgb(0, 0, 0);
  const opaque = compositeColor(colour, { r: 255, g: 255, b: 255 });
  return rgb(opaque.r / 255, opaque.g / 255, opaque.b / 255);
}

/** @deprecated Use `parseCssColor`, which reads every spelling, not only hex. */
export function parseHexColor(hex: string): ReturnType<typeof rgb> {
  return parseCssColor(hex);
}
