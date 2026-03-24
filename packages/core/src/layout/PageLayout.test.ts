import { describe, it, expect } from "vitest";
import { layoutDocument, defaultPageConfig, collapseMargins } from "./PageLayout";
import type { MeasureCacheEntry } from "./PageLayout";
import { buildStarterKitContext, createMeasurer, paragraph as p, heading, doc, pageBreak } from "../test-utils";

// lineHeight = 18, contentHeight = 1123 - 72 - 72 = 979


function h1(text: string) {
  return heading(1, text);
}

// ── Basic structure ───────────────────────────────────────────────────────────

describe("layoutDocument — basic", () => {
  it("returns at least one page for an empty doc", () => {
    const layout = layoutDocument(doc(p()), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    expect(layout.pages.length).toBeGreaterThanOrEqual(1);
  });

  it("places a short document on one page", () => {
    const layout = layoutDocument(doc(p("Hello world")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]?.blocks).toHaveLength(1);
  });

  it("increments the version from the previous version", () => {
    const layout = layoutDocument(doc(p()), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      previousVersion: 5,
    });
    expect(layout.version).toBe(6);
  });

  it("block y coordinates are page-local (start from margins.top)", () => {
    const layout = layoutDocument(doc(p("Hello")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    const block = layout.pages[0]!.blocks[0]!;
    // First block on page: no spaceBefore (paragraph), so y = margins.top
    expect(block.y).toBe(defaultPageConfig.margins.top);
  });

  it("exposes pageConfig on the layout result", () => {
    const layout = layoutDocument(doc(p()), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    expect(layout.pageConfig).toBe(defaultPageConfig);
  });
});

// ── Multiple blocks ───────────────────────────────────────────────────────────

describe("layoutDocument — multiple blocks", () => {
  it("stacks two paragraphs vertically", () => {
    const layout = layoutDocument(doc(p("First"), p("Second")), {
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
    const layout = layoutDocument(doc(h1("Title"), p("Body")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
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
      measurer: createMeasurer(),
    });
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]!.blocks).toHaveLength(1);
    expect(layout.pages[1]!.blocks).toHaveLength(1);
  });

  it("resets y to margins.top on the new page", () => {
    const layout = layoutDocument(doc(p("A"), pageBreak(), p("B")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
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
    const layout = layoutDocument(doc(...blocks), {
      pageConfig: tinyPage,
      measurer: createMeasurer(),
    });

    // First block on page 2 should start at margins.top
    const firstBlockPage2 = layout.pages[1]?.blocks[0];
    expect(firstBlockPage2?.y).toBe(10); // margins.top
  });
});

// ── Horizontal rule ───────────────────────────────────────────────────────────

describe("layoutDocument — horizontal rule", () => {
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
  // spaceBefore = 8, spaceAfter = 8
  const HR_HEIGHT = 12;
  const HR_SPACE  = 8;

  it("HR block has correct height (derived from 8px font)", () => {
    const layout = layoutDocument(fullDoc(hr()), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      fontConfig: fullFontConfig,
    });
    const block = layout.pages[0]!.blocks[0]!;
    expect(block.height).toBe(HR_HEIGHT);
  });

  it("HR is positioned at margins.top when it is the first block", () => {
    const layout = layoutDocument(fullDoc(hr()), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      fontConfig: fullFontConfig,
    });
    const block = layout.pages[0]!.blocks[0]!;
    expect(block.y).toBe(defaultPageConfig.margins.top);
  });

  it("paragraph before HR: HR y accounts for para height and collapsed margin", () => {
    // para: spaceAfter=10.  HR: spaceBefore=8.  collapsed gap = max(10, 8) = 10
    const layout = layoutDocument(fullDoc(fullP("Hello"), hr()), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      fontConfig: fullFontConfig,
    });
    const [para, hrBlock] = layout.pages[0]!.blocks;
    const expectedGap = Math.max(10, HR_SPACE); // 10
    expect(hrBlock!.y).toBe(para!.y + para!.height + expectedGap);
  });

  it("HR before paragraph: para y accounts for HR height and collapsed margin", () => {
    // HR spaceAfter=8.  para: spaceBefore=0.  collapsed gap = max(8, 0) = 8
    const layout = layoutDocument(fullDoc(hr(), fullP("Hello")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      fontConfig: fullFontConfig,
    });
    const [hrBlock, para] = layout.pages[0]!.blocks;
    const expectedGap = Math.max(HR_SPACE, 0); // 8
    expect(para!.y).toBe(hrBlock!.y + HR_HEIGHT + expectedGap);
  });

  it("HR block lines is empty (leaf node — no inline content)", () => {
    const layout = layoutDocument(fullDoc(hr()), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      fontConfig: fullFontConfig,
    });
    const block = layout.pages[0]!.blocks[0]!;
    expect(block.lines).toHaveLength(0);
  });
});

// ── List item spacing ─────────────────────────────────────────────────────────

describe("layoutDocument — list item spacing", () => {
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
    const layout = layoutDocument(fullDoc(bulletList("First item", "Second item")), {
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
    const layout = layoutDocument(fullDoc(bulletList("Only item"), fullP("After")), {
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

describe("layoutDocument — measureCache", () => {
  it("produces identical layout output when a cache is provided", () => {
    const cache = new WeakMap<object, MeasureCacheEntry>();
    const baseDoc = doc(p("Hello"), p("World"));
    const opts = { pageConfig: defaultPageConfig, measurer: createMeasurer() };

    const withoutCache = layoutDocument(baseDoc, opts);
    const withCache    = layoutDocument(baseDoc, { ...opts, measureCache: cache });

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
    layoutDocument(testDoc, { pageConfig: defaultPageConfig, measurer: createMeasurer(), measureCache: cache });
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
    const trueLayout = layoutDocument(testDoc, opts);
    const trueFirstHeight = trueLayout.pages[0]!.blocks[0]!.height;
    const trueSecondY     = trueLayout.pages[0]!.blocks[1]!.y;

    // Corrupt the first paragraph's cache entry — double the height
    const firstNode = testDoc.firstChild!;
    const realEntry = cache.get(firstNode)!;
    cache.set(firstNode, { ...realEntry, height: realEntry.height * 2 });

    // Second run with same doc — the first block should use the inflated height
    const cachedLayout = layoutDocument(testDoc, opts);
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
    const layout1 = layoutDocument(doc1, opts);
    const block2_1 = layout1.pages[0]!.blocks[1]!;
    expect(block2_1.lines[0]!.spans[0]!.docPos).toBe(block2_1.nodePos + 1);

    // Second layout — para2 is the same Node object (structural sharing) but its
    // nodePos has shifted by 6 (from 3 to 9). The cache must return adjusted docPos.
    const layout2 = layoutDocument(doc2, opts);
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

    const layoutNarrow = layoutDocument(testDoc, { pageConfig: narrow, measurer, measureCache: cache });
    const layoutWide   = layoutDocument(testDoc, { pageConfig: wide,   measurer, measureCache: cache });

    // Both runs should succeed and the cached entry should reflect the wide config
    expect(layoutNarrow.pages[0]!.blocks[0]!.availableWidth).toBe(360); // 400 - 20 - 20
    expect(layoutWide.pages[0]!.blocks[0]!.availableWidth).toBe(660);   // 700 - 20 - 20
  });
});

// ── Phase 1b: early termination ───────────────────────────────────────────────

describe("layoutDocument — Phase 1b early termination", () => {
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
    const layout1 = layoutDocument(doc1, opts);

    // Second layout — para2 and para3 are same Node objects; second layout
    // should copy from layout1 via early termination.
    const layout2 = layoutDocument(doc2, { ...opts, previousLayout: layout1 });

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

    const layout1 = layoutDocument(doc1, opts);
    const layout2 = layoutDocument(doc2, { ...opts, previousLayout: layout1 });

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
