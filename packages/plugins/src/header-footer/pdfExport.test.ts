import { describe, it, expect } from "vitest";
import { renderHeaderFooterPdf } from "./pdfExport";

/**
 * What the header/footer chrome handler draws, recorded before the format-lane
 * migration moves chrome onto the shared dispatch.
 *
 * The handler takes its context through a structural guard, so this drives it
 * with a recording stand-in rather than a real PDF export: what is being
 * characterized is which blocks it hands to `draw.lines`, and at what position
 * on the page — the two things routing chrome through a different dispatch
 * could silently change.
 */

interface DrawnBlock {
  y: number;
  ctxX: number;
  ctxY: number;
  ctxWidth: number;
  text: string;
}

function bandBlock(text: string, y: number) {
  return { x: 72, y, width: 468, height: 20, text };
}

/** A slot whose stored layout puts its block at the mini-pipeline's top margin. */
function slot(text: string, marginTop = 36) {
  return {
    layout: {
      pages: [{ pageNumber: 1, blocks: [bandBlock(text, marginTop)] }],
      pageConfig: { margins: { top: marginTop } },
    },
  };
}

function recordingCtx(
  metrics: Array<{ headerTop: number; footerTop: number }>,
  pageCount = 2,
) {
  const drawn: DrawnBlock[] = [];
  const ctx = {
    // `pages.length` is read to tell a `totalPages` token how many there are.
    layout: { metrics, pages: Array.from({ length: pageCount }, (_, i) => ({ pageNumber: i + 1 })) },
    x: 0,
    y: 0,
    width: 0,
    draw: {
      lines(blockArg: { y: number; text?: string }) {
        drawn.push({
          y: blockArg.y,
          ctxX: ctx.x,
          ctxY: ctx.y,
          ctxWidth: ctx.width,
          text: blockArg.text ?? "",
        });
      },
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
      { y: 36, ctxX: 72, ctxY: 36, ctxWidth: 468, text: "HEAD" },
      { y: 736, ctxX: 72, ctxY: 736, ctxWidth: 468, text: "FOOT" },
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
    expect(first.drawn.map((d) => d.text)).toEqual(["FIRST"]);

    const second = recordingCtx(METRICS);
    renderHeaderFooterPdf({ pageNumber: 2 }, payload, second.ctx);
    expect(second.drawn.map((d) => d.text)).toEqual(["DEFAULT"]);
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
