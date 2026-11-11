/**
 * InlineStrategy implementations for header/footer token nodes.
 * Each token renders its actual value (page number, total pages, date)
 * instead of the placeholder text from the node spec.
 *
 * Painting sets the current page and total. Band measurement supplies its own
 * scoped page and total, so layout does not inherit another page's paint state.
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

/** Paint context; also the fallback for tokens measured outside a band. */
let currentPageNumber = 1;
let currentTotalPages = 1;

/** A band's measurement inputs, independent of the current paint context. */
let arrangement: { pageNumber: number; totalPages: number } | null = null;

/** Call before rendering a page to set the context for token strategies. */
export function setTokenContext(pageNumber: number, totalPages: number): void {
  currentPageNumber = pageNumber;
  currentTotalPages = totalPages;
}

/**
 * Measure a band's arrangement with both the page number and document total.
 * Nested measurements and failures restore the enclosing inputs. Painting
 * remains independent, even when measurement runs during live editing.
 */
export function arrangedForPage<T>(pageNumber: number, totalPages: number, arrange: () => T): T {
  const previous = arrangement;
  arrangement = { pageNumber, totalPages };
  try {
    return arrange();
  } finally {
    arrangement = previous;
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
      width: measureDigitWidth(digitsIn(arrangement?.pageNumber ?? currentTotalPages), font, measurer),
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
      width: measureDigitWidth(digitsIn(arrangement?.totalPages ?? currentTotalPages), font, measurer),
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
