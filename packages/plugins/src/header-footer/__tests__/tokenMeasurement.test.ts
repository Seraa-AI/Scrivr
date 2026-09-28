/**
 * How much room a header token reserves.
 *
 * A page-number token paints the page it is on, so a 428-page document paints
 * three glyphs where a one-page document paints one. The band has to reserve
 * the width those glyphs will take — get it wrong and a right-aligned header
 * sits in the wrong place and "Page 428 of 428" overlaps the text beside it.
 *
 * Deliberately no `vi.mock("@scrivr/core")` here: the real mini pipeline is
 * the thing under test. Measurement is stubbed instead, so a digit's width is
 * a number this file chose rather than whatever face the machine has.
 */

import { describe, it, expect } from "vitest";
import {
  ServerEditor,
  StarterKit,
  InlineRegistry,
  BlockRegistry,
  defaultEditorTheme,
  type FontModifier,
  type LayoutBlock,
  defaultFontConfig,
  runMiniPipeline,
  runPipeline,
  type PageLayoutOptions,
  type DocumentLayout,
  type LayoutIterationContext,
  type TextMeasurerLike,
} from "@scrivr/core";
import { drawPageChrome } from "../drawPageChrome";
import { HeaderFooterSurfaceCache } from "../surfaces";
import { HeaderFooter } from "../HeaderFooter";
import { resolveChrome, isResolvedHeaderFooter, slotLayoutForPage } from "../resolveChrome";
import {
  pageNumberStrategy,
  totalPagesStrategy,
  dateStrategy,
  setTokenContext,
} from "../tokenStrategies";
import type { Node } from "@scrivr/core/pm";
import type { HeaderFooterPolicy } from "../types";

const DIGIT_W = 10;
const OTHER_W = 6;

const widthOf = (text: string): number =>
  [...text].reduce((sum, ch) => sum + (ch >= "0" && ch <= "9" ? DIGIT_W : OTHER_W), 0);

const measurer: TextMeasurerLike = {
  measureWidth: widthOf,
  measureRun: (text) => ({
    totalWidth: widthOf(text),
    charPositions: [...text].map((_, i) => widthOf(text.slice(0, i))),
  }),
  getFontMetrics: () => ({ ascent: 8, descent: 2, lineHeight: 12, xHeight: 5 }),
  invalidate: () => {},
};

const registry = new InlineRegistry()
  .register("pageNumber", pageNumberStrategy)
  .register("totalPages", totalPagesStrategy)
  .register("date", dateStrategy);

const pageConfig = {
  pageWidth: 816,
  pageHeight: 1056,
  margins: { top: 96, bottom: 96, left: 96, right: 96 },
  pageless: false,
};

const { doc } = new ServerEditor({ extensions: [StarterKit, HeaderFooter] }).getState();

/** A header whose only content is the given inline nodes. */
function headerOf(...nodes: Array<Record<string, unknown>>): HeaderFooterPolicy {
  return {
    enabled: true,
    differentFirstPage: false,
    differentOddEven: false,
    defaultHeader: {
      content: { type: "doc", content: [{ type: "paragraph", content: nodes }] },
    },
  };
}

/** A LayoutIterationContext whose flow layout reports `pages` pages. */
function ctxWithPages(pages: number | null, which: "current" | "previousRun" = "current"): LayoutIterationContext {
  const layout: DocumentLayout | null = pages === null ? null : {
    pages: Array.from({ length: pages }, (_, i) => ({ pageNumber: i + 1, blocks: [] })),
    pageConfig,
    version: 1,
    totalContentHeight: 0,
  };
  return {
    runId: 1,
    iteration: 1,
    maxIterations: 5,
    previousIterationPayload: null,
    previousRunPayload: null,
    currentFlowLayout: which === "current" ? layout : null,
    previousRunFlowLayout: which === "previousRun" ? layout : null,
  };
}

function headerSpans(policy: HeaderFooterPolicy, ctx: LayoutIterationContext) {
  const contribution = resolveChrome(
    policy,
    { doc, pageConfig, measurer, fontConfig: defaultFontConfig, inlineRegistry: registry },
    ctx,
    0,
  );
  if (!isResolvedHeaderFooter(contribution.payload)) {
    throw new Error("resolveChrome returned a payload it does not own");
  }
  return (contribution.payload.slots.defaultHeader?.layout.pages[0]?.blocks ?? [])
    .flatMap((b) => b.lines)
    .flatMap((l) => l.spans)
    .filter((s) => s.kind === "object");
}

describe("the width a header token reserves", () => {
  it("fits one digit in a one-page document", () => {
    const spans = headerSpans(headerOf({ type: "pageNumber" }), ctxWithPages(1));

    expect(spans).toHaveLength(1);
    expect(spans[0]!.width).toBe(DIGIT_W);
  });

  it("fits three digits once the document runs to three", () => {
    const spans = headerSpans(headerOf({ type: "pageNumber" }), ctxWithPages(428));

    expect(spans[0]!.width).toBe(DIGIT_W * 3);
  });

  // Every one of these is a power of ten, where counting digits with
  // ceil(log10(n)) comes back one short: a ten-page document reserved a single
  // digit and painted two.
  it.each([
    [9, 1],
    [10, 2],
    [99, 2],
    [100, 3],
    [999, 3],
    [1000, 4],
  ])("reserves %i pages worth of digits (%i)", (pages, digits) => {
    const spans = headerSpans(headerOf({ type: "pageNumber" }), ctxWithPages(pages));

    expect(spans[0]!.width).toBe(DIGIT_W * digits);
  });

  it("fits the date it will actually print", () => {
    const frozen = "2026-09-25T00:00:00.000Z";
    const printed = new Date(frozen).toLocaleDateString();

    const spans = headerSpans(headerOf({ type: "date", attrs: { frozen } }), ctxWithPages(1));

    expect(spans[0]!.width).toBe(widthOf(printed));
  });

  it("does not inherit the page that was painted last", () => {
    // Paint writes the token context per page. A measurement that reads it
    // without setting it would size a header from whichever page happened to
    // be drawn most recently — different answer on a scroll than on a load.
    setTokenContext(428, 428);

    const spans = headerSpans(headerOf({ type: "pageNumber" }), ctxWithPages(1));

    expect(spans[0]!.width).toBe(DIGIT_W);
  });
});

describe("what the header reports about its own stability", () => {
  it("is unstable before this run's flow has produced a count", () => {
    const contribution = resolveChrome(
      headerOf({ type: "pageNumber" }),
      { doc, pageConfig, measurer, fontConfig: defaultFontConfig, inlineRegistry: registry },
      ctxWithPages(null),
      0,
    );

    expect(contribution.stable).toBe(false);
  });

  it("is stable once this run's flow has produced one", () => {
    const input = { doc, pageConfig, measurer, fontConfig: defaultFontConfig, inlineRegistry: registry };

    expect(resolveChrome(headerOf({ type: "pageNumber" }), input, ctxWithPages(9), 0).stable).toBe(true);
  });

  it("does not settle for a count remembered from the previous run", () => {
    // That count predates the edit being laid out, and while a document
    // streams in it belongs to a partial layout — a 428-page document whose
    // remembered count is 7 is the original bug, reached by another road.
    const input = { doc, pageConfig, measurer, fontConfig: defaultFontConfig, inlineRegistry: registry };

    const contribution = resolveChrome(
      headerOf({ type: "pageNumber" }), input, ctxWithPages(7, "previousRun"), 0,
    );

    expect(contribution.stable).toBe(false);
  });

  it("still measures against the remembered count while it has nothing better", () => {
    // Unstable does not mean unmeasured: iteration 1 has to reserve something,
    // and last run's count beats assuming one page.
    const spans = headerSpans(headerOf({ type: "pageNumber" }), ctxWithPages(99, "previousRun"));

    expect(spans[0]!.width).toBe(DIGIT_W * 2);
  });

  it("is stable on a first layout when nothing in the header counts pages", () => {
    const input = { doc, pageConfig, measurer, fontConfig: defaultFontConfig, inlineRegistry: registry };
    const dated = headerOf({ type: "date" }, { type: "text", text: " draft" });

    expect(resolveChrome(dated, input, ctxWithPages(null), 0).stable).toBe(true);
  });
});


describe("page-count feedback through pagination", () => {
  // 78px of text plus a 10px digit fits 90px. Two digits wrap the token,
  // increasing the band height and reducing how much body fits on each page.
  const policy = headerOf({ type: "text", text: "abcdefghijklm" }, { type: "pageNumber" });
  const options: PageLayoutOptions = {
    pageConfig: {
      ...pageConfig,
      pageWidth: 110,
      pageHeight: 150,
      margins: { top: 10, bottom: 10, left: 10, right: 10 },
    },
    measurer,
    inlineRegistry: registry,
    pageChromeContributions: [{
      name: "headerFooter",
      measure: (input, ctx) => resolveChrome(policy, input, ctx, 0),
      render: () => {},
    }],
  };
  const body = (count: number) => doc.type.schema.node("doc", null,
    Array.from({ length: count }, () => doc.type.schema.node("paragraph", null, [
      doc.type.schema.text("body"),
    ])),
  );

  function tokenWidth(layout: DocumentLayout): number | undefined {
    const payload = layout.chromePayloads?.["headerFooter"];
    if (!isResolvedHeaderFooter(payload)) throw new Error("Missing header layout");
    return payload.slots.defaultHeader?.layout.pages[0]?.blocks
      .flatMap((block) => block.lines).flatMap((line) => line.spans)
      .find((span) => span.kind === "object")?.width;
  }

  it("measures against the final count when wrapping crosses another digit boundary", () => {
    const layout = runPipeline(body(450), options);
    expect(layout.pages).toHaveLength(100);
    expect(tokenWidth(layout)).toBe(3 * DIGIT_W);
    expect(layout.convergence).toBe("stable");
    expect(layout.iterationCount).toBe(3);
  });

  it("streams the same body geometry as a full run when tokens wrap between chunks", () => {
    const d = body(100);
    const streamedOptions: PageLayoutOptions = { ...options, measureCache: new WeakMap(), maxBlocks: 40 };
    const first = runPipeline(d, streamedOptions);
    const snapshot = JSON.stringify(first);
    const second = runPipeline(d, {
      ...streamedOptions, previousLayout: first, resumption: first.resumption!,
    });
    expect(JSON.stringify(first)).toBe(snapshot);
    const blocks = second.pages.flatMap((page) => page.blocks);
    expect(blocks).toHaveLength(80);
    expect(new Set(blocks.map((block) => block.nodePos)).size).toBe(80);
    expect(second.resumption?.nextItemIndex).toBe(80);

    const final = runPipeline(d, {
      ...streamedOptions, previousLayout: second, resumption: second.resumption!,
    });
    const fresh = runPipeline(d, options);
    expect(final.isPartial).toBeUndefined();
    const positions = (layout: DocumentLayout) => layout.pages.flatMap((page) =>
      page.blocks.map((block) => [page.pageNumber, block.nodePos, block.y, block.height]),
    );
    expect(positions(final)).toEqual(positions(fresh));
    expect(final.metrics).toEqual(fresh.metrics);
    expect(final.pageStarts).toEqual(fresh.pageStarts);
    expect(tokenWidth(final)).toBe(tokenWidth(fresh));
  });
});


describe("a band that enters live editing", () => {
  it("keeps token typography and line geometry when a band enters live editing", () => {
    const policy = headerOf(
      { type: "text", text: "Page " },
      { type: "pageNumber", marks: [{ type: "bold" }] },
    );
    const modifier: FontModifier = (font) => { font.size = "40px"; };
    const fontModifiers = new Map([["bold", modifier]]);
    const contribution = resolveChrome(policy, {
      doc, pageConfig, measurer, fontConfig: defaultFontConfig,
      inlineRegistry: registry, fontModifiers,
    }, ctxWithPages(1), 0);
    if (!isResolvedHeaderFooter(contribution.payload)) throw new Error("Missing header layout");
    const resolved = contribution.payload;
    const slot = resolved.slots.defaultHeader!;
    const cache = new HeaderFooterSurfaceCache(doc.type.schema);
    const surface = cache.getOrCreate("defaultHeader", policy.defaultHeader!);
    const rendered: LayoutBlock[] = [];
    // Record blocks at the render boundary: this test compares geometry, so the
    // strategy never accesses the canvas or substitutes for the mini pipeline.
    const blockRegistry = new BlockRegistry().register("paragraph", {
      render: (block) => { rendered.push(block); return 0; },
    });
    drawPageChrome({
      ctx: {
        ctx: new Proxy({} as CanvasRenderingContext2D, { get() { throw new Error("Unexpected raster drawing"); } }),
        pageNumber: 1, totalPages: 1, pageConfig, payload: resolved,
        measurer, inlineRegistry: registry, blockRegistry, fontModifiers,
        theme: defaultEditorTheme,
        metrics: {
          pageNumber: 1, contentTop: 150, contentBottom: 900,
          contentHeight: 750, contentWidth: 624, headerTop: pageConfig.margins.top,
          headerHeight: slot.reservedHeight, footerTop: 900, footerHeight: 0,
        },
      },
      resolved, activeSurface: surface, activePage: 1,
    });
    const stored = slot.layout.pages[0]!.blocks;
    const token = stored.flatMap((block) => block.lines).flatMap((line) => line.spans)
      .find((span) => span.kind === "object");
    expect(token).toMatchObject({ height: 40, font: "40px Arial, sans-serif" });
    expect(rendered).toEqual(stored);
  });
});

/**
 * A token is measured in the font its own marks resolve to, so one that lands
 * bare in a header set in 10px is sized as 14px body text — a box wider than
 * the glyphs that fill it. `replaceSelectionWith` inherits the marks in force,
 * which is what keeps that from happening; this pins it.
 */
describe("inserting a token into formatted text", () => {
  it("gives it the marks already in force", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, HeaderFooter],
      content: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{
            type: "text",
            marks: [{ type: "fontSize", attrs: { size: 10 } }],
            text: "Page ",
          }],
        }],
      },
    });
    editor.commands.insertPageNumber();

    const token = findToken(editor.getState().doc);
    expect(token).toBeDefined();
    expect(token!.marks.map((m) => m.type.name)).toContain("fontSize");
  });
});

function findToken(node: Node): Node | undefined {
  let found: Node | undefined;
  node.descendants((child) => {
    if (child.type.name === "pageNumber") found = child;
    return found === undefined;
  });
  return found;
}

/**
 * A band is measured once and painted on every page, so without this the page
 * number's box holds the longest number in the document and page 2 of 1040
 * reads "Page 2" followed by three digits of nothing.
 */
describe("the box a page number gets on the page it is painted on", () => {
  const slotFor = (pages: number) => {
    const contribution = resolveChrome(
      headerOf({ type: "pageNumber" }, { type: "text", text: " of " }, { type: "totalPages" }),
      { doc, pageConfig, measurer, fontConfig: defaultFontConfig, inlineRegistry: registry },
      ctxWithPages(pages),
      0,
    );
    if (!isResolvedHeaderFooter(contribution.payload)) throw new Error("wrong payload");
    return contribution.payload.slots.defaultHeader!;
  };

  const pageNumberWidth = (layout: DocumentLayout) =>
    layout.pages[0]!.blocks
      .flatMap((b) => b.lines)
      .flatMap((l) => l.spans)
      .filter((sp) => sp.kind === "object")[0]!.width;

  it("fits one digit on page 2 of a thousand-page document", () => {
    const slot = slotFor(1040);

    expect(pageNumberWidth(slotLayoutForPage(slot, 2))).toBe(DIGIT_W);
    expect(pageNumberWidth(slotLayoutForPage(slot, 12))).toBe(DIGIT_W * 2);
    expect(pageNumberWidth(slotLayoutForPage(slot, 999))).toBe(DIGIT_W * 3);
    expect(pageNumberWidth(slotLayoutForPage(slot, 1040))).toBe(DIGIT_W * 4);
  });

  it("moves what follows the token, so the text closes up behind it", () => {
    const slot = slotFor(1040);
    const textX = (layout: DocumentLayout) =>
      layout.pages[0]!.blocks
        .flatMap((b) => b.lines)
        .flatMap((l) => l.spans)
        .find((sp) => sp.kind === "text")!.x;

    expect(textX(slotLayoutForPage(slot, 2)))
      .toBeLessThan(textX(slotLayoutForPage(slot, 1040)));
  });

  it("reserves the band against the widest arrangement", () => {
    // Height comes from the widest number, so a page whose number is shorter
    // can never need more room than the band already took.
    const slot = slotFor(1040);

    expect(pageNumberWidth(slot.layout)).toBe(DIGIT_W * 4);
  });

  it("falls back to the widest arrangement past the measured count", () => {
    // No page today numbers past the count — but section-restart numbering
    // would, and asking for an arrangement nobody measured must still paint.
    const slot = slotFor(9);

    expect(pageNumberWidth(slotLayoutForPage(slot, 4211))).toBe(pageNumberWidth(slot.layout));
  });
});

/**
 * Only a band is arranged per page. A token anywhere else is measured once for
 * the whole document and painted wherever it lands, so it has to reserve the
 * widest number the document can reach — and, crucially, the same width every
 * time. Sizing it from ambient paint state would make a body token's box depend
 * on which page was drawn last, so the same document would lay out differently
 * after a scroll.
 */
describe("a page-number token outside a band", () => {
  const bodySpans = () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, HeaderFooter],
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "pageNumber" }] }],
      },
    });
    return runMiniPipeline(editor.getState().doc, {
      pageConfig, measurer, inlineRegistry: registry,
    }).pages[0]!.blocks
      .flatMap((b) => b.lines)
      .flatMap((l) => l.spans)
      .filter((sp) => sp.kind === "object");
  };

  it("reserves the same width whichever page was painted last", () => {
    setTokenContext(7, 1040);
    const afterPage7 = bodySpans()[0]!.width;

    setTokenContext(1039, 1040);
    const afterPage1039 = bodySpans()[0]!.width;

    expect(afterPage7).toBe(afterPage1039);
  });

  it("reserves the widest the document can reach", () => {
    setTokenContext(2, 1040);

    expect(bodySpans()[0]!.width).toBe(DIGIT_W * 4);
  });
});

/**
 * A band holding only the total prints one string on every page, so arranging
 * it per page-number width would measure the same layout over and over.
 */
describe("a band that names only the total", () => {
  it("is arranged once", () => {
    const contribution = resolveChrome(
      headerOf({ type: "text", text: "of " }, { type: "totalPages" }),
      { doc, pageConfig, measurer, fontConfig: defaultFontConfig, inlineRegistry: registry },
      ctxWithPages(1040),
      0,
    );
    if (!isResolvedHeaderFooter(contribution.payload)) throw new Error("wrong payload");

    expect(contribution.payload.slots.defaultHeader!.byDigits).toBeUndefined();
  });
});
