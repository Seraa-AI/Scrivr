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

/**
 * The token whose width differs from page to page. `totalPages` prints the same
 * string everywhere, so a band holding only that one needs no arrangements.
 */
export const PER_PAGE_TOKEN = "pageNumber";

/** Current page context — set before measuring or painting, read by both. */
let currentPageNumber = 1;
let currentTotalPages = 1;

/**
 * The page number a measurement should reserve room for, while a band is being
 * arranged for one. Null means nobody is arranging, and the only safe answer is
 * the widest: a token measured outside a band — one sitting in body text — is
 * measured once for the whole document and painted on whatever page it lands.
 */
let arrangedPageNumber: number | null = null;

/** Call before rendering a page to set the context for token strategies. */
export function setTokenContext(pageNumber: number, totalPages: number): void {
  currentPageNumber = pageNumber;
  currentTotalPages = totalPages;
}

/**
 * Measure `arrange` as though the band were being painted on `pageNumber`.
 *
 * Only a band gets an arrangement per page. Everything else must reserve the
 * widest, so this is a scope rather than a setting — leaving it set would make
 * the next measurement's width depend on which page was arranged last, and a
 * token in body text would reflow as the reader scrolls.
 */
export function arrangedForPage<T>(pageNumber: number, arrange: () => T): T {
  const previous = arrangedPageNumber;
  arrangedPageNumber = pageNumber;
  try {
    return arrange();
  } finally {
    arrangedPageNumber = previous;
  }
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
 * How many digits a number takes. Counted from its own text: `ceil(log10(n))`
 * is one short at every exact power of ten, so a ten-page document reserved a
 * single digit and painted two.
 *
 * Exported because the arrangements a band is measured in are keyed by it —
 * two answers to this would put a page's number in a box built for a different
 * width.
 */
export function digitsIn(value: number): number {
  return String(Math.max(value, 1)).length;
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

  // Sized for the page this band is being arranged for, so "2" gets a one-digit
  // box even in a thousand-page document. Outside an arrangement there is no
  // single page to size for, so it reserves the widest the document can reach.
  measure(_node, font, measurer) {
    return {
      width: measureDigitWidth(digitsIn(arrangedPageNumber ?? currentTotalPages), font, measurer),
      height: fontHeight(font),
    };
  },

  render(ctx: CanvasRenderingContext2D, x: number, y: number, _w: number, h: number) {
    drawTokenText(ctx, String(currentPageNumber), x, y, h);
  },
};

export const totalPagesStrategy: InlineStrategy = {
  verticalAlign: "baseline",

  // The total is the same on every page, so this needs no arrangement of its own.
  measure(_node, font, measurer) {
    return {
      width: measureDigitWidth(digitsIn(currentTotalPages), font, measurer),
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
