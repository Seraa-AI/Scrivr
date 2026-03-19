import { describe, it, expect, vi, beforeEach } from "vitest";
import { layoutDocument, defaultPageConfig, collapseMargins } from "./PageLayout";
import { TextMeasurer } from "./TextMeasurer";
import { schema } from "../model/schema";

const CHAR_WIDTH = 8;
const ASCENT = 12;
const DESCENT = 3;
// lineHeight = 18, contentHeight = 1123 - 72 - 72 = 979

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: vi.fn((text: string) => ({
      width: text.length * CHAR_WIDTH,
      actualBoundingBoxAscent: ASCENT,
      actualBoundingBoxDescent: DESCENT,
      fontBoundingBoxAscent: ASCENT,
      fontBoundingBoxDescent: DESCENT,
    })),
    font: "",
  } as unknown as CanvasRenderingContext2D);
});

function measurer() {
  return new TextMeasurer({ lineHeightMultiplier: 1.2 });
}

function doc(...blocks: ReturnType<typeof schema.node>[]) {
  return schema.node("doc", null, blocks);
}

function p(text = "") {
  return text
    ? schema.node("paragraph", null, [schema.text(text)])
    : schema.node("paragraph", null, []);
}

function h1(text: string) {
  return schema.node("heading", { level: 1 }, [schema.text(text)]);
}

function pageBreak() {
  return schema.node("page_break");
}

// ── Basic structure ───────────────────────────────────────────────────────────

describe("layoutDocument — basic", () => {
  it("returns at least one page for an empty doc", () => {
    const layout = layoutDocument(doc(p()), {
      pageConfig: defaultPageConfig,
      measurer: measurer(),
    });
    expect(layout.pages.length).toBeGreaterThanOrEqual(1);
  });

  it("places a short document on one page", () => {
    const layout = layoutDocument(doc(p("Hello world")), {
      pageConfig: defaultPageConfig,
      measurer: measurer(),
    });
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]?.blocks).toHaveLength(1);
  });

  it("increments the version from the previous version", () => {
    const layout = layoutDocument(doc(p()), {
      pageConfig: defaultPageConfig,
      measurer: measurer(),
      previousVersion: 5,
    });
    expect(layout.version).toBe(6);
  });

  it("block y coordinates are page-local (start from margins.top)", () => {
    const layout = layoutDocument(doc(p("Hello")), {
      pageConfig: defaultPageConfig,
      measurer: measurer(),
    });
    const block = layout.pages[0]!.blocks[0]!;
    // First block on page: no spaceBefore (paragraph), so y = margins.top
    expect(block.y).toBe(defaultPageConfig.margins.top);
  });

  it("exposes pageConfig on the layout result", () => {
    const layout = layoutDocument(doc(p()), {
      pageConfig: defaultPageConfig,
      measurer: measurer(),
    });
    expect(layout.pageConfig).toBe(defaultPageConfig);
  });
});

// ── Multiple blocks ───────────────────────────────────────────────────────────

describe("layoutDocument — multiple blocks", () => {
  it("stacks two paragraphs vertically", () => {
    const layout = layoutDocument(doc(p("First"), p("Second")), {
      pageConfig: defaultPageConfig,
      measurer: measurer(),
    });
    const blocks = layout.pages[0]!.blocks;
    expect(blocks).toHaveLength(2);
    // Second block must start below the first
    expect(blocks[1]!.y).toBeGreaterThan(blocks[0]!.y);
  });

  it("applies margin collapsing between heading and paragraph", () => {
    // h1: spaceAfter=12. paragraph: spaceBefore=0. collapsed gap = max(12,0) = 12
    const layout = layoutDocument(doc(h1("Title"), p("Body")), {
      pageConfig: defaultPageConfig,
      measurer: measurer(),
    });
    const [heading, para] = layout.pages[0]!.blocks;
    const gap = para!.y - (heading!.y + heading!.height);
    expect(gap).toBe(12);
  });
});

// ── Hard page break ───────────────────────────────────────────────────────────

describe("layoutDocument — page_break node", () => {
  it("forces content onto a new page", () => {
    const layout = layoutDocument(doc(p("Page 1"), pageBreak(), p("Page 2")), {
      pageConfig: defaultPageConfig,
      measurer: measurer(),
    });
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]!.blocks).toHaveLength(1);
    expect(layout.pages[1]!.blocks).toHaveLength(1);
  });

  it("resets y to margins.top on the new page", () => {
    const layout = layoutDocument(doc(p("A"), pageBreak(), p("B")), {
      pageConfig: defaultPageConfig,
      measurer: measurer(),
    });
    const blockOnPage2 = layout.pages[1]!.blocks[0]!;
    expect(blockOnPage2.y).toBe(defaultPageConfig.margins.top);
  });
});

// ── Soft page break (overflow) ────────────────────────────────────────────────

describe("layoutDocument — overflow", () => {
  it("overflows blocks to a new page when they exceed page height", () => {
    // Use a tiny page: 200px tall, margins 10px = 180px content height
    const tinyPage = {
      pageWidth: 400,
      pageHeight: 200,
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
    };

    // Each paragraph = 1 line = 18px. 180px / 18px = 10 paragraphs per page.
    // Create 12 paragraphs — should overflow to 2 pages.
    const blocks = Array.from({ length: 12 }, (_, i) => p(`Paragraph ${i + 1}`));
    const layout = layoutDocument(doc(...blocks), {
      pageConfig: tinyPage,
      measurer: measurer(),
    });

    expect(layout.pages.length).toBeGreaterThanOrEqual(2);
  });

  it("resets y to margins.top for overflowed blocks", () => {
    const tinyPage = {
      pageWidth: 400,
      pageHeight: 200,
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
    };
    const blocks = Array.from({ length: 15 }, () => p("Text"));
    const layout = layoutDocument(doc(...blocks), {
      pageConfig: tinyPage,
      measurer: measurer(),
    });

    // First block on page 2 should start at margins.top
    const firstBlockPage2 = layout.pages[1]?.blocks[0];
    expect(firstBlockPage2?.y).toBe(10); // margins.top
  });
});

// ── collapseMargins helper ────────────────────────────────────────────────────

describe("collapseMargins", () => {
  it("returns the larger of the two margins", () => {
    expect(collapseMargins(20, 10)).toBe(20);
    expect(collapseMargins(10, 20)).toBe(20);
  });

  it("returns the value when both are equal", () => {
    expect(collapseMargins(16, 16)).toBe(16);
  });

  it("returns 0 when both are 0", () => {
    expect(collapseMargins(0, 0)).toBe(0);
  });
});
