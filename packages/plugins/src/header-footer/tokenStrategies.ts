/**
 * InlineStrategy implementations for header/footer token nodes.
 * Each token renders its actual value (page number, total pages, date)
 * instead of the placeholder text from the node spec.
 *
 * The current page context is set by drawPageChrome before rendering
 * and read by each strategy during render.
 *
 * Each strategy implements measure() for dynamic width calculation during
 * layout. This uses the widest digit (max of 0-9) × digit count for numbers,
 * ensuring stable layout that doesn't thrash when page numbers change.
 */

import type { InlineStrategy, TextMeasurer } from "@scrivr/core";
import type { Node } from "prosemirror-model";

/** Current page context — set before rendering, read by token strategies. */
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
 * Measure the width of a digit string using the widest digit in the font.
 * Returns a stable width that doesn't change when "1" becomes "2" — only
 * when the digit count changes (e.g. page 9 → page 10).
 */
function measureDigitWidth(digitCount: number, font: string, measurer: TextMeasurer): number {
  let widest = 0;
  for (let d = 0; d <= 9; d++) {
    const run = measurer.measureRun(String(d), font);
    if (run.totalWidth > widest) widest = run.totalWidth;
  }
  return widest * digitCount;
}

function measureTextWidth(text: string, font: string, measurer: TextMeasurer): number {
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
    // Reserve width for up to 3 digits (covers 1-999 pages). Uses widest
    // digit so layout is stable across page number changes.
    const digits = Math.max(1, Math.ceil(Math.log10(Math.max(currentTotalPages, 2))));
    return {
      width: measureDigitWidth(Math.max(digits, 1), font, measurer),
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
    const digits = Math.max(1, Math.ceil(Math.log10(Math.max(currentTotalPages, 2))));
    return {
      width: measureDigitWidth(Math.max(digits, 1), font, measurer),
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
