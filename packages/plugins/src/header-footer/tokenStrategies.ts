/**
 * InlineStrategy implementations for header/footer token nodes.
 * Each token renders its actual value (page number, total pages, date)
 * instead of the placeholder text from the node spec.
 *
 * The page context below is written by whoever is about to ask a token its
 * size or draw it: resolveChrome once per layout run, canvas and PDF paint
 * once per page. Both measure() and render() read it.
 */

import type { InlineStrategy, TextMeasurerLike } from "@scrivr/core";
import type { Node } from "@scrivr/core/pm";

/** Node types whose reserved width follows the document's page count. */
export const PAGE_COUNT_TOKENS: ReadonlySet<string> = new Set(["pageNumber", "totalPages"]);

/** Current page context — set before measuring or painting, read by both. */
let currentPageNumber = 1;
let currentTotalPages = 1;

/** Call before rendering a page to set the context for token strategies. */
export function setTokenContext(pageNumber: number, totalPages: number): void {
  currentPageNumber = pageNumber;
  currentTotalPages = totalPages;
}

export function getCurrentPageNumber(): number { return currentPageNumber; }
export function getCurrentTotalPages(): number { return currentTotalPages; }

/**
 * Width of `digitCount` digits, measured as the widest digit in the font. A
 * page number sized to its own glyphs would resize as the reader scrolls from
 * page 8 to 9; sized to the widest digit it only changes when the count does.
 */
function measureDigitWidth(digitCount: number, font: string, measurer: TextMeasurerLike): number {
  let widest = 0;
  for (let d = 0; d <= 9; d++) {
    const run = measurer.measureRun(String(d), font);
    if (run.totalWidth > widest) widest = run.totalWidth;
  }
  return widest * digitCount;
}

/**
 * How many digits the highest page number takes. Counted from the number's own
 * text: `ceil(log10(n))` is one short at every exact power of ten, so a
 * ten-page document reserved a single digit and painted two.
 */
function digitsInPageCount(): number {
  return String(Math.max(currentTotalPages, 1)).length;
}

function measureTextWidth(text: string, font: string, measurer: TextMeasurerLike): number {
  return measurer.measureRun(text, font).totalWidth;
}

function fontHeight(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)px/);
  return match?.[1] ? parseFloat(match[1]) : 14;
}

/**
 * Draw token text using the canvas's current font (inherited from the
 * surrounding text span). Tokens adopt the same style as their context.
 */
function drawTokenText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  height: number,
): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y + height);
  ctx.restore();
}

export const pageNumberStrategy: InlineStrategy = {
  verticalAlign: "baseline",

  measure(_node, font, measurer) {
    return {
      width: measureDigitWidth(digitsInPageCount(), font, measurer),
      height: fontHeight(font),
    };
  },

  render(ctx: CanvasRenderingContext2D, x: number, y: number, _w: number, h: number) {
    drawTokenText(ctx, String(currentPageNumber), x, y, h);
  },
};

export const totalPagesStrategy: InlineStrategy = {
  verticalAlign: "baseline",

  measure(_node, font, measurer) {
    return {
      width: measureDigitWidth(digitsInPageCount(), font, measurer),
      height: fontHeight(font),
    };
  },

  render(ctx: CanvasRenderingContext2D, x: number, y: number, _w: number, h: number) {
    drawTokenText(ctx, String(currentTotalPages), x, y, h);
  },
};

export const dateStrategy: InlineStrategy = {
  verticalAlign: "baseline",

  measure(node, font, measurer) {
    const frozen = node.attrs["frozen"];
    const parsed = typeof frozen === "string" ? new Date(frozen) : new Date();
    const now = isNaN(parsed.getTime()) ? new Date() : parsed;
    return {
      width: measureTextWidth(now.toLocaleDateString(), font, measurer),
      height: fontHeight(font),
    };
  },

  render(ctx: CanvasRenderingContext2D, x: number, y: number, _w: number, h: number, node: Node) {
    const frozen = node.attrs["frozen"];
    const parsed = typeof frozen === "string" ? new Date(frozen) : new Date();
    const now = isNaN(parsed.getTime()) ? new Date() : parsed;
    drawTokenText(ctx, now.toLocaleDateString(), x, y, h);
  },
};
