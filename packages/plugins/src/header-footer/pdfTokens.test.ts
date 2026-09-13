/**
 * What a page-number, total-pages or date token draws in a PDF.
 *
 * These handlers had no coverage at all, so the export they produce could
 * change without anything noticing — including when they were moved onto the
 * drawing surface. They draw through `ctx.draw.text` in layout pixels now, so
 * what a test can hold them to is the op they emit.
 */

import { describe, it, expect } from "vitest";
import type { LayoutBlock, PdfTextOp } from "@scrivr/core";
import {
  renderPageNumberPdf,
  renderTotalPagesPdf,
  renderDatePdf,
} from "./pdfExport";
import { setTokenContext } from "./tokenStrategies";

/** A context that records what was asked for instead of drawing it. */
function recordingContext() {
  const ops: PdfTextOp[] = [];
  return {
    ops,
    ctx: {
      layout: { pages: [{ pageNumber: 1 }], pageConfig: { pageHeight: 792, margins: { top: 72, bottom: 72 } } },
      draw: {
        text: (op: PdfTextOp) => ops.push(op),
        line: () => {},
        rect: () => {},
        image: () => {},
        imagePlaceholder: () => {},
        lines: () => {},
      },
      x: 0,
      y: 0,
      width: 468,
    },
  };
}

const tokenBlock = (attrs: Record<string, unknown> = {}): LayoutBlock =>
  ({ x: 100, y: 40, width: 30, height: 12, node: { attrs } }) as unknown as LayoutBlock;

describe("token rendering in a PDF", () => {
  it("draws the page number where the block sits", () => {
    setTokenContext(3, 9);
    const { ops, ctx } = recordingContext();
    renderPageNumberPdf(tokenBlock(), ctx);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.text).toBe("3");
    // Layout pixels, and the baseline is the block's bottom — the surface
    // owns the conversion to points and the flip.
    expect(ops[0]!.x).toBe(100);
    expect(ops[0]!.baselineY).toBe(52);
    expect(ops[0]!.sizePx).toBe(10);
    expect(ops[0]!.color).toEqual({ r: 156, g: 163, b: 175 });
  });

  it("draws the total page count", () => {
    setTokenContext(3, 9);
    const { ops, ctx } = recordingContext();
    renderTotalPagesPdf(tokenBlock(), ctx);
    expect(ops[0]!.text).toBe("9");
  });

  it("draws a frozen date rather than today's", () => {
    const { ops, ctx } = recordingContext();
    renderDatePdf(tokenBlock({ frozen: "2020-06-15T00:00:00.000Z" }), ctx);
    expect(ops[0]!.text).toBe(new Date("2020-06-15T00:00:00.000Z").toLocaleDateString());
  });

  it("draws nothing when handed something that is not an export context", () => {
    const { ops } = recordingContext();
    renderPageNumberPdf(tokenBlock(), { nope: true });
    expect(ops).toHaveLength(0);
  });
});
