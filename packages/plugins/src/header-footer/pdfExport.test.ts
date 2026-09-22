import { describe, it, expect } from "vitest";
import type { DocumentLayout, LayoutBlock } from "@scrivr/core";
import { renderHeaderFooterPdf } from "./pdfExport";

/**
 * What the header/footer chrome handler draws, recorded before the format-lane
 * migration moves chrome onto the shared dispatch.
 *
 * This drives the handler with a recording stand-in rather than a real PDF
 * export: what is being characterized is which blocks it hands to the
 * pipeline, and at what position on the page — the two things routing chrome
 * through a different dispatch could silently change.
 */

interface DrawnBlock {
  blockType: string;
  x: number;
  y: number;
  width: number;
}

/**
 * The band hands whole blocks to the pipeline, so what a test can hold it to
 * is which blocks it dispatched and where — identified by `blockType`, which
 * a real block already carries.
 */
const bandBlock = (blockType: string, y: number): LayoutBlock =>
  ({ blockType, x: 72, y, width: 468, height: 20 }) as unknown as LayoutBlock;

/** A slot whose stored layout puts its block at the mini-pipeline's top margin. */
function slot(blockType: string, marginTop = 36) {
  return {
    layout: {
      pages: [{ pageNumber: 1, blocks: [bandBlock(blockType, marginTop)] }],
      pageConfig: { margins: { top: marginTop } },
    },
  };
}

function documentLayout(
  metrics: Array<{ headerTop: number; footerTop: number }>,
  pageCount: number,
): DocumentLayout {
  return {
    // `pages.length` is read to tell a `totalPages` token how many there are.
    pages: Array.from({ length: pageCount }, (_, i) => ({ pageNumber: i + 1, blocks: [] })),
    pageConfig: { pageWidth: 612, pageHeight: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 } },
    version: 1,
    totalContentHeight: pageCount * 792,
    metrics: metrics.map((m, i) => ({
      pageNumber: i + 1,
      contentTop: 72,
      contentBottom: 720,
      contentHeight: 648,
      contentWidth: 468,
      headerTop: m.headerTop,
      footerTop: m.footerTop,
      headerHeight: 0,
      footerHeight: 0,
    })),
  };
}

function recordingCtx(
  metrics: Array<{ headerTop: number; footerTop: number }>,
  pageCount = 2,
) {
  const drawn: DrawnBlock[] = [];
  const ctx = {
    layout: documentLayout(metrics, pageCount),
    // Stands in for the pipeline dispatch, which is what the band now calls
    // instead of painting anything itself.
    blocks(blocks: readonly LayoutBlock[]) {
      for (const b of blocks) {
        drawn.push({ blockType: b.blockType, x: b.x, y: b.y, width: b.width });
      }
    },
  };
  return { ctx, drawn };
}

const METRICS = [{ headerTop: 36, footerTop: 736 }, { headerTop: 36, footerTop: 736 }];

describe("header/footer PDF chrome — what it draws", () => {
  it("places the header band at headerTop and the footer at footerTop", () => {
    const { ctx, drawn } = recordingCtx(METRICS);
    renderHeaderFooterPdf(
      { pageNumber: 1 },
      {
        policy: { enabled: true, differentFirstPage: false, differentOddEven: false, defaultHeader: {}, defaultFooter: {} },
        slots: { defaultHeader: slot("HEAD"), defaultFooter: slot("FOOT") },
      },
      ctx,
    );

    // The stored layout holds each block at its own top margin; the handler
    // offsets it to the band's position on the real page.
    expect(drawn).toEqual([
      { blockType: "HEAD", x: 72, y: 36, width: 468 },
      { blockType: "FOOT", x: 72, y: 736, width: 468 },
    ]);
  });

  it("chooses the first-page slot on page 1 and the default after it", () => {
    const payload = {
      policy: {
        enabled: true,
        differentFirstPage: true,
        differentOddEven: false,
        defaultHeader: {},
        firstPageHeader: {},
      },
      slots: { defaultHeader: slot("DEFAULT"), firstPageHeader: slot("FIRST") },
    };

    const first = recordingCtx(METRICS);
    renderHeaderFooterPdf({ pageNumber: 1 }, payload, first.ctx);
    expect(first.drawn.map((d) => d.blockType)).toEqual(["FIRST"]);

    const second = recordingCtx(METRICS);
    renderHeaderFooterPdf({ pageNumber: 2 }, payload, second.ctx);
    expect(second.drawn.map((d) => d.blockType)).toEqual(["DEFAULT"]);
  });

  it("draws nothing when the page has no metrics", () => {
    const { ctx, drawn } = recordingCtx([]);
    renderHeaderFooterPdf(
      { pageNumber: 1 },
      {
        policy: { enabled: true, differentFirstPage: false, differentOddEven: false, defaultHeader: {} },
        slots: { defaultHeader: slot("HEAD") },
      },
      ctx,
    );
    expect(drawn).toEqual([]);
  });

  it("draws nothing for a slot the policy resolves to but the payload lacks", () => {
    const { ctx, drawn } = recordingCtx(METRICS);
    renderHeaderFooterPdf(
      { pageNumber: 1 },
      {
        policy: { enabled: true, differentFirstPage: false, differentOddEven: false, defaultHeader: {} },
        slots: {},
      },
      ctx,
    );
    expect(drawn).toEqual([]);
  });

  it("ignores a payload that is not a resolved header/footer", () => {
    const { ctx, drawn } = recordingCtx(METRICS);
    renderHeaderFooterPdf({ pageNumber: 1 }, { nothing: "useful" }, ctx);
    renderHeaderFooterPdf({ pageNumber: 1 }, undefined, ctx);
    expect(drawn).toEqual([]);
  });

  // The stored block is shared across every page that shows this band, so
  // offsetting it must not write the page's position back into the slot.
  it("does not mutate the stored slot layout", () => {
    const shared = slot("HEAD");
    const original = shared.layout.pages[0]!.blocks[0]!.y;
    const { ctx } = recordingCtx(METRICS);
    renderHeaderFooterPdf(
      { pageNumber: 1 },
      {
        policy: { enabled: true, differentFirstPage: false, differentOddEven: false, defaultHeader: {} },
        slots: { defaultHeader: shared },
      },
      ctx,
    );
    expect(shared.layout.pages[0]!.blocks[0]!.y).toBe(original);
  });
});

/**
 * A chrome band holds ordinary blocks, and a block is drawn by whichever
 * extension defines it. When this handler drew them itself, anything that is
 * not text rendered on the canvas and vanished from the PDF — a horizontal
 * rule in a header paints from its own handler, and nothing here called it.
 */
describe("header/footer PDF chrome — who draws a block", () => {
  it("hands every block to the pipeline's dispatch, whatever its type", () => {
    const { ctx, drawn } = recordingCtx(METRICS, 1);
    const band = {
      layout: {
        pages: [{ pageNumber: 1, blocks: [
          bandBlock("paragraph", 36),
          bandBlock("horizontalRule", 58),
        ] }],
        pageConfig: { margins: { top: 36 } },
      },
    };

    renderHeaderFooterPdf(
      { pageNumber: 1 },
      {
        policy: { enabled: true, differentFirstPage: false, differentOddEven: false, defaultHeader: {} },
        slots: { defaultHeader: band },
      },
      ctx,
    );

    expect(drawn.map((d) => d.blockType)).toEqual(["paragraph", "horizontalRule"]);
  });
});
