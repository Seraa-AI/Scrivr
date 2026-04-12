import { describe, it, expect } from "vitest";
import {
  runPipeline,
  buildBlockFlow,
  paginateFlow,
  collectLayoutItems,
  defaultPageConfig,
  defaultPagelessConfig,
  collapseMargins,
} from "./PageLayout";
import type { MeasureCacheEntry, LayoutFragment } from "./PageLayout";
import { computePageMetrics, EMPTY_RESOLVED_CHROME, type PageMetrics } from "./PageMetrics";
import { defaultFontConfig, applyPageFont } from "./FontConfig";
import { buildStarterKitContext, createMeasurer, paragraph as p, heading, doc, pageBreak, MOCK_LINE_HEIGHT } from "../test-utils";

// lineHeight = 18, contentHeight = 1123 - 72 - 72 = 979


function h1(text: string) {
  return heading(1, text);
}

// ── Basic structure ───────────────────────────────────────────────────────────

describe("runPipeline — basic", () => {
  it("returns at least one page for an empty doc", () => {
    const layout = runPipeline(doc(p()), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    expect(layout.pages.length).toBeGreaterThanOrEqual(1);
  });

  it("places a short document on one page", () => {
    const layout = runPipeline(doc(p("Hello world")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]?.blocks).toHaveLength(1);
  });

  it("increments the version from the previous version", () => {
    const layout = runPipeline(doc(p()), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      previousVersion: 5,
    });
    expect(layout.version).toBe(6);
  });

  it("block y coordinates are page-local (start from margins.top)", () => {
    const layout = runPipeline(doc(p("Hello")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    const block = layout.pages[0]!.blocks[0]!;
    // First block on page: no spaceBefore (paragraph), so y = margins.top
    expect(block.y).toBe(defaultPageConfig.margins.top);
  });

  it("exposes pageConfig on the layout result", () => {
    const layout = runPipeline(doc(p()), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    expect(layout.pageConfig).toBe(defaultPageConfig);
  });
});

// ── Multiple blocks ───────────────────────────────────────────────────────────

describe("runPipeline — multiple blocks", () => {
  it("stacks two paragraphs vertically", () => {
    const layout = runPipeline(doc(p("First"), p("Second")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    const blocks = layout.pages[0]!.blocks;
    expect(blocks).toHaveLength(2);
    // Second block must start below the first
    expect(blocks[1]!.y).toBeGreaterThan(blocks[0]!.y);
  });

  it("applies margin collapsing between heading and paragraph", () => {
    // h1: spaceAfter=12. paragraph: spaceBefore=0. collapsed gap = max(12,0) = 12
    const layout = runPipeline(doc(h1("Title"), p("Body")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    const [heading, para] = layout.pages[0]!.blocks;
    const gap = para!.y - (heading!.y + heading!.height);
    expect(gap).toBe(12);
  });
});

// ── Hard page break ───────────────────────────────────────────────────────────

describe("runPipeline — page_break node", () => {
  it("forces content onto a new page", () => {
    const layout = runPipeline(doc(p("Page 1"), pageBreak(), p("Page 2")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]!.blocks).toHaveLength(1);
    expect(layout.pages[1]!.blocks).toHaveLength(1);
  });

  it("resets y to margins.top on the new page", () => {
    const layout = runPipeline(doc(p("A"), pageBreak(), p("B")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    const blockOnPage2 = layout.pages[1]!.blocks[0]!;
    expect(blockOnPage2.y).toBe(defaultPageConfig.margins.top);
  });
});

// ── Soft page break (overflow) ────────────────────────────────────────────────

describe("runPipeline — overflow", () => {
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
    const layout = runPipeline(doc(...blocks), {
      pageConfig: tinyPage,
      measurer: createMeasurer(),
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
    const layout = runPipeline(doc(...blocks), {
      pageConfig: tinyPage,
      measurer: createMeasurer(),
    });

    // First block on page 2 should start at margins.top
    const firstBlockPage2 = layout.pages[1]?.blocks[0];
    expect(firstBlockPage2?.y).toBe(10); // margins.top
  });
});

// ── Horizontal rule ───────────────────────────────────────────────────────────

describe("runPipeline — horizontal rule", () => {
  const { schema: fullSchema, fontConfig: fullFontConfig } = buildStarterKitContext();

  function hr() {
    return fullSchema.nodes["horizontalRule"]!.create();
  }

  function fullDoc(...blocks: ReturnType<typeof fullSchema.node>[]) {
    return fullSchema.node("doc", null, blocks);
  }

  function fullP(text = "") {
    return text
      ? fullSchema.node("paragraph", null, [fullSchema.text(text)])
      : fullSchema.node("paragraph", null, []);
  }

  // HR block style: font "8px Georgia, serif" → height = Math.round(8 × 1.5) = 12
  // spaceBefore = 24, spaceAfter = 24
  const HR_HEIGHT = 12;
  const HR_SPACE  = 24;

  it("HR block has correct height (derived from 8px font)", () => {
    const layout = runPipeline(fullDoc(hr()), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      fontConfig: fullFontConfig,
    });
    const block = layout.pages[0]!.blocks[0]!;
    expect(block.height).toBe(HR_HEIGHT);
  });

  it("HR is positioned at margins.top when it is the first block", () => {
    const layout = runPipeline(fullDoc(hr()), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      fontConfig: fullFontConfig,
    });
    const block = layout.pages[0]!.blocks[0]!;
    expect(block.y).toBe(defaultPageConfig.margins.top);
  });

  it("paragraph before HR: HR y accounts for para height and collapsed margin", () => {
    // para: spaceAfter=10.  HR: spaceBefore=24.  collapsed gap = max(10, 24) = 24
    const layout = runPipeline(fullDoc(fullP("Hello"), hr()), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      fontConfig: fullFontConfig,
    });
    const [para, hrBlock] = layout.pages[0]!.blocks;
    const expectedGap = Math.max(10, HR_SPACE); // 16
    expect(hrBlock!.y).toBe(para!.y + para!.height + expectedGap);
  });

  it("HR before paragraph: para y accounts for HR height and collapsed margin", () => {
    // HR: spaceAfter=24.  para: spaceBefore=0.  collapsed gap = max(24, 0) = 24
    const layout = runPipeline(fullDoc(hr(), fullP("Hello")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      fontConfig: fullFontConfig,
    });
    const [hrBlock, para] = layout.pages[0]!.blocks;
    const expectedGap = Math.max(HR_SPACE, 0); // 16
    expect(para!.y).toBe(hrBlock!.y + HR_HEIGHT + expectedGap);
  });

  it("HR block lines is empty (leaf node — no inline content)", () => {
    const layout = runPipeline(fullDoc(hr()), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      fontConfig: fullFontConfig,
    });
    const block = layout.pages[0]!.blocks[0]!;
    expect(block.lines).toHaveLength(0);
  });
});

// ── List item spacing ─────────────────────────────────────────────────────────

describe("runPipeline — list item spacing", () => {
  const { schema: fullSchema, fontConfig: fullFontConfig } = buildStarterKitContext();

  function bulletList(...items: string[]) {
    const listItems = items.map((text) =>
      fullSchema.nodes["listItem"]!.create(null, [
        fullSchema.node("paragraph", null, text ? [fullSchema.text(text)] : []),
      ])
    );
    return fullSchema.nodes["bulletList"]!.create(null, listItems);
  }

  function fullDoc(...blocks: ReturnType<typeof fullSchema.node>[]) {
    return fullSchema.node("doc", null, blocks);
  }

  function fullP(text = "") {
    return text
      ? fullSchema.node("paragraph", null, [fullSchema.text(text)])
      : fullSchema.node("paragraph", null, []);
  }

  // list_item block style: spaceAfter=4 (vs paragraph spaceAfter=10)
  // spaceBefore=0 for both, so collapsed gap between two list items = max(4,0) = 4
  it("gap between two list items uses list_item spaceAfter (4), not paragraph spaceAfter (10)", () => {
    const layout = runPipeline(fullDoc(bulletList("First item", "Second item")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      fontConfig: fullFontConfig,
    });
    const [first, second] = layout.pages[0]!.blocks;
    const gap = second!.y - (first!.y + first!.height);
    // list_item: spaceAfter=4, spaceBefore=0 → collapsed = 4
    expect(gap).toBe(4);
  });

  it("gap after last list item before a paragraph uses list_item spaceAfter (4)", () => {
    // list_item spaceAfter=4, paragraph spaceBefore=0 → collapsed = 4
    const layout = runPipeline(fullDoc(bulletList("Only item"), fullP("After")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      fontConfig: fullFontConfig,
    });
    const [listBlock, paraBlock] = layout.pages[0]!.blocks;
    const gap = paraBlock!.y - (listBlock!.y + listBlock!.height);
    expect(gap).toBe(4);
  });
});

// ── measureCache ─────────────────────────────────────────────────────────────

describe("runPipeline — measureCache", () => {
  it("produces identical layout output when a cache is provided", () => {
    const cache = new WeakMap<object, MeasureCacheEntry>();
    const baseDoc = doc(p("Hello"), p("World"));
    const opts = { pageConfig: defaultPageConfig, measurer: createMeasurer() };

    const withoutCache = runPipeline(baseDoc, opts);
    const withCache    = runPipeline(baseDoc, { ...opts, measureCache: cache });

    expect(withCache.pages).toHaveLength(withoutCache.pages.length);
    for (let pi = 0; pi < withoutCache.pages.length; pi++) {
      const blocksA = withoutCache.pages[pi]!.blocks;
      const blocksB = withCache.pages[pi]!.blocks;
      expect(blocksB).toHaveLength(blocksA.length);
      for (let bi = 0; bi < blocksA.length; bi++) {
        expect(blocksB[bi]!.height).toBe(blocksA[bi]!.height);
        expect(blocksB[bi]!.y).toBe(blocksA[bi]!.y);
        expect(blocksB[bi]!.x).toBe(blocksA[bi]!.x);
      }
    }
  });

  it("populates the cache after the first layout run", () => {
    const cache = new WeakMap<object, MeasureCacheEntry>();
    const para = p("Cached paragraph");
    const testDoc = doc(para);
    runPipeline(testDoc, { pageConfig: defaultPageConfig, measurer: createMeasurer(), measureCache: cache });
    // The inner paragraph node is the cache key
    const innerNode = testDoc.firstChild!;
    expect(cache.has(innerNode)).toBe(true);
    const entry = cache.get(innerNode)!;
    expect(entry.height).toBeGreaterThan(0);
    expect(entry.availableWidth).toBe(defaultPageConfig.pageWidth - defaultPageConfig.margins.left - defaultPageConfig.margins.right);
  });

  it("uses cached height — manually stale entry is reflected in layout y positions", () => {
    // This test verifies the cache is actually consulted (not just populated).
    // We manually inject a fake cache entry with a doubled height and confirm
    // the second block's y-position shifts accordingly.
    const cache = new WeakMap<object, MeasureCacheEntry>();
    const firstPara = p("First paragraph");
    const secondPara = p("Second paragraph");
    const testDoc = doc(firstPara, secondPara);
    const measurer = createMeasurer();
    const opts = { pageConfig: defaultPageConfig, measurer, measureCache: cache };

    // First run — establishes true layout
    const trueLayout = runPipeline(testDoc, opts);
    const trueFirstHeight = trueLayout.pages[0]!.blocks[0]!.height;
    const trueSecondY     = trueLayout.pages[0]!.blocks[1]!.y;

    // Corrupt the first paragraph's cache entry — double the height
    const firstNode = testDoc.firstChild!;
    const realEntry = cache.get(firstNode)!;
    cache.set(firstNode, { ...realEntry, height: realEntry.height * 2 });

    // Second run with same doc — the first block should use the inflated height
    const cachedLayout = runPipeline(testDoc, opts);
    const cachedFirstHeight = cachedLayout.pages[0]!.blocks[0]!.height;
    const cachedSecondY     = cachedLayout.pages[0]!.blocks[1]!.y;

    // Cache hit: first block height is now doubled
    expect(cachedFirstHeight).toBe(trueFirstHeight * 2);
    // Second block was pushed down by the extra height
    expect(cachedSecondY).toBeGreaterThan(trueSecondY);
  });

  it("adjusts span docPos when a block shifts due to content inserted before it", () => {
    // Simulates ProseMirror structural sharing: the second paragraph Node keeps
    // the same JS object reference even after text is inserted into the first
    // paragraph (shifting the second paragraph's absolute nodePos). Without the
    // fix, cached span.docPos values would be stale (off by the insertion delta).
    const para2 = p("Second");
    const doc1 = doc(p("A"),       para2); // para2.nodePos = 3  (p("A").nodeSize = 3)
    const doc2 = doc(p("AAAAAAA"), para2); // para2.nodePos = 9  (p("AAAAAAA").nodeSize = 9)

    const cache = new WeakMap<object, MeasureCacheEntry>();
    const measurer = createMeasurer();
    const opts = { pageConfig: defaultPageConfig, measurer, measureCache: cache };

    // First layout — populates the cache for para2 with nodePos=3
    const layout1 = runPipeline(doc1, opts);
    const block2_1 = layout1.pages[0]!.blocks[1]!;
    expect(block2_1.lines[0]!.spans[0]!.docPos).toBe(block2_1.nodePos + 1);

    // Second layout — para2 is the same Node object (structural sharing) but its
    // nodePos has shifted by 6 (from 3 to 9). The cache must return adjusted docPos.
    const layout2 = runPipeline(doc2, opts);
    const block2_2 = layout2.pages[0]!.blocks[1]!;
    expect(block2_2.nodePos).toBeGreaterThan(block2_1.nodePos);
    expect(block2_2.lines[0]!.spans[0]!.docPos).toBe(block2_2.nodePos + 1);
  });

  it("re-measures when availableWidth changes (margin change)", () => {
    const cache = new WeakMap<object, MeasureCacheEntry>();
    const testDoc = doc(p("Text"));
    const measurer = createMeasurer();
    const narrow = { pageWidth: 400, pageHeight: 800, margins: { top: 20, right: 20, bottom: 20, left: 20 } };
    const wide   = { pageWidth: 700, pageHeight: 800, margins: { top: 20, right: 20, bottom: 20, left: 20 } };

    const layoutNarrow = runPipeline(testDoc, { pageConfig: narrow, measurer, measureCache: cache });
    const layoutWide   = runPipeline(testDoc, { pageConfig: wide,   measurer, measureCache: cache });

    // Both runs should succeed and the cached entry should reflect the wide config
    expect(layoutNarrow.pages[0]!.blocks[0]!.availableWidth).toBe(360); // 400 - 20 - 20
    expect(layoutWide.pages[0]!.blocks[0]!.availableWidth).toBe(660);   // 700 - 20 - 20
  });
});

// ── Phase 1b: early termination ───────────────────────────────────────────────

describe("runPipeline — Phase 1b early termination", () => {
  it("returns the correct layout when early termination fires on second layout run", () => {
    // Three paragraphs. Edit the first one — the second and third are structurally
    // shared and should be copied from previousLayout without re-looping.
    const para2 = p("Second");
    const para3 = p("Third");
    const doc1 = doc(p("A"),       para2, para3);
    const doc2 = doc(p("AAAAAAA"), para2, para3);

    const cache = new WeakMap<object, MeasureCacheEntry>();
    const measurer = createMeasurer();
    const opts = { pageConfig: defaultPageConfig, measurer, measureCache: cache };

    // First layout — warm up the cache AND record placedTargetY/placedPage.
    const layout1 = runPipeline(doc1, opts);

    // Second layout — para2 and para3 are same Node objects; second layout
    // should copy from layout1 via early termination.
    const layout2 = runPipeline(doc2, { ...opts, previousLayout: layout1 });

    // Both layouts should have the same number of pages and blocks.
    expect(layout2.pages.length).toBe(layout1.pages.length);
    const blocks2 = layout2.pages[0]!.blocks;
    const blocks1 = layout1.pages[0]!.blocks;
    expect(blocks2).toHaveLength(blocks1.length);

    // Block positions should be identical (editing first para doesn't shift others vertically).
    expect(blocks2[1]!.y).toBe(blocks1[1]!.y);
    expect(blocks2[2]!.y).toBe(blocks1[2]!.y);
  });

  it("corrects span docPos for blocks copied via early termination when delta !== 0", () => {
    // Insert text before para2 so its nodePos shifts, then verify span.docPos
    // in the copied blocks reflects the new absolute positions.
    const para2 = p("Second");
    const para3 = p("Third");
    const doc1 = doc(p("A"),       para2, para3);
    const doc2 = doc(p("AAAAAAA"), para2, para3);

    const cache = new WeakMap<object, MeasureCacheEntry>();
    const measurer = createMeasurer();
    const opts = { pageConfig: defaultPageConfig, measurer, measureCache: cache };

    const layout1 = runPipeline(doc1, opts);
    const layout2 = runPipeline(doc2, { ...opts, previousLayout: layout1 });

    const block2_1 = layout1.pages[0]!.blocks[1]!;
    const block2_2 = layout2.pages[0]!.blocks[1]!;
    const block3_2 = layout2.pages[0]!.blocks[2]!;

    // nodePos shifted for both para2 and para3
    expect(block2_2.nodePos).toBeGreaterThan(block2_1.nodePos);

    // span.docPos must be anchored to the new absolute positions
    expect(block2_2.lines[0]!.spans[0]!.docPos).toBe(block2_2.nodePos + 1);
    expect(block3_2.lines[0]!.spans[0]!.docPos).toBe(block3_2.nodePos + 1);
  });
});

// ── Streaming layout (maxBlocks) ──────────────────────────────────────────────

describe("runPipeline — maxBlocks / streaming", () => {
  it("returns isPartial:true when maxBlocks is smaller than the block count", () => {
    const testDoc = doc(p("A"), p("B"), p("C"), p("D"), p("E"));
    const layout = runPipeline(testDoc, {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      maxBlocks: 2,
    });
    expect(layout.isPartial).toBe(true);
    // Only the first 2 blocks were laid out
    const blockCount = layout.pages.reduce((n, pg) => n + pg.blocks.length, 0);
    expect(blockCount).toBe(2);
  });

  it("returns isPartial:false (undefined) when maxBlocks >= block count", () => {
    const testDoc = doc(p("A"), p("B"));
    const layout = runPipeline(testDoc, {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      maxBlocks: 100,
    });
    expect(layout.isPartial).toBeUndefined();
  });

  it("partial + full layout produce identical block positions", () => {
    const blocks = Array.from({ length: 10 }, (_, i) => p(`Paragraph ${i + 1}`));
    const testDoc = doc(...blocks);
    const measurer = createMeasurer();
    const cache = new WeakMap<object, MeasureCacheEntry>();
    const opts = { pageConfig: defaultPageConfig, measurer, measureCache: cache };

    // Partial layout: first 5 blocks
    const partial = runPipeline(testDoc, { ...opts, maxBlocks: 5 });
    expect(partial.isPartial).toBe(true);

    // Full layout with warm cache (simulates idle callback completion)
    const full = runPipeline(testDoc, opts);
    expect(full.isPartial).toBeUndefined();

    // All blocks in the full layout should have the same y/height as a fresh
    // layout without any cache (positions don't depend on measurement order)
    const freshFull = runPipeline(testDoc, { pageConfig: defaultPageConfig, measurer: createMeasurer() });
    expect(full.pages[0]!.blocks).toHaveLength(freshFull.pages[0]!.blocks.length);
    for (let i = 0; i < freshFull.pages[0]!.blocks.length; i++) {
      expect(full.pages[0]!.blocks[i]!.y).toBe(freshFull.pages[0]!.blocks[i]!.y);
      expect(full.pages[0]!.blocks[i]!.height).toBe(freshFull.pages[0]!.blocks[i]!.height);
    }
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

// ── applyPageFont ─────────────────────────────────────────────────────────────

describe("applyPageFont", () => {
  it("replaces the family in every block style", () => {
    const { fontConfig } = buildStarterKitContext();
    const result = applyPageFont(fontConfig, "Inter");
    expect(result["paragraph"]?.font).toContain("Inter");
    expect(result["heading_1"]?.font).toContain("Inter");
    expect(result["heading_2"]?.font).toContain("Inter");
  });

  it("preserves paragraph size after family substitution", () => {
    const { fontConfig } = buildStarterKitContext();
    const result = applyPageFont(fontConfig, "Arial");
    expect(result["paragraph"]?.font).toContain("14px");
    expect(result["paragraph"]?.font).not.toContain("Georgia");
  });

  it("preserves heading size and weight after family substitution", () => {
    const { fontConfig } = buildStarterKitContext();
    const result = applyPageFont(fontConfig, "Verdana");
    expect(result["heading_1"]?.font).toContain("28px");
    expect(result["heading_1"]?.font).toContain("bold");
    expect(result["heading_1"]?.font).toContain("Verdana");
  });

  it("preserves spaceBefore, spaceAfter, and align", () => {
    const { fontConfig } = buildStarterKitContext();
    const original = fontConfig["heading_1"]!;
    const result = applyPageFont(fontConfig, "Arial");
    expect(result["heading_1"]?.spaceBefore).toBe(original.spaceBefore);
    expect(result["heading_1"]?.spaceAfter).toBe(original.spaceAfter);
    expect(result["heading_1"]?.align).toBe(original.align);
  });
});

// ── pageConfig.fontFamily end-to-end ─────────────────────────────────────────

// ── Line-level page splitting ─────────────────────────────────────────────────
//
// Page geometry used throughout this section:
//   pageWidth  = 120   → contentWidth  = 100px (120 − 2×10 margins)
//   pageHeight = 74    → contentHeight = 54px  (74 − 2×10 margins) = 3 × MOCK_LINE_HEIGHT
//   pageBottom = margins.top + contentHeight   = 10 + 54 = 64px
//
// Text wrapping: at contentWidth=100px and MOCK_CHAR_WIDTH=8px, a 9-char word
// (72px) fits alone but never alongside another (144px > 100px). So
// "aaaaaaaaa bbbbbbbbb ..." reliably produces one line per word.
//
// Block layout with a 1-line "intro" paragraph before the tall block:
//   intro y=10, height=18, spaceAfter=10
//   tall block: gap=10, targetY=38, spaceAvailable=64-38=26px → 1 line fits (18px)
//   → part 1 (1 line) on page 1; remaining lines carried to subsequent pages
//
describe("runPipeline — line splitting", () => {
  const LH = MOCK_LINE_HEIGHT; // 18px

  const splitPage = {
    pageWidth:  120,
    pageHeight: Math.round(10 + 3 * LH + 10), // 74px: 3 lines + 10px margins each side
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
  };

  const fourLineText = "aaaaaaaaa bbbbbbbbb ccccccccc ddddddddd"; // 4 × 9-char words → 4 lines
  const sixLineText  = "aaaaaaaaa bbbbbbbbb ccccccccc ddddddddd eeeeeeeee fffffffff"; // 6 lines

  it("splits a tall paragraph across two pages at the correct line boundary", () => {
    const layout = runPipeline(doc(p("intro"), p(fourLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });

    expect(layout.pages).toHaveLength(2);

    // Page 1: intro + first split part (1 line)
    expect(layout.pages[0]!.blocks).toHaveLength(2);
    const part1 = layout.pages[0]!.blocks[1]!;
    expect(part1.lines).toHaveLength(1);
    expect(part1.continuesOnNextPage).toBe(true);
    expect(part1.isContinuation).toBeUndefined();

    // Page 2: continuation (remaining 3 lines)
    expect(layout.pages[1]!.blocks).toHaveLength(1);
    const part2 = layout.pages[1]!.blocks[0]!;
    expect(part2.lines).toHaveLength(3);
    expect(part2.isContinuation).toBe(true);
    expect(part2.continuesOnNextPage).toBeUndefined();
  });

  it("lines are conserved — total across all parts equals the full line count", () => {
    const layout = runPipeline(doc(p("intro"), p(fourLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });
    const part1 = layout.pages[0]!.blocks[1]!;
    const part2 = layout.pages[1]!.blocks[0]!;
    expect(part1.lines.length + part2.lines.length).toBe(4);
  });

  it("both parts reference the same ProseMirror node and nodePos", () => {
    const layout = runPipeline(doc(p("intro"), p(fourLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });
    const part1 = layout.pages[0]!.blocks[1]!;
    const part2 = layout.pages[1]!.blocks[0]!;
    expect(part1.node).toBe(part2.node);   // same JS object reference
    expect(part1.nodePos).toBe(part2.nodePos);
  });

  it("continuation part starts at margins.top with spaceBefore = 0", () => {
    const layout = runPipeline(doc(p("intro"), p(fourLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });
    const cont = layout.pages[1]!.blocks[0]!;
    expect(cont.y).toBe(splitPage.margins.top);
    expect(cont.spaceBefore).toBe(0);
  });

  it("non-last split parts have spaceAfter = 0; last part has the block's natural spaceAfter", () => {
    const layout = runPipeline(doc(p("intro"), p(fourLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });
    const part1 = layout.pages[0]!.blocks[1]!;
    const part2 = layout.pages[1]!.blocks[0]!;
    expect(part1.spaceAfter).toBe(0);
    expect(part2.spaceAfter).toBeGreaterThan(0); // paragraph's natural spaceAfter
  });

  it("splits a block across three pages when it has enough lines", () => {
    // sixLineText → 6 lines; splitPage fits 3 lines per page content area.
    // Page 1: intro + 1 line (26px available after gap)
    // Page 2: 3 lines (54px available, 3 × 18 = 54 ≤ 54)
    // Page 3: 2 remaining lines
    const layout = runPipeline(doc(p("intro"), p(sixLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });

    expect(layout.pages).toHaveLength(3);

    const p1part = layout.pages[0]!.blocks[1]!;
    const p2part = layout.pages[1]!.blocks[0]!;
    const p3part = layout.pages[2]!.blocks[0]!;

    // Line counts
    expect(p1part.lines).toHaveLength(1);
    expect(p2part.lines).toHaveLength(3);
    expect(p3part.lines).toHaveLength(2);

    // Flag consistency
    expect(p1part.continuesOnNextPage).toBe(true);
    expect(p2part.isContinuation).toBe(true);
    expect(p2part.continuesOnNextPage).toBe(true);  // middle part
    expect(p3part.isContinuation).toBe(true);
    expect(p3part.continuesOnNextPage).toBeUndefined(); // last part

    // Total lines conserved
    expect(p1part.lines.length + p2part.lines.length + p3part.lines.length).toBe(6);
  });

  it("block after the split is placed after the last continuation part", () => {
    // The continuation on page 2 fills the entire content area (3 lines × 18 = 54px).
    // The "after" paragraph can't fit on page 2 and overflows to page 3.
    // Key property: it starts at margins.top — not at an incorrect overlapping y.
    const layout = runPipeline(doc(p("intro"), p(fourLineText), p("after")), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });

    // "after" ends up on page 3 (page 2 is exactly full from the continuation)
    expect(layout.pages.length).toBeGreaterThanOrEqual(3);
    const afterBlock = layout.pages[2]!.blocks[0]!;
    expect(afterBlock.y).toBe(splitPage.margins.top);
  });
});

// ── Line splitting when the text block is first on its page ──────────────────
//
// Regression tests for the bug where the !isFirstOnPage guard prevented text
// blocks from splitting when they were the first block on a page. The fix:
//   overflows = blockBottom > pageBottom && (!isFirstOnPage || entry.lines.length > 0)
//
// Same splitPage geometry as the suite above (3 lines per page).
describe("runPipeline — line splitting (first on page)", () => {
  const LH = MOCK_LINE_HEIGHT; // 18px

  const splitPage = {
    pageWidth:  120,
    pageHeight: Math.round(10 + 3 * LH + 10), // 74px: 3 lines + 10px margins each side
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
  };

  const sixLineText  = "aaaaaaaaa bbbbbbbbb ccccccccc ddddddddd eeeeeeeee fffffffff";
  const nineLineText = "aaaaaaaaa bbbbbbbbb ccccccccc ddddddddd eeeeeeeee fffffffff ggggggggg hhhhhhhhh iiiiiiiii";

  it("splits a paragraph that is the first and only block on page 1 across two pages", () => {
    // No preceding block — isFirstOnPage is true. The paragraph (6 lines × 18px = 108px)
    // overflows contentHeight (54px) and must split: 3 lines on page 1, 3 on page 2.
    const layout = runPipeline(doc(p(sixLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });

    expect(layout.pages).toHaveLength(2);

    const part1 = layout.pages[0]!.blocks[0]!;
    expect(part1.lines).toHaveLength(3);
    expect(part1.continuesOnNextPage).toBe(true);
    expect(part1.isContinuation).toBeUndefined();

    const part2 = layout.pages[1]!.blocks[0]!;
    expect(part2.lines).toHaveLength(3);
    expect(part2.isContinuation).toBe(true);
    expect(part2.continuesOnNextPage).toBeUndefined();
  });

  it("all lines are conserved when a first-on-page paragraph spans two pages", () => {
    const layout = runPipeline(doc(p(sixLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });
    const totalLines = layout.pages
      .flatMap(pg => pg.blocks)
      .reduce((n, b) => n + b.lines.length, 0);
    expect(totalLines).toBe(6);
  });

  it("splits a first-on-page paragraph across three pages when it has 9 lines", () => {
    const layout = runPipeline(doc(p(nineLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });

    expect(layout.pages).toHaveLength(3);

    const p1 = layout.pages[0]!.blocks[0]!;
    expect(p1.lines).toHaveLength(3);
    expect(p1.continuesOnNextPage).toBe(true);
    expect(p1.isContinuation).toBeUndefined();

    const p2 = layout.pages[1]!.blocks[0]!;
    expect(p2.lines).toHaveLength(3);
    expect(p2.isContinuation).toBe(true);
    expect(p2.continuesOnNextPage).toBe(true);

    const p3 = layout.pages[2]!.blocks[0]!;
    expect(p3.lines).toHaveLength(3);
    expect(p3.isContinuation).toBe(true);
    expect(p3.continuesOnNextPage).toBeUndefined();

    // Total lines conserved
    expect(p1.lines.length + p2.lines.length + p3.lines.length).toBe(9);
  });

  it("splits a paragraph that is first on a page following a hard page break", () => {
    // After the page break, currentPage.blocks is empty so isFirstOnPage is true.
    // The six-line paragraph must still split across pages 2 and 3.
    const layout = runPipeline(doc(p("intro"), pageBreak(), p(sixLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });

    expect(layout.pages).toHaveLength(3);

    const part1 = layout.pages[1]!.blocks[0]!;
    expect(part1.lines).toHaveLength(3);
    expect(part1.continuesOnNextPage).toBe(true);

    const part2 = layout.pages[2]!.blocks[0]!;
    expect(part2.lines).toHaveLength(3);
    expect(part2.isContinuation).toBe(true);
    expect(part2.continuesOnNextPage).toBeUndefined();
  });

  it("continuation parts have spaceBefore = 0 when the block style has non-zero spaceBefore", () => {
    // heading_1 has spaceBefore = 24 in defaultFontConfig.
    // Continuation parts must suppress spaceBefore regardless.
    const layout = runPipeline(doc(heading(1, nineLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });

    expect(layout.pages.length).toBeGreaterThanOrEqual(2);

    for (let i = 1; i < layout.pages.length; i++) {
      const part = layout.pages[i]!.blocks[0]!;
      expect(part.isContinuation).toBe(true);
      expect(part.spaceBefore).toBe(0);
    }
  });
});

// ── Gap suppression at page boundary (linesFit=0 dead zone) ──────────────────
//
// When the inter-block gap (prevSpaceAfter + spaceBefore) pushes targetY into
// the "dead zone" where not even one line fits, but lines WOULD fit starting
// from y (gap-free), the gap is suppressed and the block starts at y instead
// of jumping entirely to the next page.
//
// This is the second missing-link bug: "paragraphs moved to next page when
// they can fit the current page."
//
// Same splitPage geometry (3 lines per page, lineHeight=18, pageBottom=64).
// Key boundary: targetY must be > pageBottom - lineHeight = 64 - 18 = 46
// for linesFit=0. But y must be <= pageBottom - lineHeight = 46 for the
// gap-suppression fix to kick in.
describe("runPipeline — gap suppression at page boundary", () => {
  const LH = MOCK_LINE_HEIGHT; // 18px

  const splitPage = {
    pageWidth:  120,
    pageHeight: Math.round(10 + 3 * LH + 10), // 74px
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
  };

  // 2-line intro: y = margins.top + 2×LH = 10 + 36 = 46 = pageBottom - LH
  // gap = prevSpaceAfter(10) → targetY = 56 → pageAvailable = 8 < 18 → dead zone
  // BUT pageBottom - y = 18 >= LH → gap-suppression applies → 1 line on page 1
  const twoLineIntro = "aaaaaaaaa bbbbbbbbb";
  const fourLineText = "aaaaaaaaa bbbbbbbbb ccccccccc ddddddddd";

  it("splits a paragraph whose gap pushed targetY into the dead zone", () => {
    // twoLineIntro → y=46. gap=10 → targetY=56. pageAvailable=8 < LH.
    // pageBottom - y = 18 = LH → fix kicks in: block starts at y=46, 1 line on p1.
    const layout = runPipeline(doc(p(twoLineIntro), p(fourLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });

    expect(layout.pages).toHaveLength(2);

    // Page 1: intro (2 lines) + first line of second para
    expect(layout.pages[0]!.blocks).toHaveLength(2);
    const gapPart = layout.pages[0]!.blocks[1]!;
    expect(gapPart.lines).toHaveLength(1);
    expect(gapPart.continuesOnNextPage).toBe(true);
    expect(gapPart.isContinuation).toBeUndefined();

    // Page 2: remaining 3 lines
    const cont = layout.pages[1]!.blocks[0]!;
    expect(cont.lines).toHaveLength(3);
    expect(cont.isContinuation).toBe(true);
  });

  it("block starts at y (gap suppressed), not at targetY", () => {
    // Block must visually start directly after the previous block — no gap wasted.
    const layout = runPipeline(doc(p(twoLineIntro), p(fourLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });

    const introY = splitPage.margins.top; // 10
    const introHeight = 2 * LH; // 36
    const expectedY = introY + introHeight; // 46 = y (not targetY = 56)
    expect(layout.pages[0]!.blocks[1]!.y).toBe(expectedY);
  });

  it("all lines are conserved when gap suppression applies", () => {
    const layout = runPipeline(doc(p(twoLineIntro), p(fourLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });
    const totalLines = layout.pages
      .flatMap(pg => pg.blocks)
      .reduce((n, b) => n + b.lines.length, 0);
    expect(totalLines).toBe(2 + 4); // intro + four-line para
  });

  it("gap suppression applies when spaceBefore (not prevSpaceAfter) causes the dead zone", () => {
    // One-line intro → y = 28. heading_1 spaceBefore = 24.
    // gap = max(10, 24) = 24 → targetY = 52 → pageAvailable = 12 < LH.
    // pageBottom - y = 36 >= LH → fix: heading starts at y=28, 2 lines on p1.
    const oneLineIntro = "aaaaaaaaa";
    const layout = runPipeline(doc(p(oneLineIntro), heading(1, fourLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });

    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]!.blocks).toHaveLength(2);

    const headingPart1 = layout.pages[0]!.blocks[1]!;
    expect(headingPart1.lines.length).toBeGreaterThanOrEqual(1);
    expect(headingPart1.continuesOnNextPage).toBe(true);

    const headingPart2 = layout.pages[1]!.blocks[0]!;
    expect(headingPart2.isContinuation).toBe(true);
  });

  it("block still jumps to next page when no room even at y (regression guard)", () => {
    // Three-line intro fills page 1 exactly: y = 10 + 54 = 64 = pageBottom.
    // pageBottom - y = 0 < LH → gap-suppression does NOT apply → block jumps.
    // fourLineText (4 lines) then splits normally across pages 2 and 3 (3 + 1).
    const threeLineIntro = "aaaaaaaaa bbbbbbbbb ccccccccc";
    const layout = runPipeline(doc(p(threeLineIntro), p(fourLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });

    // Page 1: intro only. Page 2+3: four-line para split 3/1 (page fits 3 lines).
    expect(layout.pages).toHaveLength(3);
    expect(layout.pages[0]!.blocks).toHaveLength(1);

    // The first part on page 2 has isContinuation=undefined (it jumped, not split)
    expect(layout.pages[1]!.blocks[0]!.isContinuation).toBeUndefined();
    expect(layout.pages[1]!.blocks[0]!.lines).toHaveLength(3);
    expect(layout.pages[2]!.blocks[0]!.isContinuation).toBe(true);
    expect(layout.pages[2]!.blocks[0]!.lines).toHaveLength(1);
  });
});

describe("runPipeline — pageConfig.fontFamily", () => {
  it("span fonts in a paragraph use the page fontFamily", () => {
    const { fontConfig } = buildStarterKitContext();
    const layout = runPipeline(doc(p("Hello")), {
      pageConfig: { ...defaultPageConfig, fontFamily: "Arial" },
      fontConfig,
      measurer: createMeasurer(),
    });
    const rawSpan = layout.pages[0]?.blocks[0]?.lines[0]?.spans[0];
    const span = rawSpan?.kind === "text" ? rawSpan : undefined;
    expect(span?.font).toContain("Arial");
    expect(span?.font).not.toContain("Georgia");
  });

  it("span fonts in a heading use the page fontFamily", () => {
    const { fontConfig } = buildStarterKitContext();
    const layout = runPipeline(doc(heading(1, "Title")), {
      pageConfig: { ...defaultPageConfig, fontFamily: "Verdana" },
      fontConfig,
      measurer: createMeasurer(),
    });
    const rawSpan = layout.pages[0]?.blocks[0]?.lines[0]?.spans[0];
    const span = rawSpan?.kind === "text" ? rawSpan : undefined;
    expect(span?.font).toContain("Verdana");
    expect(span?.font).toContain("bold");
    expect(span?.font).toContain("28px");
  });

  it("absent fontFamily falls back to DEFAULT_FONT_FAMILY (Arial)", () => {
    const { fontConfig } = buildStarterKitContext();
    const layout = runPipeline(doc(p("Hello")), {
      pageConfig: defaultPageConfig, // no fontFamily — pipeline injects DEFAULT_FONT_FAMILY
      fontConfig,
      measurer: createMeasurer(),
    });
    const rawSpan = layout.pages[0]?.blocks[0]?.lines[0]?.spans[0];
    const span = rawSpan?.kind === "text" ? rawSpan : undefined;
    expect(span?.font).toContain("Arial");
  });
});

// ── Float layout (wrapping mode) ───────────────────────────────────────────────

describe("runPipeline — float image wrapping", () => {
  // Long text to force several wrapped lines (each ≈ 55 chars at 8px/char, 442px constrained width)
  const longText = "word ".repeat(60).trim(); // 60 words × 5 chars = ~300 chars, ~6+ lines

  it("square-left: produces floats array with the float image", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = schema.nodes["image"]!.create({ src: "", width: 200, height: 200, wrappingMode: "square-left" });
    const para = schema.node("paragraph", null, [img, schema.text(longText)]);
    const layout = runPipeline(schema.node("doc", null, [para]), {
      pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer(),
    });
    expect(layout.floats).toBeDefined();
    expect(layout.floats!.length).toBe(1);
    expect(layout.floats![0]!.mode).toBe("square-left");
  });

  it("square-left: constrained lines have constraintX set (text pushed right of image)", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = schema.nodes["image"]!.create({ src: "", width: 200, height: 200, wrappingMode: "square-left" });
    const para = schema.node("paragraph", null, [img, schema.text(longText)]);
    const layout = runPipeline(schema.node("doc", null, [para]), {
      pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer(),
    });
    const block = layout.pages[0]!.blocks[0]!;
    // First line should be constrained (float starts at block.y = margins.top)
    const firstLine = block.lines[0]!;
    // constraintX = nodeWidth + FLOAT_MARGIN = 200 + 8 = 208
    expect(firstLine.constraintX).toBe(208);
    // effectiveWidth = contentWidth - nodeWidth - FLOAT_MARGIN = 650 - 200 - 8 = 442
    expect(firstLine.effectiveWidth).toBe(442);
  });

  it("square-right: constrained lines have effectiveWidth set (text wraps in left zone)", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = schema.nodes["image"]!.create({ src: "", width: 200, height: 200, wrappingMode: "square-right" });
    const para = schema.node("paragraph", null, [img, schema.text(longText)]);
    const layout = runPipeline(schema.node("doc", null, [para]), {
      pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer(),
    });
    const block = layout.pages[0]!.blocks[0]!;
    const firstLine = block.lines[0]!;
    // For square-right, text stays at left (constraintX = 0 / undefined)
    expect(firstLine.constraintX).toBeUndefined();
    // effectiveWidth = contentWidth - nodeWidth - FLOAT_MARGIN = 650 - 200 - 8 = 442
    expect(firstLine.effectiveWidth).toBe(442);
  });

  it("square-left: float x position is at left margin", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = schema.nodes["image"]!.create({ src: "", width: 200, height: 200, wrappingMode: "square-left" });
    const para = schema.node("paragraph", null, [img, schema.text(longText)]);
    const layout = runPipeline(schema.node("doc", null, [para]), {
      pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer(),
    });
    const float = layout.floats![0]!;
    expect(float.x).toBe(defaultPageConfig.margins.left); // 72
    expect(float.y).toBe(defaultPageConfig.margins.top);  // 72
  });

  it("square-right: float x position is at right margin", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = schema.nodes["image"]!.create({ src: "", width: 200, height: 200, wrappingMode: "square-right" });
    const para = schema.node("paragraph", null, [img, schema.text(longText)]);
    const layout = runPipeline(schema.node("doc", null, [para]), {
      pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer(),
    });
    const float = layout.floats![0]!;
    // floatX = contentRight - nodeWidth = (794 - 72) - 200 = 522
    expect(float.x).toBe(defaultPageConfig.pageWidth - defaultPageConfig.margins.right - 200);
    expect(float.y).toBe(defaultPageConfig.margins.top);
  });

  it("lines below the float zone revert to full width", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    // Float height = 200. lineHeight ≈ 18. Lines within float zone: floor(200/18) = 11 lines.
    // Use enough text to get lines well past the float zone.
    const extraLongText = "word ".repeat(200).trim();
    const img = schema.nodes["image"]!.create({ src: "", width: 200, height: 200, wrappingMode: "square-left" });
    const para = schema.node("paragraph", null, [img, schema.text(extraLongText)]);
    const layout = runPipeline(schema.node("doc", null, [para]), {
      pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer(),
    });
    const block = layout.pages[0]!.blocks[0]!;
    // Find a line beyond the float zone (past 200px from block.y)
    let foundUnconstrained = false;
    let cumulativeH = 0;
    for (const line of block.lines) {
      cumulativeH += line.lineHeight;
      if (cumulativeH > 200 && line.constraintX === undefined && line.effectiveWidth === undefined) {
        foundUnconstrained = true;
        break;
      }
    }
    expect(foundUnconstrained).toBe(true);
  });

  it("overflow cascade: blocks pushed past page N+1 bottom are moved to page N+2", () => {
    // Regression for the Pass 3b cascade bug:
    // Pass 3 moves overflow blocks from page 1 to page 2 and pushes page 2's
    // existing blocks DOWN. If those pushed blocks now exceed page 2's bottom,
    // they must be cascaded to page 3 — they were NOT, because Pass 3 skips
    // pages without exclusion zones.
    const { schema, fontConfig } = buildStarterKitContext();
    const smallPage = {
      pageWidth: 360,
      pageHeight: 200,
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
    };
    // Float paragraph fills most of page 1 and causes a large yDelta,
    // pushing "after" paragraphs off page 1 into page 2. The "filler"
    // paragraphs on page 2 are then pushed past page 2's bottom by the
    // prepended overflow blocks — they must land on page 3.
    const img = schema.nodes["image"]!.create({ src: "", width: 200, height: 100, wrappingMode: "square-left" });
    const manyWords = "word ".repeat(60).trim();
    const floatPara = schema.node("paragraph", null, [img, schema.text(manyWords)]);
    const filler1 = schema.node("paragraph", null, [schema.text("filler one")]);
    const filler2 = schema.node("paragraph", null, [schema.text("filler two")]);
    const filler3 = schema.node("paragraph", null, [schema.text("filler three")]);
    const layout = runPipeline(
      schema.node("doc", null, [floatPara, filler1, filler2, filler3]),
      { pageConfig: smallPage, fontConfig, measurer: createMeasurer() },
    );

    const pageBottom = smallPage.pageHeight - smallPage.margins.bottom; // 180
    for (const page of layout.pages) {
      for (const block of page.blocks) {
        if (block.lines.length > 0) {
          expect(block.y + block.height).toBeLessThanOrEqual(pageBottom + 0.001);
        }
      }
    }
  });

  it("Phase 1b drag: re-layout after float move does not double-shift block positions", () => {
    // Regression for the Phase 1b float-drag bug:
    // Phase 1b copies blocks from previousLayout which has Pass-3 yDelta baked
    // into block.y values. When the float moves and runFloatPass runs again,
    // Pass 3 stacks its new yDelta on top — doubling displacement and pushing
    // the last paragraphs off the page. The fix: Phase 1b copies from
    // _pass1Pages (clean pre-float positions) instead of the float-adjusted pages.
    const { schema, fontConfig } = buildStarterKitContext();
    const smallPage = {
      pageWidth: 360,
      pageHeight: 400,
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
    };
    const measurer = createMeasurer();
    const img = schema.nodes["image"]!.create({ src: "", width: 150, height: 120, wrappingMode: "square-left" });
    const manyWords = "word ".repeat(40).trim();
    const floatPara = schema.node("paragraph", null, [img, schema.text(manyWords)]);
    const after1 = schema.node("paragraph", null, [schema.text("trailing one")]);
    const after2 = schema.node("paragraph", null, [schema.text("trailing two")]);
    const doc = schema.node("doc", null, [floatPara, after1, after2]);
    const opts = { pageConfig: smallPage, fontConfig, measurer };

    // First layout (float at default offsetY=0).
    const layout1 = runPipeline(doc, opts);

    // Simulate drag: move float down by 60px. Only the image node changes.
    const img2 = schema.nodes["image"]!.create({ src: "", width: 150, height: 120, wrappingMode: "square-left", floatOffset: { x: 0, y: 60 } });
    const floatPara2 = schema.node("paragraph", null, [img2, schema.text(manyWords)]);
    const doc2 = schema.node("doc", null, [floatPara2, after1, after2]);

    // Second layout reuses measureCache and previousLayout — exactly what the
    // editor does on each drag mousemove event.
    const measureCache = new WeakMap();
    const layout2 = runPipeline(doc2, { ...opts, previousLayout: layout1, measureCache });

    // All text blocks must be within the page bottom on every page.
    const pageBottom = smallPage.pageHeight - smallPage.margins.bottom; // 380
    for (const page of layout2.pages) {
      for (const block of page.blocks) {
        if (block.lines.length > 0) {
          expect(block.y + block.height).toBeLessThanOrEqual(pageBottom + 0.001);
        }
      }
    }
    // The trailing paragraphs must appear somewhere in the layout (not lost).
    const allBlocks = layout2.pages.flatMap((p) => p.blocks);
    const trailingCount = allBlocks.filter(
      (b) => b.node === after1 || b.node === after2,
    ).length;
    expect(trailingCount).toBe(2);
  });

  it("float stacking: two same-side floats do not overlap each other", () => {
    // Fix 1: downward scan. A second square-left float anchored near the first
    // must be pushed below it, not placed at the same Y.
    const { schema, fontConfig } = buildStarterKitContext();
    const measurer = createMeasurer();
    const img1 = schema.nodes["image"]!.create({ src: "", width: 150, height: 100, wrappingMode: "square-left" });
    const img2 = schema.nodes["image"]!.create({ src: "", width: 150, height: 100, wrappingMode: "square-left" });
    // Both anchors are in adjacent paragraphs — without the fix they'd both
    // land at approximately the same Y and visually overlap.
    const para1 = schema.node("paragraph", null, [img1, schema.text("first float text here")]);
    const para2 = schema.node("paragraph", null, [img2, schema.text("second float text here")]);
    const layout = runPipeline(
      schema.node("doc", null, [para1, para2]),
      { pageConfig: defaultPageConfig, fontConfig, measurer },
    );
    const floats = layout.floats!;
    expect(floats.length).toBe(2);
    const [f1, f2] = floats as [typeof floats[0], typeof floats[0]];
    // The second float must start at or below the bottom of the first.
    expect(f2!.y).toBeGreaterThanOrEqual(f1!.y + f1!.height - 0.001);
  });

  it("float Y reconciliation: float y tracks anchor block after Pass 3 yDelta shift", () => {
    // Fix 2 (Pass 4): if blocks before the anchor grow due to wrapping around a
    // different float, yDelta shifts the anchor block. The FloatLayout.y must
    // follow the anchor's final position, not stay at its Pass 1 position.
    const { schema, fontConfig } = buildStarterKitContext();
    const measurer = createMeasurer();
    // Float A (square-right) on para1 causes para1 to grow (wrapped lines).
    // Float B (square-left) on para2 — its anchor shifts down by yDelta.
    // After Pass 4, float B's y must equal para2's final block.y + offsetY.
    const imgA = schema.nodes["image"]!.create({ src: "", width: 200, height: 80, wrappingMode: "square-right" });
    const imgB = schema.nodes["image"]!.create({ src: "", width: 200, height: 80, wrappingMode: "square-left" });
    const manyWords = "word ".repeat(30).trim();
    const para1 = schema.node("paragraph", null, [imgA, schema.text(manyWords)]);
    const para2 = schema.node("paragraph", null, [imgB, schema.text("anchor text")]);
    const layout = runPipeline(
      schema.node("doc", null, [para1, para2]),
      { pageConfig: defaultPageConfig, fontConfig, measurer },
    );
    const floats = layout.floats!;
    expect(floats.length).toBe(2);
    const floatB = floats.find((f) => f.node === imgB)!;
    // Find para2's final block y.
    const allBlocks = layout.pages.flatMap((p) => p.blocks);
    const anchorBlock = allBlocks.find((b) => b.node === para2)!;
    expect(floatB.y).toBeCloseTo(anchorBlock.y, 1);
  });

  it("float stacking past page bottom: overflowed float moves to next page", () => {
    // Regression: two square-left floats with height > half the page.
    // After Fix 1 stacks float2 below float1, candidateY + height > pageBottom.
    // The float must land on page 2 (page: 2) with y within page 2's bounds,
    // NOT stay on page 1 with y > pageBottom (which made it invisible).
    const { schema, fontConfig } = buildStarterKitContext();
    const smallPage = {
      pageWidth: 300,
      pageHeight: 300,
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
    };
    // pageBottom = 300 - 20 = 280. Two floats each 160px tall stacked = 20 + 160 + 160 = 340 > 280.
    const img1 = schema.nodes["image"]!.create({ src: "", width: 100, height: 160, wrappingMode: "square-left" });
    const img2 = schema.nodes["image"]!.create({ src: "", width: 100, height: 160, wrappingMode: "square-left" });
    const para1 = schema.node("paragraph", null, [img1, schema.text("first paragraph text")]);
    const para2 = schema.node("paragraph", null, [img2, schema.text("second paragraph text")]);
    const layout = runPipeline(
      schema.node("doc", null, [para1, para2]),
      { pageConfig: smallPage, fontConfig, measurer: createMeasurer() },
    );

    const floats = layout.floats!;
    expect(floats.length).toBe(2);
    const pageBottom = smallPage.pageHeight - smallPage.margins.bottom;

    // Every float must fit within its assigned page (y + height ≤ pageBottom).
    for (const f of floats) {
      expect(f.y + f.height).toBeLessThanOrEqual(pageBottom + 0.001);
    }

    // The second float should have overflowed to page 2.
    const f2 = floats[1]!;
    expect(f2.page).toBe(2);
    expect(f2.anchorPage).toBe(1); // anchor paragraph is still on page 1
    expect(f2.y).toBeGreaterThanOrEqual(smallPage.margins.top - 0.001);
  });

  it("float page overflow: getFloatPosition uses float.page not anchor glyph page", () => {
    // Regression for the scroll-to-page-1 bug:
    // When a float overflows to page 2, its docPos is still in a paragraph on page 1.
    // layout.floats[].page must be 2 so callers can scroll to the correct page.
    const { schema, fontConfig } = buildStarterKitContext();
    const smallPage = {
      pageWidth: 300,
      pageHeight: 300,
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
    };
    const img1 = schema.nodes["image"]!.create({ src: "", width: 100, height: 160, wrappingMode: "square-left" });
    const img2 = schema.nodes["image"]!.create({ src: "", width: 100, height: 160, wrappingMode: "square-left" });
    const para1 = schema.node("paragraph", null, [img1, schema.text("first para")]);
    const para2 = schema.node("paragraph", null, [img2, schema.text("second para")]);
    const layout = runPipeline(
      schema.node("doc", null, [para1, para2]),
      { pageConfig: smallPage, fontConfig, measurer: createMeasurer() },
    );

    const floats = layout.floats!;
    const f2 = floats.find((f) => f.node === img2)!;

    // Simulate getFloatPosition(sel.from) — sel.from = f2.docPos for a NodeSelection.
    const resolved = floats.find((fl) => fl.docPos === f2.docPos);
    expect(resolved).toBeDefined();
    // The resolved page must be the float's visual page (2), not the anchor's page (1).
    expect(resolved!.page).toBe(2);
    // anchorPage reflects where the paragraph lives — useful for Pass 4 yDelta.
    expect(resolved!.anchorPage).toBe(1);
  });

  it("float yDelta: long paragraph is split at page boundary rather than moved wholesale", () => {
    // Regression for the core bug: when float reflow (Pass 3) applies yDelta to
    // a subsequent block, pushing it past pageBottom, the block was previously
    // moved to the next page as a whole unit (leaving blank space on page 1).
    // With the fix, lines that fit on page 1 stay; the rest continue on page 2.
    //
    // Setup: smallPage width=500, height=300, margins=20 → pageBottom=280, contentWidth=460
    // Float: width=400 (square-left) → constrained text width ≈ 52px (460-400-8*2)
    // floatPara (anchor): img + 4 words → Pass 1: 1 line (18px); Pass 3: 4 lines (72px)
    //   → yDelta = 54px
    // afterPara: ~150 words → Pass 1: 13 lines on page 1 (y=38, h=234) + 1 line on page 2
    //   After yDelta: y=92, h=234, bottom=326 > 280 → overflow
    //   splitBlockAtBoundary: 10 lines fit (y=92..272), 3 lines overflow to page 2
    const { schema, fontConfig } = buildStarterKitContext();
    const smallPage = {
      pageWidth: 500,
      pageHeight: 300,
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
    };
    const img = schema.nodes["image"]!.create({ src: "", width: 400, height: 50, wrappingMode: "square-left" });
    const floatPara = schema.node("paragraph", null, [img, schema.text("word word word word")]);
    const longText = "word ".repeat(150).trim();
    const afterPara = schema.node("paragraph", null, [schema.text(longText)]);
    const layout = runPipeline(
      schema.node("doc", null, [floatPara, afterPara]),
      { pageConfig: smallPage, fontConfig, measurer: createMeasurer() },
    );

    const pageBottom = smallPage.pageHeight - smallPage.margins.bottom; // 280

    // afterPara must appear on page 1 (not wholly moved to page 2)
    const page1Blocks = layout.pages[0]?.blocks ?? [];
    const afterParaOnPage1 = page1Blocks.find((b) => b.node === afterPara);
    expect(afterParaOnPage1).toBeDefined();

    // The page 1 part must be a split part (continues on next page)
    expect(afterParaOnPage1?.continuesOnNextPage).toBe(true);

    // afterPara must also appear on page 2 (the overflow)
    const page2Blocks = layout.pages[1]?.blocks ?? [];
    const afterParaOnPage2 = page2Blocks.find((b) => b.node === afterPara);
    expect(afterParaOnPage2).toBeDefined();

    // The page 2 part must be a continuation
    expect(afterParaOnPage2?.isContinuation).toBe(true);

    // No text block should overflow the page bottom
    for (const page of layout.pages) {
      for (const block of page.blocks) {
        if (block.lines.length > 0) {
          expect(block.y + block.height).toBeLessThanOrEqual(pageBottom + 0.001);
        }
      }
    }
  });

  it("Pass 3 reflowed block never overflows the page bottom", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const smallPage = {
      pageWidth: 360,
      pageHeight: 400,
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
    };
    // A one-line anchor ensures the float paragraph is NOT isFirstOnPage,
    // allowing Pass 1 to split it when it overflows.
    const anchor = schema.node("paragraph", null, [schema.text("lead")]);
    const img = schema.nodes["image"]!.create({ src: "", width: 200, height: 150, wrappingMode: "square-left" });
    const manyWords = "word ".repeat(100).trim();
    const floatPara = schema.node("paragraph", null, [img, schema.text(manyWords)]);
    // Paragraphs after the float get yDelta-shifted. Without the fix they
    // overflow into the bottom margin; with the fix they move to the next page.
    const after1 = schema.node("paragraph", null, [schema.text("after one")]);
    const after2 = schema.node("paragraph", null, [schema.text("after two")]);
    const layout = runPipeline(
      schema.node("doc", null, [anchor, floatPara, after1, after2]),
      { pageConfig: smallPage, fontConfig, measurer: createMeasurer() },
    );

    const pageBottom = smallPage.pageHeight - smallPage.margins.bottom; // 380
    for (const page of layout.pages) {
      for (const block of page.blocks) {
        if (block.lines.length > 0) {
          expect(block.y + block.height).toBeLessThanOrEqual(pageBottom + 0.001);
        }
      }
    }
  });
});

// ── Float image — top-bottom (break) mode ────────────────────────────────────
//
// defaultPageConfig: pageWidth=794, margins=72 all sides
//   contentX = 72, contentRight = 722, contentWidth = 650
//   FLOAT_MARGIN = 8, MOCK_LINE_HEIGHT = 18
//
// For a 200×200 image in break mode:
//   floatX = 72 + (650 - 200) / 2 = 72 + 225 = 297  (centered)
//   exclusion: x=72, right=722 (full content width), y=72-8=64, bottom=72+200+8=280
//   skipToY = 280 (first line at y=72 is inside [64,280] → gap to 280)

describe("runPipeline — top-bottom (break) float", () => {
  const longText = "word ".repeat(80).trim();

  it("float starts at content left and spans full content width", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = schema.nodes["image"]!.create({ src: "", width: 200, height: 200, wrappingMode: "top-bottom" });
    const para = schema.node("paragraph", null, [img, schema.text(longText)]);
    const layout = runPipeline(schema.node("doc", null, [para]), {
      pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer(),
    });
    const float = layout.floats![0]!;
    const contentX     = defaultPageConfig.margins.left;                                // 72
    const contentWidth = defaultPageConfig.pageWidth - defaultPageConfig.margins.left - defaultPageConfig.margins.right; // 650
    expect(float.x).toBeCloseTo(contentX, 1);
    expect(float.width).toBeCloseTo(contentWidth, 1);
  });

  it("no text line overlaps the image zone (text fully above or below)", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = schema.nodes["image"]!.create({ src: "", width: 200, height: 200, wrappingMode: "top-bottom" });
    const para = schema.node("paragraph", null, [img, schema.text(longText)]);
    const layout = runPipeline(schema.node("doc", null, [para]), {
      pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer(),
    });

    const float = layout.floats![0]!;
    const floatTop    = float.y;
    const floatBottom = float.y + float.height;

    // Accumulate line Y positions from the anchor block.
    const block = layout.pages[0]!.blocks[0]!;
    let lineY = block.y;
    for (const line of block.lines) {
      if (line.spans.length > 0) {
        // A real (non-spacer) line must not overlap [floatTop, floatBottom].
        const lineBottom = lineY + line.lineHeight;
        const overlaps = lineY < floatBottom && lineBottom > floatTop;
        expect(overlaps).toBe(false);
      }
      lineY += line.lineHeight;
    }
  });

  it("all words appear in the laid-out lines (no text dropped)", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = schema.nodes["image"]!.create({ src: "", width: 200, height: 200, wrappingMode: "top-bottom" });
    const text = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    const para = schema.node("paragraph", null, [img, schema.text(text)]);
    const layout = runPipeline(schema.node("doc", null, [para]), {
      pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer(),
    });
    const block = layout.pages[0]!.blocks[0]!;
    const rendered = block.lines
      .flatMap((l) => l.spans.filter((s) => s.kind === "text").map((s) => (s as { kind: "text"; text: string }).text))
      .join(" ")
      .trim();
    // Every word from the source text must be present.
    for (const word of text.split(" ")) {
      expect(rendered).toContain(word);
    }
  });

  it("block height includes the image gap (height > just the text lines)", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = schema.nodes["image"]!.create({ src: "", width: 200, height: 200, wrappingMode: "top-bottom" });
    const para = schema.node("paragraph", null, [img, schema.text(longText)]);
    const layout = runPipeline(schema.node("doc", null, [para]), {
      pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer(),
    });
    // Without the gap the block height would be just text lines.
    // With the gap it must be at least imageHeight (200px) taller.
    const block = layout.pages[0]!.blocks[0]!;
    const FLOAT_MARGIN = 8;
    expect(block.height).toBeGreaterThanOrEqual(200 + FLOAT_MARGIN);
  });

  it("exclusion spans full content width (no text constrained to a narrow column)", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    // Use a very wide image to ensure a narrow-column bug would be obvious.
    const img = schema.nodes["image"]!.create({ src: "", width: 400, height: 100, wrappingMode: "top-bottom" });
    const para = schema.node("paragraph", null, [img, schema.text(longText)]);
    const layout = runPipeline(schema.node("doc", null, [para]), {
      pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer(),
    });
    const block = layout.pages[0]!.blocks[0]!;
    const contentWidth = defaultPageConfig.pageWidth - defaultPageConfig.margins.left - defaultPageConfig.margins.right; // 650
    // All real lines must use the full content width (no constraintX narrowing).
    for (const line of block.lines) {
      if (line.spans.length > 0) {
        expect(line.constraintX ?? 0).toBe(0);
        // effectiveWidth should be undefined (full width) or equal to contentWidth.
        if (line.effectiveWidth !== undefined) {
          expect(line.effectiveWidth).toBeCloseTo(contentWidth, 1);
        }
      }
    }
  });
});

// ── Fragment identity fields ───────────────────────────────────────────────────
//
// ── buildFragments — Stage 4 ─────────────────────────────────────────────────

describe("buildFragments — Stage 4", () => {
  const LH = MOCK_LINE_HEIGHT; // 18px

  const splitPage = {
    pageWidth:  120,
    pageHeight: Math.round(10 + 3 * LH + 10), // 74px: 3 lines + 10px margins each side
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
  };

  const fourLineText = "aaaaaaaaa bbbbbbbbb ccccccccc ddddddddd"; // 4 words → 4 lines
  const sixLineText  = "aaaaaaaaa bbbbbbbbb ccccccccc ddddddddd eeeeeeeee fffffffff"; // 6 lines

  it("layout.fragments is present and non-empty", () => {
    const layout = runPipeline(doc(p("Hello"), p("World")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    expect(layout.fragments).toBeDefined();
    expect(layout.fragments!.length).toBeGreaterThan(0);
  });

  it("layout.fragmentsByPage is present and indexed by page", () => {
    const layout = runPipeline(doc(p("Hello")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    expect(layout.fragmentsByPage).toBeDefined();
    expect(layout.fragmentsByPage![0]).toBeDefined();
  });

  it("unsplit block produces one fragment with fragmentCount=1 and fragmentIndex=0", () => {
    const layout = runPipeline(doc(p("intro")), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });
    const frag = layout.fragments![0]!;
    expect(frag.fragmentIndex).toBe(0);
    expect(frag.fragmentCount).toBe(1);
    expect(frag.sourceNodePos).toBe(layout.pages[0]!.blocks[0]!.nodePos);
  });

  it("unsplit block: LayoutBlock has no fragmentIndex/fragmentCount/sourceNodePos", () => {
    const layout = runPipeline(doc(p("intro")), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });
    const block = layout.pages[0]!.blocks[0]!;
    expect(block.fragmentIndex).toBeUndefined();
    expect(block.fragmentCount).toBeUndefined();
    expect(block.sourceNodePos).toBeUndefined();
  });

  it("two-part split: fragments have fragmentIndex 0 and 1, fragmentCount 2", () => {
    const layout = runPipeline(doc(p("intro"), p(fourLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });
    // "intro" is fragment 0; split block produces fragments 1 (page 1) and 2 (page 2)
    const splitFrags = layout.fragments!.filter(f => f.fragmentCount === 2);
    expect(splitFrags).toHaveLength(2);
    expect(splitFrags[0]!.fragmentIndex).toBe(0);
    expect(splitFrags[1]!.fragmentIndex).toBe(1);
    expect(splitFrags[0]!.sourceNodePos).toBe(splitFrags[1]!.sourceNodePos);
  });

  it("three-part split: fragmentCount is 3 on all three fragments", () => {
    const layout = runPipeline(doc(p("intro"), p(sixLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });
    const splitFrags = layout.fragments!.filter(f => f.fragmentCount === 3);
    expect(splitFrags).toHaveLength(3);
    expect(splitFrags[0]!.fragmentIndex).toBe(0);
    expect(splitFrags[1]!.fragmentIndex).toBe(1);
    expect(splitFrags[2]!.fragmentIndex).toBe(2);
    expect(splitFrags[0]!.sourceNodePos).toBe(splitFrags[2]!.sourceNodePos);
  });

  it("isFirst / isLast are correct for a three-part split", () => {
    const layout = runPipeline(doc(p("intro"), p(sixLineText)), {
      pageConfig: splitPage,
      measurer: createMeasurer(),
    });
    const [f0, f1, f2] = layout.fragments!.filter(f => f.fragmentCount === 3);
    const isFirst = (f: LayoutFragment) => f.fragmentIndex === 0;
    const isLast  = (f: LayoutFragment) => f.fragmentIndex === f.fragmentCount - 1;

    expect(isFirst(f0!)).toBe(true);
    expect(isLast(f0!)).toBe(false);
    expect(isFirst(f1!)).toBe(false);
    expect(isLast(f1!)).toBe(false);
    expect(isFirst(f2!)).toBe(false);
    expect(isLast(f2!)).toBe(true);
  });

  it("fragmentsByPage groups fragments correctly by page number", () => {
    const layout = runPipeline(doc(p("Page 1"), pageBreak(), p("Page 2")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    expect(layout.fragmentsByPage![0]).toHaveLength(1);
    expect(layout.fragmentsByPage![1]).toHaveLength(1);
    expect(layout.fragmentsByPage![0]![0]!.page).toBe(1);
    expect(layout.fragmentsByPage![1]![0]!.page).toBe(2);
  });

  it("each fragment carries a block reference with correct geometry", () => {
    const layout = runPipeline(doc(p("Hello")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    const frag = layout.fragments![0]!;
    expect(frag.block).toBe(layout.pages[0]!.blocks[0]!);
    expect(frag.x).toBe(frag.block.x);
    expect(frag.y).toBe(frag.block.y);
    expect(frag.width).toBe(frag.block.availableWidth);
    expect(frag.height).toBe(frag.block.height);
    expect(frag.lineCount).toBe(frag.block.lines.length);
    expect(frag.lineStart).toBe(0);
  });

  it("total fragment count equals total block count across all pages", () => {
    const layout = runPipeline(doc(p("A"), p("B"), p("C")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    const totalBlocks = layout.pages.reduce((s, pg) => s + pg.blocks.length, 0);
    expect(layout.fragments!.length).toBe(totalBlocks);
  });
});

// ── Pipeline stage unit tests ─────────────────────────────────────────────────

describe("buildBlockFlow — Stage 1", () => {
  it("returns one FlowBlock per top-level node", () => {
    const testDoc = doc(p("Hello"), p("World"));
    const measurer = createMeasurer();
    const items = collectLayoutItems(testDoc, defaultFontConfig);
    const cfg = { margins: defaultPageConfig.margins, contentWidth: 650 };
    const { flows, reachedCutoff } = buildBlockFlow(items, 0, cfg, defaultFontConfig, measurer, undefined, undefined);
    expect(flows).toHaveLength(2);
    expect(reachedCutoff).toBe(false);
  });

  it("every FlowBlock has height > 0 for non-empty paragraphs", () => {
    const testDoc = doc(p("Line one"), p("Line two"));
    const measurer = createMeasurer();
    const items = collectLayoutItems(testDoc, defaultFontConfig);
    const cfg = { margins: defaultPageConfig.margins, contentWidth: 650 };
    const { flows } = buildBlockFlow(items, 0, cfg, defaultFontConfig, measurer, undefined, undefined);
    for (const flow of flows) {
      expect(flow.height).toBeGreaterThan(0);
    }
  });

  it("respects maxBlocks and returns reachedCutoff: true", () => {
    const testDoc = doc(p("A"), p("B"), p("C"), p("D"), p("E"));
    const measurer = createMeasurer();
    const items = collectLayoutItems(testDoc, defaultFontConfig);
    const cfg = { margins: defaultPageConfig.margins, contentWidth: 650 };
    const { flows, reachedCutoff, cutoffIndex } = buildBlockFlow(
      items, 0, cfg, defaultFontConfig, measurer, undefined, undefined, 3,
    );
    expect(flows).toHaveLength(3);
    expect(reachedCutoff).toBe(true);
    expect(cutoffIndex).toBe(3);
  });

  it("startIndex skips already-processed items", () => {
    const testDoc = doc(p("A"), p("B"), p("C"));
    const measurer = createMeasurer();
    const items = collectLayoutItems(testDoc, defaultFontConfig);
    const cfg = { margins: defaultPageConfig.margins, contentWidth: 650 };
    const { flows } = buildBlockFlow(items, 2, cfg, defaultFontConfig, measurer, undefined, undefined);
    expect(flows).toHaveLength(1);
  });

  it("page_break item produces a zero-height isPageBreak FlowBlock", () => {
    const testDoc = doc(p("Before"), pageBreak(), p("After"));
    const measurer = createMeasurer();
    const items = collectLayoutItems(testDoc, defaultFontConfig);
    const cfg = { margins: defaultPageConfig.margins, contentWidth: 650 };
    const { flows } = buildBlockFlow(items, 0, cfg, defaultFontConfig, measurer, undefined, undefined);
    expect(flows).toHaveLength(3);
    expect(flows[1]!.isPageBreak).toBe(true);
    expect(flows[1]!.height).toBe(0);
  });
});

describe("paginateFlow — Stage 2", () => {
  // Shared helper: build the per-page metrics lookup the way runPipeline does.
  // With EMPTY_RESOLVED_CHROME, every page produces identical metrics matching
  // the pre-refactor hand-computed formula.
  const makeMetricsFor = () => {
    const cache = new Map<number, PageMetrics>();
    return (pageNumber: number): PageMetrics => {
      const hit = cache.get(pageNumber);
      if (hit) return hit;
      const m = computePageMetrics(defaultPageConfig, EMPTY_RESOLVED_CHROME, pageNumber);
      cache.set(pageNumber, m);
      return m;
    };
  };

  it("single short paragraph fits on page 1", () => {
    const testDoc = doc(p("Hello"));
    const measurer = createMeasurer();
    const { margins } = defaultPageConfig;
    const contentWidth  = defaultPageConfig.pageWidth  - margins.left - margins.right;
    const items = collectLayoutItems(testDoc, defaultFontConfig);
    const cfg = { margins, contentWidth };
    const { flows } = buildBlockFlow(items, 0, cfg, defaultFontConfig, measurer, undefined, undefined);
    const initPage = { pageNumber: 1, blocks: [] };
    const metricsFor = makeMetricsFor();
    const pr = paginateFlow(
      flows, defaultPageConfig, EMPTY_RESOLVED_CHROME, metricsFor, 1,
      undefined, undefined, [], initPage, metricsFor(1).contentTop, 0,
    );
    const allPages = [...pr.pages, pr.currentPage];
    expect(allPages).toHaveLength(1);
    expect(allPages[0]!.blocks).toHaveLength(1);
  });

  it("page_break FlowBlock forces a new page", () => {
    const testDoc = doc(p("Page 1"), pageBreak(), p("Page 2"));
    const measurer = createMeasurer();
    const { margins } = defaultPageConfig;
    const contentWidth  = defaultPageConfig.pageWidth  - margins.left - margins.right;
    const items = collectLayoutItems(testDoc, defaultFontConfig);
    const cfg = { margins, contentWidth };
    const { flows } = buildBlockFlow(items, 0, cfg, defaultFontConfig, measurer, undefined, undefined);
    const initPage = { pageNumber: 1, blocks: [] };
    const metricsFor = makeMetricsFor();
    const pr = paginateFlow(
      flows, defaultPageConfig, EMPTY_RESOLVED_CHROME, metricsFor, 1,
      undefined, undefined, [], initPage, metricsFor(1).contentTop, 0,
    );
    const allPages = [...pr.pages, pr.currentPage];
    expect(allPages).toHaveLength(2);
    expect(allPages[0]!.blocks[0]!.nodePos).toBeLessThan(allPages[1]!.blocks[0]!.nodePos);
  });

  it("earlyTerminated is false when no previousLayout is passed", () => {
    const testDoc = doc(p("Only"));
    const measurer = createMeasurer();
    const { margins } = defaultPageConfig;
    const contentWidth  = defaultPageConfig.pageWidth  - margins.left - margins.right;
    const items = collectLayoutItems(testDoc, defaultFontConfig);
    const { flows } = buildBlockFlow(items, 0, { margins, contentWidth }, defaultFontConfig, measurer, undefined, undefined);
    const metricsFor = makeMetricsFor();
    const pr = paginateFlow(
      flows, defaultPageConfig, EMPTY_RESOLVED_CHROME, metricsFor, 1,
      undefined, undefined, [], { pageNumber: 1, blocks: [] }, metricsFor(1).contentTop, 0,
    );
    expect(pr.earlyTerminated).toBe(false);
  });
});

// ── Pageless mode ─────────────────────────────────────────────────────────────

describe("runPipeline — pageless mode", () => {
  it("places all blocks on a single page regardless of document length", () => {
    // Build a doc with enough blocks to overflow a standard page
    const blocks = Array.from({ length: 60 }, (_, i) => p(`Paragraph ${i + 1}`));
    const layout = runPipeline(doc(...blocks), {
      pageConfig: defaultPagelessConfig,
      measurer: createMeasurer(),
    });
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]!.blocks).toHaveLength(60);
  });

  it("y grows monotonically — blocks are never moved to a new page", () => {
    const blocks = Array.from({ length: 20 }, (_, i) => p(`Line ${i + 1}`));
    const layout = runPipeline(doc(...blocks), {
      pageConfig: defaultPagelessConfig,
      measurer: createMeasurer(),
    });
    const ys = layout.pages[0]!.blocks.map((b) => b.y);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]!).toBeGreaterThan(ys[i - 1]!);
    }
  });

  it("ignores page_break nodes — no new pages created", () => {
    const layout = runPipeline(doc(p("Before"), pageBreak(), p("After")), {
      pageConfig: defaultPagelessConfig,
      measurer: createMeasurer(),
    });
    expect(layout.pages).toHaveLength(1);
  });

  it("totalContentHeight is greater than zero and grows with content", () => {
    const small = runPipeline(doc(p("A")), {
      pageConfig: defaultPagelessConfig,
      measurer: createMeasurer(),
    });
    const large = runPipeline(doc(...Array.from({ length: 40 }, (_, i) => p(`Para ${i}`))), {
      pageConfig: defaultPagelessConfig,
      measurer: createMeasurer(),
    });
    expect(small.totalContentHeight).toBeGreaterThan(0);
    expect(large.totalContentHeight).toBeGreaterThan(small.totalContentHeight);
  });

  it("totalContentHeight equals y of last block + height + bottom margin", () => {
    const layout = runPipeline(doc(p("Hello"), p("World")), {
      pageConfig: defaultPagelessConfig,
      measurer: createMeasurer(),
    });
    const blocks = layout.pages[0]!.blocks;
    const last = blocks[blocks.length - 1]!;
    const expectedMin = last.y + last.height;
    expect(layout.totalContentHeight).toBeGreaterThan(expectedMin);
    expect(layout.totalContentHeight).toBeLessThanOrEqual(expectedMin + defaultPagelessConfig.margins.bottom + 1);
  });

  it("paged mode totalContentHeight = pageCount * pageHeight", () => {
    // Build a 2-page document
    const blocks = Array.from({ length: 60 }, (_, i) => p(`Para ${i}`));
    const layout = runPipeline(doc(...blocks), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    const expected = layout.pages.length * defaultPageConfig.pageHeight;
    expect(layout.totalContentHeight).toBe(expected);
  });

  it("defaultPagelessConfig has pageless: true", () => {
    expect(defaultPagelessConfig.pageless).toBe(true);
    expect(defaultPagelessConfig.pageHeight).toBe(0);
  });
});

