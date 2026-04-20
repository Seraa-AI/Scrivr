/**
 * InlineStrategy implementations for header/footer token nodes.
 * Each token renders its actual value (page number, total pages, date)
 * instead of the placeholder text from the node spec.
 *
 * The current page context is set by drawPageChrome before rendering
 * and read by each strategy during render.
 */

import type { InlineStrategy } from "@scrivr/core";

/** Current page context — set before rendering, read by token strategies. */
let currentPageNumber = 1;
let currentTotalPages = 1;

/** Call before rendering a page to set the context for token strategies. */
export function setTokenContext(pageNumber: number, totalPages: number): void {
  currentPageNumber = pageNumber;
  currentTotalPages = totalPages;
}

export const pageNumberStrategy: InlineStrategy = {
  verticalAlign: "baseline",
  render(ctx, x, y, width, height, _node) {
    const text = String(currentPageNumber);
    ctx.save();
    ctx.fillStyle = "#9ca3af";
    ctx.font = "10px sans-serif";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, y + height);
    ctx.restore();
  },
};

export const totalPagesStrategy: InlineStrategy = {
  verticalAlign: "baseline",
  render(ctx, x, y, width, height, _node) {
    const text = String(currentTotalPages);
    ctx.save();
    ctx.fillStyle = "#9ca3af";
    ctx.font = "10px sans-serif";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, y + height);
    ctx.restore();
  },
};

export const dateStrategy: InlineStrategy = {
  verticalAlign: "baseline",
  render(ctx, x, y, width, height, node) {
    const frozen = node.attrs["frozen"];
    const format = node.attrs["format"] ?? "locale";
    let text: string;

    if (typeof frozen === "string") {
      text = new Date(frozen).toLocaleDateString();
    } else if (format === "locale") {
      text = new Date().toLocaleDateString();
    } else {
      text = new Date().toLocaleDateString();
    }

    ctx.save();
    ctx.fillStyle = "#9ca3af";
    ctx.font = "10px sans-serif";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, y + height);
    ctx.restore();
  },
};
