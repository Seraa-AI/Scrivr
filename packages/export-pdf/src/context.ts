/**
 * PdfContext — the drawing context passed to every PDF export handler.
 * Handlers read layout data and draw via `ctx.draw` helpers (which handle
 * the Y-axis flip from top-down layout coords to pdf-lib's bottom-up system).
 */

import {
  rgb,
  PDFHexString,
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
  safeUrl,
  type DocumentLayout,
  type LayoutPage,
  type LayoutBlock,
  type LayoutLine,
  type IBaseEditor,
  type ResolvedTheme,
} from "@scrivr/core";
import type { PdfNodeHandler, PdfMarkHandler, PdfSpanStyle } from "./augmentation";

/** 1 CSS pixel = 0.75 PDF points (96dpi → 72dpi) */
export const PT_PER_PX = 72 / 96;

// ── Types ────────────────────────────────────────────────────────────────────

export interface PdfContext {
  doc: PDFDocument;
  page: PDFPage;
  layoutPage: LayoutPage;
  layout: DocumentLayout;
  /** Top-left of the current block in page coordinates (top-down). */
  x: number;
  y: number;
  width: number;
  fonts: PdfFontRegistry;
  images: Map<string, PDFImage | null>;
  draw: PdfDrawHelpers;
  /** The editor whose export contributions were collected (a ServerEditor suffices). */
  editor: IBaseEditor;
  /**
   * Resolved colors used by every PDF handler. Defaults to the print-ready
   * `defaultPdfTheme` regardless of the canvas theme; callers opt into a
   * themed PDF by passing `exportPdf({ theme })` (which is shallow-merged
   * over `defaultPdfTheme`).
   */
  theme: ResolvedTheme;
}

export interface PdfFontRegistry {
  /** Resolve a CSS font shorthand string to a PDFFont. */
  resolve(cssFont: string): PDFFont;
  /**
   * True when `font` is an embedded face carrying its own glyphs. Standard
   * fonts encode WinAnsi only, so their text must be sanitized before drawing.
   */
  isUnicode(font: PDFFont): boolean;
  /** Fallback font (Helvetica normal). */
  fallback: PDFFont;
}

export interface PdfDrawHelpers {
  /**
   * Draw all lines of a block, including list markers, text spans with mark
   * decorations, and inline atom dispatch. This is the main rendering workhorse.
   */
  lines(block: LayoutBlock, ctx: PdfContext): void;
  /** Draw an image at layout coordinates (handles Y-flip). */
  image(image: PDFImage, rect: { x: number; y: number; width: number; height: number }): void;
  /**
   * Draw a placeholder rectangle for missing images. Pass `theme` to color
   * the placeholder against the active PDF theme; omit for the legacy default.
   */
  imagePlaceholder(
    rect: { x: number; y: number; width: number; height: number },
    theme?: ResolvedTheme,
  ): void;
}

// ── Flip helper ──────────────────────────────────────────────────────────────

/** Flip from top-left (layout) to bottom-left (PDF) coordinate space. */
function flipY(yPx: number, pageHeightPt: number): number {
  return pageHeightPt - yPx * PT_PER_PX;
}

// ── Draw helpers implementation ──────────────────────────────────────────────

export function createDrawHelpers(
  getPage: () => PDFPage,
  pageHeightPt: number,
  fontRegistry: PdfFontRegistry,
  nodeHandlers: Record<string, PdfNodeHandler>,
  markHandlers: Record<string, PdfMarkHandler>,
): PdfDrawHelpers {
  function drawImage(
    image: PDFImage,
    rect: { x: number; y: number; width: number; height: number },
  ): void {
    getPage().drawImage(image, {
      x: rect.x * PT_PER_PX,
      y: flipY(rect.y + rect.height, pageHeightPt),
      width: rect.width * PT_PER_PX,
      height: rect.height * PT_PER_PX,
    });
  }

  function drawImagePlaceholder(
    rect: { x: number; y: number; width: number; height: number },
    theme?: ResolvedTheme,
  ): void {
    const borderColor = theme ? parseCssColor(theme.imagePlaceholderBorder) : rgb(0.88, 0.91, 0.94);
    const fillColor = theme ? parseCssColor(theme.imagePlaceholderBg) : rgb(0.95, 0.96, 0.98);
    getPage().drawRectangle({
      x: rect.x * PT_PER_PX,
      y: flipY(rect.y + rect.height, pageHeightPt),
      width: rect.width * PT_PER_PX,
      height: rect.height * PT_PER_PX,
      borderColor,
      borderWidth: 1,
      color: fillColor,
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

  function drawDecorations(
    span: {
      font: string;
      width: number;
      marks?: Array<{ name: string; attrs: Record<string, unknown> }>;
    },
    spanAbsX: number,
    baselineY: number,
    theme: ResolvedTheme,
    effectiveTextColor: ReturnType<typeof rgb>,
  ): void {
    if (!span.marks) return;
    const page = getPage();

    const fontSize = extractFontSizePx(span.font);
    const thickness = Math.max(1, fontSize * 0.06) * PT_PER_PX;
    const x1 = spanAbsX * PT_PER_PX;
    const x2 = x1 + span.width * PT_PER_PX;

    for (const mark of span.marks) {
      if (mark.name === "underline" || mark.name === "link") {
        // Underline follows the effective text color so colored text gets a
        // matching underline. Link uses theme.link explicitly.
        const lineColor =
          mark.name === "link" ? parseCssColor(theme.link) : effectiveTextColor;
        page.drawLine({
          start: { x: x1, y: flipY(baselineY + fontSize * 0.15, pageHeightPt) },
          end: { x: x2, y: flipY(baselineY + fontSize * 0.15, pageHeightPt) },
          thickness,
          color: lineColor,
        });
      }
      if (mark.name === "strikethrough") {
        page.drawLine({
          start: { x: x1, y: flipY(baselineY - fontSize * 0.3, pageHeightPt) },
          end: { x: x2, y: flipY(baselineY - fontSize * 0.3, pageHeightPt) },
          thickness,
          color: effectiveTextColor,
        });
      }
      if (mark.name === "highlight") {
        const highlightColor = parseHexColor(
          typeof mark.attrs["color"] === "string"
            ? mark.attrs["color"]
            : "#fef08a",
        );
        page.drawRectangle({
          x: x1,
          y: flipY(baselineY + fontSize * 0.2, pageHeightPt),
          width: span.width * PT_PER_PX,
          height: fontSize * 1.1 * PT_PER_PX,
          color: highlightColor,
          opacity: 0.4,
        });
      }
    }
  }

  function drawLines(block: LayoutBlock, ctx: PdfContext): void {
    const page = getPage();
    const themeListMarker = parseCssColor(ctx.theme.listMarker);
    const themeDefaultText = parseCssColor(ctx.theme.defaultText);

    // Draw list marker if present.
    const firstLine = block.lines[0];
    if (block.listMarker && block.listMarkerX !== undefined && firstLine) {
      const markerFont = fontRegistry.fallback;
      const firstSpan = firstLine.spans[0];
      const fontSize = extractFontSizePx(
        (firstSpan?.kind === "text" ? firstSpan.font : undefined) ?? "12px sans-serif",
      );
      page.drawText(sanitizeForWinAnsi(block.listMarker), {
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
      // its own hit area.
      let linkRun: LinkRun | null = null;
      const flushLinkRun = (): void => {
        if (linkRun) {
          addLinkAnnotation(ctx.doc, page, linkRun.href, {
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

        // Object spans have no marks, so an inline image inside an anchor
        // ends the run rather than continuing it.
        const href = span.kind === "text" ? linkHref(span.marks) : null;
        if (href !== null && linkRun !== null && linkRun.href === href) {
          linkRun.x1 = spanAbsX + span.width;
        } else {
          flushLinkRun();
          if (href !== null) {
            linkRun = { href, x0: spanAbsX, x1: spanAbsX + span.width };
          }
        }

        // Inline atom dispatch — look up nodeHandlers for object spans
        if (span.kind === "object") {
          if (span.node.type.name === "image" && span.width > 0 && span.height > 0) {
            const src = span.node.attrs["src"] as string | undefined;
            const image = src ? ctx.images.get(src) : null;
            const objY = computeObjectRenderY(lineY, line, span);
            if (image) {
              drawImage(image, { x: spanAbsX, y: objY, width: span.width, height: span.height });
            } else {
              drawImagePlaceholder({ x: spanAbsX, y: objY, width: span.width, height: span.height });
            }
          } else {
            // Non-image inline atom — dispatch to handler if one exists
            const handler = nodeHandlers[span.node.type.name];
            if (handler) {
              const objY = computeObjectRenderY(lineY, line, span);
              // Inline atoms render as a one-shot leaf block inside the host
              // line — empty `lines` and `kind: "leaf"` keep the dispatched
              // handler on the leaf code path (e.g. defaults.image).
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
              const atomCtx = { ...ctx, x: spanAbsX, y: objY, width: span.width };
              handler(atomBlock, atomCtx);
            }
          }
          continue;
        }

        if (span.kind !== "text") continue;

        const font = fontRegistry.resolve(span.font);
        const text = fontRegistry.isUnicode(font)
          ? stripInvisible(span.text)
          : sanitizeForWinAnsi(span.text);
        if (!text) {
          spacesBeforeSpan += countSpaces(span.text);
          continue;
        }

        const fontSize = extractFontSizePx(span.font);
        const color = extractColor(span.marks, ctx.theme, themeDefaultText);

        page.drawText(text, {
          x: spanAbsX * PT_PER_PX,
          y: pdfBaseline,
          size: fontSize * PT_PER_PX,
          font,
          color,
        });

        drawDecorations(span, spanAbsX, baselineY, ctx.theme, color);

        spacesBeforeSpan += countSpaces(span.text);
      }
      flushLinkRun();
      lineY += line.lineHeight;
    }
  }

  return {
    lines: drawLines,
    image: drawImage,
    imagePlaceholder: drawImagePlaceholder,
  };
}

// ── Shared utilities ─────────────────────────────────────────────────────────

/** One anchor's horizontal extent on a single line, in layout pixels. */
interface LinkRun {
  href: string;
  x0: number;
  x1: number;
}

/** Schemes a viewer can act on with no base URL to resolve against. */
const FOLLOWABLE_TARGET = /^(?:https?|mailto|tel):/i;

/**
 * The link target for a span. Safety is `safeUrl` — the gate ingestion already
 * applies, so there is one answer to "is this URL safe" rather than one per
 * sink. Followability is a separate question it does not answer.
 */
function linkHref(
  marks: Array<{ name: string; attrs: Record<string, unknown> }> | undefined,
): string | null {
  const link = marks?.find((m) => m.name === "link");
  const url = link ? safeUrl(link.attrs["href"]) : null;
  return url !== null && FOLLOWABLE_TARGET.test(url) ? url : null;
}

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
export function extractFontSizePx(cssFont: string): number {
  const match = cssFont.match(/(\d+(?:\.\d+)?)px/);
  return match?.[1] !== undefined ? parseFloat(match[1]) : 12;
}

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
 * Extract text fill color from marks. User-applied `color` mark wins; link
 * mark falls through to `theme.link`; everything else gets `theme.defaultText`
 * (passed in pre-resolved to avoid re-parsing per span).
 */
function extractColor(
  marks: Array<{ name: string; attrs: Record<string, unknown> }> | undefined,
  theme: ResolvedTheme,
  defaultTextColor: ReturnType<typeof rgb>,
): ReturnType<typeof rgb> {
  const colorMark = marks?.find((m) => m.name === "color");
  const colorVal = colorMark?.attrs["color"];
  if (typeof colorVal === "string") return parseCssColor(colorVal);
  if (marks?.some((m) => m.name === "link")) return parseCssColor(theme.link);
  return defaultTextColor;
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
