/**
 * PdfContext — the drawing context passed to every PDF export handler.
 * Handlers read layout data and draw via `ctx.draw` helpers (which handle
 * the Y-axis flip from top-down layout coords to pdf-lib's bottom-up system).
 */

import {
  rgb,
  type PDFDocument,
  type PDFPage,
  type PDFFont,
  type PDFImage,
} from "pdf-lib";
import {
  computeAlignmentOffset,
  computeJustifySpaceBonus,
  countSpaces,
  type DocumentLayout,
  type LayoutPage,
  type LayoutBlock,
  type LayoutLine,
  type IEditor,
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
  /** null when called via buildPdf(layout) without an editor instance. */
  editor: IEditor | null;
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
      page.drawText(block.listMarker, {
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

      let spacesBeforeSpan = 0;
      for (const span of line.spans) {
        const spanAbsX =
          block.x + lineOffsetX + span.x + spacesBeforeSpan * spaceBonus;

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

        const text = sanitizeForWinAnsi(span.text);
        if (!text) {
          spacesBeforeSpan += countSpaces(span.text);
          continue;
        }

        const fontSize = extractFontSizePx(span.font);
        const font = fontRegistry.resolve(span.font);
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

/** Extract font size from CSS font shorthand: "bold italic 14px Georgia" → 14 */
export function extractFontSizePx(cssFont: string): number {
  const match = cssFont.match(/(\d+(?:\.\d+)?)px/);
  return match?.[1] !== undefined ? parseFloat(match[1]) : 12;
}

/**
 * Remove characters that WinAnsi encoding cannot represent.
 * WinAnsi covers U+0020–U+00FF plus Windows-1252 extras: smart quotes,
 * em/en dash, bullet, ellipsis, trademark, etc. (U+2000–U+203A range).
 */
export function sanitizeForWinAnsi(text: string): string {
  return text
    .replace(/[\u200b\u200c\u200d\u00ad\ufeff]/g, "") // zero-width / invisible
    .replace(/[^\u0020-\u00ff\u0100-\u02dc\u2013-\u2026\u2030\u2039\u203a\u2122]/g, "?");
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
  if (typeof colorVal === "string") return parseHexColor(colorVal);
  if (marks?.some((m) => m.name === "link")) return parseCssColor(theme.link);
  return defaultTextColor;
}

/** Parse "#rrggbb" or "#rgb" → pdf-lib rgb(). Falls back to black. */
export function parseHexColor(hex: string): ReturnType<typeof rgb> {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    const [a, b, c] = clean.split("") as [string, string, string];
    return rgb(
      parseInt(a + a, 16) / 255,
      parseInt(b + b, 16) / 255,
      parseInt(c + c, 16) / 255,
    );
  }
  if (clean.length === 6) {
    return rgb(
      parseInt(clean.slice(0, 2), 16) / 255,
      parseInt(clean.slice(2, 4), 16) / 255,
      parseInt(clean.slice(4, 6), 16) / 255,
    );
  }
  return rgb(0, 0, 0);
}

/**
 * Parse any CSS color literal (`#hex`, `#rgb`, `rgb(...)`, `rgba(...)`) into a
 * pdf-lib `rgb()` color. Used for resolving theme tokens that callers may pass
 * in any of these forms. Falls back to black on unrecognized input.
 */
export function parseCssColor(value: string): ReturnType<typeof rgb> {
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) return parseHexColor(trimmed);
  const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(trimmed);
  if (rgbMatch) {
    const parts = rgbMatch[1]!.split(",").map((p) => p.trim());
    const r = parseFloat(parts[0] ?? "0");
    const g = parseFloat(parts[1] ?? "0");
    const b = parseFloat(parts[2] ?? "0");
    if ([r, g, b].every(Number.isFinite)) {
      return rgb(r / 255, g / 255, b / 255);
    }
  }
  return rgb(0, 0, 0);
}
