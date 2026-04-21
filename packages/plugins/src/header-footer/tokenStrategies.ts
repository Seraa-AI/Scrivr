/**
 * InlineStrategy implementations for header/footer token nodes.
 * Each token renders its actual value (page number, total pages, date)
 * instead of the placeholder text from the node spec.
 *
 * The current page context is set by drawPageChrome before rendering
 * and read by each strategy during render.
 */

import type { InlineStrategy } from "@scrivr/core";
import type { Node } from "prosemirror-model";

/** Current page context — set before rendering, read by token strategies. */
let currentPageNumber = 1;
let currentTotalPages = 1;

/** Call before rendering a page to set the context for token strategies. */
export function setTokenContext(pageNumber: number, totalPages: number): void {
  currentPageNumber = pageNumber;
  currentTotalPages = totalPages;
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
  // y is the top of the object box. With verticalAlign "baseline", the
  // object bottom sits on the text baseline. So y + height = baseline.
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y + height);
  ctx.restore();
}

export const pageNumberStrategy: InlineStrategy = {
  verticalAlign: "baseline",
  render(ctx: CanvasRenderingContext2D, x: number, y: number, _w: number, h: number) {
    drawTokenText(ctx, String(currentPageNumber), x, y, h);
  },
};

export const totalPagesStrategy: InlineStrategy = {
  verticalAlign: "baseline",
  render(ctx: CanvasRenderingContext2D, x: number, y: number, _w: number, h: number) {
    drawTokenText(ctx, String(currentTotalPages), x, y, h);
  },
};

export const dateStrategy: InlineStrategy = {
  verticalAlign: "baseline",
  render(ctx: CanvasRenderingContext2D, x: number, y: number, _w: number, h: number, node: Node) {
    const frozen = node.attrs["frozen"];
    const now = typeof frozen === "string" ? new Date(frozen) : new Date();
    drawTokenText(ctx, now.toLocaleDateString(), x, y, h);
  },
};
