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
  defaultFontConfig,
  type DocumentLayout,
  type LayoutIterationContext,
  type TextMeasurerLike,
} from "@scrivr/core";
import { HeaderFooter } from "../HeaderFooter";
import { resolveChrome, type ResolvedHeaderFooter } from "../resolveChrome";
import {
  pageNumberStrategy,
  totalPagesStrategy,
  dateStrategy,
  setTokenContext,
} from "../tokenStrategies";
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
  const layout = pages === null
    ? null
    : ({ pages: Array.from({ length: pages }, (_, i) => ({ pageNumber: i + 1, blocks: [] })) } as unknown as DocumentLayout);
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
  const payload = contribution.payload as ResolvedHeaderFooter;
  return (payload.slots.defaultHeader?.layout.pages[0]?.blocks ?? [])
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
  it("is unstable on a first layout, where the page count is still a guess", () => {
    const contribution = resolveChrome(
      headerOf({ type: "pageNumber" }),
      { doc, pageConfig, measurer, fontConfig: defaultFontConfig, inlineRegistry: registry },
      ctxWithPages(null),
      0,
    );

    expect(contribution.stable).toBe(false);
  });

  it("is stable once a page count is known", () => {
    const input = { doc, pageConfig, measurer, fontConfig: defaultFontConfig, inlineRegistry: registry };

    expect(resolveChrome(headerOf({ type: "pageNumber" }), input, ctxWithPages(9), 0).stable).toBe(true);
    expect(
      resolveChrome(headerOf({ type: "pageNumber" }), input, ctxWithPages(9, "previousRun"), 0).stable,
    ).toBe(true);
  });

  it("is stable on a first layout when nothing in the header counts pages", () => {
    const input = { doc, pageConfig, measurer, fontConfig: defaultFontConfig, inlineRegistry: registry };
    const dated = headerOf({ type: "date" }, { type: "text", text: " draft" });

    expect(resolveChrome(dated, input, ctxWithPages(null), 0).stable).toBe(true);
  });
});
