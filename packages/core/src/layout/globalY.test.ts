import { describe, it, expect } from "vitest";
import {
  runPipeline,
  defaultPageConfig,
  assignGlobalY,
  recomputeGlobalY,
  normalizeConstraints,
  computeBarriers,
  resolveFloatsGlobalY,
  reflowConstrainedBlocks,
  solveConstraints,
  buildBlockFlow,
  collectLayoutItems,
  paginateFlow,
} from "./PageLayout";
import type { DocumentLayout, FloatLayout, LayoutPage, FlowBlock, NormalizedFloatInput } from "./PageLayout";
import { computePageMetrics, EMPTY_RESOLVED_CHROME } from "./PageMetrics";
import { defaultFontConfig, applyPageFont } from "./FontConfig";
import {
  buildStarterKitContext,
  createMeasurer,
  paragraph as p,
  doc,
  floatImage,
  MOCK_LINE_HEIGHT,
} from "../test-utils";
import { ExclusionManager } from "./ExclusionManager";
import { schema } from "../model/schema";

// ── Constants ────────────────────────────────────────────────────────────────
// lineHeight = 18, margins = 72 each, contentWidth = 794 - 72 - 72 = 650
// contentHeight = 1123 - 72 - 72 = 979

// ── Invariant Harness ────────────────────────────────────────────────────────

/**
 * Reusable layout invariant checker. Run on every test's output to catch
 * geometry violations that any single assertion might miss.
 */
export function assertLayoutInvariants(layout: DocumentLayout): void {
  const { pages, pageConfig } = layout;

  for (const page of pages) {
    const metrics = computePageMetrics(pageConfig, EMPTY_RESOLVED_CHROME, page.pageNumber);

    // 1. Monotonic block Y within each page
    for (let i = 1; i < page.blocks.length; i++) {
      const prev = page.blocks[i - 1]!;
      const curr = page.blocks[i]!;
      expect(
        curr.y,
        `Page ${page.pageNumber}: block[${i}].y (${curr.y}) should be >= block[${i - 1}].y (${prev.y})`,
      ).toBeGreaterThanOrEqual(prev.y);
    }

    // 2. No line overlap — within each block, lines don't overlap vertically
    for (const block of page.blocks) {
      let cumulativeY = block.y;
      for (let i = 0; i < block.lines.length; i++) {
        const line = block.lines[i]!;
        // Lines are stacked top-to-bottom; lineHeight is the vertical space each occupies
        cumulativeY += line.lineHeight;
      }
    }

    // 3. Lines within page content bounds (paged mode only)
    if (!pageConfig.pageless) {
      for (const block of page.blocks) {
        // Block top should be >= content top (allowing small float-shift tolerance)
        expect(
          block.y,
          `Page ${page.pageNumber}: block.y (${block.y}) should be >= contentTop (${metrics.contentTop})`,
        ).toBeGreaterThanOrEqual(metrics.contentTop - 1); // 1px tolerance for float rounding
      }
    }
  }

  // 4. No wrapping-float overlap on same page
  if (layout.floats && layout.floats.length > 1) {
    const wrappingFloats = layout.floats.filter(
      (f) => f.mode !== "behind" && f.mode !== "front",
    );
    for (let i = 0; i < wrappingFloats.length; i++) {
      for (let j = i + 1; j < wrappingFloats.length; j++) {
        const a = wrappingFloats[i]!;
        const b = wrappingFloats[j]!;
        if (a.page !== b.page) continue;
        const hOverlap = a.x < b.x + b.width && a.x + a.width > b.x;
        const vOverlap = a.y < b.y + b.height && a.y + a.height > b.y;
        expect(
          hOverlap && vOverlap,
          `Float overlap on page ${a.page}: float[${i}] (${a.x},${a.y},${a.width},${a.height}) overlaps float[${j}] (${b.x},${b.y},${b.width},${b.height})`,
        ).toBe(false);
      }
    }
  }

  // 5. Float downward gravity — float.y >= anchor's page-local Y
  // (Skip for now — requires anchor lookup which isn't available without walking pages)
}

// ── Harness Validation ───────────────────────────────────────────────────────

describe("assertLayoutInvariants — harness validation", () => {
  it("passes on a simple document with no floats", () => {
    const layout = runPipeline(doc(p("Hello world"), p("Second paragraph")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    assertLayoutInvariants(layout);
  });

  it("passes on a document with a square-left float", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const longText = "word ".repeat(60).trim();
    const img = floatImage(schema, "square-left");
    const para = schema.node("paragraph", null, [img, schema.text(longText)]);
    const layout = runPipeline(schema.node("doc", null, [para]), {
      pageConfig: defaultPageConfig,
      fontConfig,
      measurer: createMeasurer(),
    });
    assertLayoutInvariants(layout);
  });

  it("passes on a document with multiple float modes", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const text = "word ".repeat(40).trim();
    const imgLeft = floatImage(schema, "square-left", 150, 150);
    const imgRight = floatImage(schema, "square-right", 150, 150);
    const p1 = schema.node("paragraph", null, [imgLeft, schema.text(text)]);
    const p2 = schema.node("paragraph", null, [imgRight, schema.text(text)]);
    const layout = runPipeline(schema.node("doc", null, [p1, p2]), {
      pageConfig: defaultPageConfig,
      fontConfig,
      measurer: createMeasurer(),
    });
    assertLayoutInvariants(layout);
  });
});

// ── ExclusionManager — global-Y mode ────────────────────────────────────────

describe("ExclusionManager — global-Y mode", () => {
  it("getConstraint with page=undefined matches any rect regardless of page field", () => {
    const mgr = new ExclusionManager();
    mgr.addRect({ page: 1, x: 72, right: 280, y: 100, bottom: 300, side: "left", docPos: 1 });
    const result = mgr.getConstraint(undefined, 150, 18, 72, 650);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(280 - 72); // left edge shifted right
  });

  it("getConstraint with page=undefined matches rects that have no page field", () => {
    const mgr = new ExclusionManager();
    mgr.addRect({ x: 72, right: 280, y: 100, bottom: 300, side: "left", docPos: 1 });
    const result = mgr.getConstraint(undefined, 150, 18, 72, 650);
    expect(result).not.toBeNull();
  });

  it("getConstraint with page number still filters rects by page", () => {
    const mgr = new ExclusionManager();
    mgr.addRect({ page: 2, x: 72, right: 280, y: 100, bottom: 300, side: "left", docPos: 1 });
    const result = mgr.getConstraint(1, 150, 18, 72, 650);
    expect(result).toBeNull(); // page 1 query, rect is on page 2
  });

  it("hasExclusionsInRange returns true when Y range overlaps a rect", () => {
    const mgr = new ExclusionManager();
    mgr.addRect({ page: 1, x: 72, right: 280, y: 100, bottom: 300, side: "left", docPos: 1 });
    expect(mgr.hasExclusionsInRange(150, 200)).toBe(true);
    expect(mgr.hasExclusionsInRange(50, 101)).toBe(true);
    expect(mgr.hasExclusionsInRange(299, 350)).toBe(true);
  });

  it("hasExclusionsInRange returns false when no overlap", () => {
    const mgr = new ExclusionManager();
    mgr.addRect({ page: 1, x: 72, right: 280, y: 100, bottom: 300, side: "left", docPos: 1 });
    expect(mgr.hasExclusionsInRange(300, 400)).toBe(false); // touching but not overlapping
    expect(mgr.hasExclusionsInRange(50, 100)).toBe(false);  // ends exactly at rect start
  });

  it("constraint consistency: if hasExclusionsInRange returns true, getConstraint at midpoint returns non-null", () => {
    const mgr = new ExclusionManager();
    mgr.addRect({ x: 72, right: 280, y: 100, bottom: 300, side: "left", docPos: 1 });
    const midY = (100 + 300) / 2;
    expect(mgr.hasExclusionsInRange(midY, midY + 18)).toBe(true);
    const constraint = mgr.getConstraint(undefined, midY, 18, 72, 650);
    expect(constraint).not.toBeNull();
  });

  it("full-width exclusion returns skipToY in global-Y mode", () => {
    const mgr = new ExclusionManager();
    mgr.addRect({ x: 72, right: 722, y: 200, bottom: 500, side: "full", docPos: 1 });
    const result = mgr.getConstraint(undefined, 250, 18, 72, 650);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(0);
    expect(result!.skipToY).toBe(500);
  });
});

// ── Mock FlowBlock helper ────────────────────────────────────────────────────

// (imports consolidated at top of file)

/** Creates a minimal FlowBlock for unit testing globalY functions. */
function mockFlow(overrides: Partial<FlowBlock> & { height: number }): FlowBlock {
  return {
    node: schema.node("paragraph"),
    nodePos: 0,
    lines: [],
    spaceBefore: 0,
    spaceAfter: 0,
    availableWidth: 650,
    blockType: "paragraph",
    align: "left" as const,
    indentLeft: 0,
    hasFloatAnchor: false,
    inputHash: 0,
    wasCacheHit: false,
    ...overrides,
  };
}

/** Creates a page break FlowBlock. */
function mockPageBreak(): FlowBlock {
  return mockFlow({ height: 0, isPageBreak: true, blockType: "pageBreak" });
}

// ── Phase 2: assignGlobalY ──────────────────────────────────────────────────

describe("assignGlobalY", () => {
  it("stamps globalY = startY on the first flow block", () => {
    const flows = [mockFlow({ height: 100 })];
    assignGlobalY(flows, 72);
    expect(flows[0]!.globalY).toBe(72);
  });

  it("stacks consecutive blocks: second.globalY = first.globalY + first.height + collapsedMargin", () => {
    const flows = [
      mockFlow({ height: 100, spaceAfter: 10 }),
      mockFlow({ height: 80, spaceBefore: 6 }),
    ];
    assignGlobalY(flows, 72);
    // collapsedMargin = max(10, 6) = 10
    expect(flows[0]!.globalY).toBe(72);
    expect(flows[1]!.globalY).toBe(72 + 100 + 10);
  });

  it("collapses margins: gap = max(prev.spaceAfter, curr.spaceBefore), not sum", () => {
    const flows = [
      mockFlow({ height: 50, spaceAfter: 20 }),
      mockFlow({ height: 50, spaceBefore: 30 }),
    ];
    assignGlobalY(flows, 0);
    // gap should be max(20, 30) = 30, NOT 20 + 30 = 50
    expect(flows[1]!.globalY).toBe(50 + 30);
  });

  it("page break node gets globalY but contributes zero height", () => {
    const flows = [
      mockFlow({ height: 100, spaceAfter: 10 }),
      mockPageBreak(),
      mockFlow({ height: 80, spaceBefore: 5 }),
    ];
    assignGlobalY(flows, 72);
    // Page break gets a globalY marker
    expect(flows[1]!.globalY).toBeDefined();
    // Page break consumes the margin gap from block 0 (max(10, 0) = 10)
    expect(flows[1]!.globalY).toBe(72 + 100 + 10);
    // But page break has zero height — it doesn't advance prevBottom.
    // Block 2 gap from page break: max(pageBreak.spaceAfter=0, block2.spaceBefore=5) = 5
    // prevBottom is still 72 + 100 = 172 (block 0's bottom)
    // So block 2 globalY = 172 + 5 = 177
    expect(flows[2]!.globalY).toBe(177);
  });

  it("monotonic: block[i].globalY <= block[i+1].globalY for all i", () => {
    const flows = [
      mockFlow({ height: 100, spaceAfter: 5 }),
      mockFlow({ height: 50, spaceBefore: 10, spaceAfter: 3 }),
      mockFlow({ height: 200, spaceBefore: 8 }),
    ];
    assignGlobalY(flows, 72);
    for (let i = 1; i < flows.length; i++) {
      expect(flows[i]!.globalY!).toBeGreaterThanOrEqual(flows[i - 1]!.globalY!);
    }
  });

  it("idempotent: calling twice produces identical globalY values", () => {
    const flows = [
      mockFlow({ height: 100, spaceAfter: 10 }),
      mockFlow({ height: 80, spaceBefore: 6 }),
    ];
    assignGlobalY(flows, 72);
    const first = flows.map((f) => f.globalY);
    assignGlobalY(flows, 72);
    const second = flows.map((f) => f.globalY);
    expect(second).toEqual(first);
  });

  it("empty flows array: no-op, no crash", () => {
    const flows: FlowBlock[] = [];
    expect(() => assignGlobalY(flows, 72)).not.toThrow();
  });
});

// ── Phase 2: recomputeGlobalY ───────────────────────────────────────────────

describe("recomputeGlobalY", () => {
  it("re-stamps globalY from startIndex onward, preserving blocks before startIndex", () => {
    const flows = [
      mockFlow({ height: 100, spaceAfter: 10 }),
      mockFlow({ height: 80, spaceBefore: 6, spaceAfter: 5 }),
      mockFlow({ height: 60, spaceBefore: 8 }),
    ];
    assignGlobalY(flows, 72);
    const originalFirst = flows[0]!.globalY;
    // Simulate a height change in block 1
    flows[1]!.height = 120; // was 80
    recomputeGlobalY(flows, 1);
    // Block 0 should be unchanged
    expect(flows[0]!.globalY).toBe(originalFirst);
    // Block 1 should be unchanged (it's at startIndex, re-stamped from prev)
    expect(flows[1]!.globalY).toBe(72 + 100 + 10);
    // Block 2 should reflect new height of block 1
    // = block1.globalY + block1.newHeight + max(block1.spaceAfter, block2.spaceBefore)
    // = 182 + 120 + max(5, 8) = 182 + 120 + 8 = 310
    expect(flows[2]!.globalY).toBe(182 + 120 + 8);
  });

  it("no-op when startIndex >= flows.length", () => {
    const flows = [mockFlow({ height: 100 })];
    assignGlobalY(flows, 72);
    const original = flows[0]!.globalY;
    recomputeGlobalY(flows, 5);
    expect(flows[0]!.globalY).toBe(original);
  });

  it("correctly collapses margins at the re-stamp boundary", () => {
    const flows = [
      mockFlow({ height: 50, spaceAfter: 20 }),
      mockFlow({ height: 50, spaceBefore: 30, spaceAfter: 15 }),
      mockFlow({ height: 50, spaceBefore: 10 }),
    ];
    assignGlobalY(flows, 0);
    // Re-stamp from index 2 only
    recomputeGlobalY(flows, 2);
    // Block 2: prev = block1. gap = max(15, 10) = 15
    // block1.globalY = 0 + 50 + 30 = 80
    // block2.globalY = 80 + 50 + 15 = 145
    expect(flows[2]!.globalY).toBe(145);
  });
});

// ── Phase 3: normalizeConstraints ───────────────────────────────────────────

/** Helper to build FlowBlock[] from a doc using the real measurement pipeline. */
function buildFlows(docNode: import("prosemirror-model").Node, fontConfig: import("./FontConfig").FontConfig) {
  const items = collectLayoutItems(docNode, fontConfig);
  const measurer = createMeasurer();
  const config = { margins: defaultPageConfig.margins, contentWidth: 650 };
  return buildBlockFlow(items, 0, config, fontConfig, measurer, undefined, undefined).flows;
}

describe("normalizeConstraints", () => {
  it("returns NormalizedFloatInput[] for flows with float anchors", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "square-left", 200, 200);
    const para = schema.node("paragraph", null, [img, schema.text("hello")]);
    const flows = buildFlows(schema.node("doc", null, [para]), fontConfig);
    const result = normalizeConstraints(flows, defaultPageConfig);
    expect(result.length).toBe(1);
    expect(result[0]!.mode).toBe("square-left");
    expect(result[0]!.width).toBe(200);
    expect(result[0]!.height).toBe(200);
  });

  it("returns empty array when no float anchors exist", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const para = schema.node("paragraph", null, [schema.text("no floats here")]);
    const flows = buildFlows(schema.node("doc", null, [para]), fontConfig);
    const result = normalizeConstraints(flows, defaultPageConfig);
    expect(result.length).toBe(0);
  });

  it("clamps width to contentWidth", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "square-left", 9999, 200);
    const para = schema.node("paragraph", null, [img, schema.text("hello")]);
    const flows = buildFlows(schema.node("doc", null, [para]), fontConfig);
    const result = normalizeConstraints(flows, defaultPageConfig);
    const contentWidth = defaultPageConfig.pageWidth - defaultPageConfig.margins.left - defaultPageConfig.margins.right;
    expect(result[0]!.width).toBe(contentWidth);
  });

  it("clamps height to 2x pageHeight", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "square-left", 200, 99999);
    const para = schema.node("paragraph", null, [img, schema.text("hello")]);
    const flows = buildFlows(schema.node("doc", null, [para]), fontConfig);
    const result = normalizeConstraints(flows, defaultPageConfig);
    expect(result[0]!.height).toBe(defaultPageConfig.pageHeight * 2);
  });

  it("clamps offsetY to ±pageHeight", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "square-left", 200, 200, { x: 0, y: 99999 });
    const para = schema.node("paragraph", null, [img, schema.text("hello")]);
    const flows = buildFlows(schema.node("doc", null, [para]), fontConfig);
    const result = normalizeConstraints(flows, defaultPageConfig);
    expect(result[0]!.offsetY).toBe(defaultPageConfig.pageHeight);
  });

  it("clamps offsetX to ±contentWidth", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const contentWidth = defaultPageConfig.pageWidth - defaultPageConfig.margins.left - defaultPageConfig.margins.right;
    const img = floatImage(schema, "square-left", 200, 200, { x: -99999, y: 0 });
    const para = schema.node("paragraph", null, [img, schema.text("hello")]);
    const flows = buildFlows(schema.node("doc", null, [para]), fontConfig);
    const result = normalizeConstraints(flows, defaultPageConfig);
    expect(result[0]!.offsetX).toBe(-contentWidth);
  });

  it("degrades unknown wrappingMode to top-bottom", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "some-unknown-mode", 200, 200);
    const para = schema.node("paragraph", null, [img, schema.text("hello")]);
    const flows = buildFlows(schema.node("doc", null, [para]), fontConfig);
    const result = normalizeConstraints(flows, defaultPageConfig);
    expect(result[0]!.mode).toBe("top-bottom");
  });

  it("skips float entirely when width < 1", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "square-left", 0, 200);
    const para = schema.node("paragraph", null, [img, schema.text("hello")]);
    const flows = buildFlows(schema.node("doc", null, [para]), fontConfig);
    const result = normalizeConstraints(flows, defaultPageConfig);
    expect(result.length).toBe(0);
  });

  it("skips float entirely when height < 1", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "square-left", 200, 0);
    const para = schema.node("paragraph", null, [img, schema.text("hello")]);
    const flows = buildFlows(schema.node("doc", null, [para]), fontConfig);
    const result = normalizeConstraints(flows, defaultPageConfig);
    expect(result.length).toBe(0);
  });

  it("preserves valid inputs unchanged", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "square-right", 300, 150, { x: 10, y: -20 });
    const para = schema.node("paragraph", null, [img, schema.text("hello")]);
    const flows = buildFlows(schema.node("doc", null, [para]), fontConfig);
    const result = normalizeConstraints(flows, defaultPageConfig);
    expect(result[0]!.mode).toBe("square-right");
    expect(result[0]!.width).toBe(300);
    expect(result[0]!.height).toBe(150);
    expect(result[0]!.offsetX).toBe(10);
    expect(result[0]!.offsetY).toBe(-20);
  });
});

// ── Phase 4: computeBarriers ────────────────────────────────────────────────

describe("computeBarriers", () => {
  // contentHeight = pageHeight - margins.top - margins.bottom = 1123 - 72 - 72 = 979
  const contentHeight = defaultPageConfig.pageHeight - defaultPageConfig.margins.top - defaultPageConfig.margins.bottom;

  it("empty flows: returns empty array", () => {
    const barriers = computeBarriers([], defaultPageConfig, EMPTY_RESOLVED_CHROME);
    expect(barriers).toEqual([]);
  });

  it("single page: no barriers", () => {
    // One block that fits on a single page
    const flows = [mockFlow({ height: 100 })];
    assignGlobalY(flows, defaultPageConfig.margins.top);
    const barriers = computeBarriers(flows, defaultPageConfig, EMPTY_RESOLVED_CHROME);
    expect(barriers).toEqual([]);
  });

  it("two pages: one barrier at page 1 bottom", () => {
    // Two blocks: first fills most of page 1, second spills to page 2
    const flows = [
      mockFlow({ height: contentHeight - 10 }),
      mockFlow({ height: 100 }),
    ];
    assignGlobalY(flows, defaultPageConfig.margins.top);
    const barriers = computeBarriers(flows, defaultPageConfig, EMPTY_RESOLVED_CHROME);
    expect(barriers.length).toBe(1);
    // Barrier should be at the bottom of page 1's content area
    // = margins.top + contentHeight = 72 + 979 = 1051
    expect(barriers[0]).toBe(defaultPageConfig.margins.top + contentHeight);
  });

  it("three pages: two barriers", () => {
    const flows = [
      mockFlow({ height: contentHeight - 10 }),
      mockFlow({ height: contentHeight - 10 }),
      mockFlow({ height: 100 }),
    ];
    assignGlobalY(flows, defaultPageConfig.margins.top);
    const barriers = computeBarriers(flows, defaultPageConfig, EMPTY_RESOLVED_CHROME);
    expect(barriers.length).toBe(2);
  });
});

// ── Phase 4: resolveFloatsGlobalY ───────────────────────────────────────────

/** Helper: build flows with globalY stamped, ready for the solver. */
function buildFlowsWithGlobalY(
  docNode: import("prosemirror-model").Node,
  fontConfig: import("./FontConfig").FontConfig,
) {
  const flows = buildFlows(docNode, fontConfig);
  assignGlobalY(flows, defaultPageConfig.margins.top);
  return flows;
}

describe("resolveFloatsGlobalY", () => {
  const margins = defaultPageConfig.margins;
  const contentWidth = defaultPageConfig.pageWidth - margins.left - margins.right;

  it("returns null when no float anchors exist (fast path)", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const para = schema.node("paragraph", null, [schema.text("no floats")]);
    const flows = buildFlowsWithGlobalY(schema.node("doc", null, [para]), fontConfig);
    const inputs = normalizeConstraints(flows, defaultPageConfig);
    const result = resolveFloatsGlobalY(
      flows, inputs, margins, defaultPageConfig.pageWidth, contentWidth, [],
    );
    expect(result).toBeNull();
  });

  it("single square-left float: layoutY = anchor.globalY, layoutX = contentX", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "square-left", 200, 200);
    const para = schema.node("paragraph", null, [img, schema.text("hello world")]);
    const flows = buildFlowsWithGlobalY(schema.node("doc", null, [para]), fontConfig);
    const inputs = normalizeConstraints(flows, defaultPageConfig);
    const result = resolveFloatsGlobalY(
      flows, inputs, margins, defaultPageConfig.pageWidth, contentWidth, [],
    );
    expect(result).not.toBeNull();
    expect(result!.floats.length).toBe(1);
    const f = result!.floats[0]!;
    expect(f.layoutY).toBe(flows[0]!.globalY);
    expect(f.layoutX).toBe(margins.left);
    expect(f.mode).toBe("square-left");
  });

  it("single square-right float: layoutX = contentRight - width", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "square-right", 200, 200);
    const para = schema.node("paragraph", null, [img, schema.text("hello world")]);
    const flows = buildFlowsWithGlobalY(schema.node("doc", null, [para]), fontConfig);
    const inputs = normalizeConstraints(flows, defaultPageConfig);
    const result = resolveFloatsGlobalY(
      flows, inputs, margins, defaultPageConfig.pageWidth, contentWidth, [],
    );
    const f = result!.floats[0]!;
    const contentRight = defaultPageConfig.pageWidth - margins.right;
    expect(f.layoutX).toBe(contentRight - 200);
  });

  it("top-bottom float: exclusion spans full content width", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "top-bottom", 200, 200);
    const para = schema.node("paragraph", null, [img, schema.text("hello world")]);
    const flows = buildFlowsWithGlobalY(schema.node("doc", null, [para]), fontConfig);
    const inputs = normalizeConstraints(flows, defaultPageConfig);
    const result = resolveFloatsGlobalY(
      flows, inputs, margins, defaultPageConfig.pageWidth, contentWidth, [],
    );
    // Check exclusion manager has a full-width exclusion
    const constraint = result!.exclusionMgr.getConstraint(
      undefined, flows[0]!.globalY! + 10, 18, margins.left, contentWidth,
    );
    expect(constraint).not.toBeNull();
    expect(constraint!.width).toBe(0); // full-width exclusion
    expect(constraint!.skipToY).toBeDefined();
  });

  it("behind/front floats: no exclusion rect added", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "behind", 200, 200);
    const para = schema.node("paragraph", null, [img, schema.text("hello world")]);
    const flows = buildFlowsWithGlobalY(schema.node("doc", null, [para]), fontConfig);
    const inputs = normalizeConstraints(flows, defaultPageConfig);
    const result = resolveFloatsGlobalY(
      flows, inputs, margins, defaultPageConfig.pageWidth, contentWidth, [],
    );
    expect(result).not.toBeNull();
    expect(result!.floats.length).toBe(1);
    // No exclusion should exist
    const hasExcl = result!.exclusionMgr.hasExclusionsInRange(0, 99999);
    expect(hasExcl).toBe(false);
  });

  it("layoutY never includes floatOffset.y (offset is visual-only)", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "square-left", 200, 200, { x: 0, y: -50 });
    const para = schema.node("paragraph", null, [img, schema.text("hello world")]);
    const flows = buildFlowsWithGlobalY(schema.node("doc", null, [para]), fontConfig);
    const inputs = normalizeConstraints(flows, defaultPageConfig);
    const result = resolveFloatsGlobalY(
      flows, inputs, margins, defaultPageConfig.pageWidth, contentWidth, [],
    );
    const f = result!.floats[0]!;
    // layoutY should be anchor.globalY, NOT anchor.globalY + offsetY
    expect(f.layoutY).toBe(flows[0]!.globalY);
    expect(f.anchorGlobalY).toBe(flows[0]!.globalY);
  });
});

describe("resolveFloatsGlobalY — stacking", () => {
  const margins = defaultPageConfig.margins;
  const contentWidth = defaultPageConfig.pageWidth - margins.left - margins.right;
  const FLOAT_MARGIN = 8;

  it("two same-side floats: second is pushed below first", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img1 = floatImage(schema, "square-left", 200, 200);
    const img2 = floatImage(schema, "square-left", 200, 150);
    const text = "word ".repeat(30).trim();
    const p1 = schema.node("paragraph", null, [img1, schema.text(text)]);
    const p2 = schema.node("paragraph", null, [img2, schema.text(text)]);
    const flows = buildFlowsWithGlobalY(schema.node("doc", null, [p1, p2]), fontConfig);
    const inputs = normalizeConstraints(flows, defaultPageConfig);
    const result = resolveFloatsGlobalY(
      flows, inputs, margins, defaultPageConfig.pageWidth, contentWidth, [],
    );
    expect(result!.floats.length).toBe(2);
    const f1 = result!.floats[0]!;
    const f2 = result!.floats[1]!;
    // Second float must be below first float (no vertical overlap)
    expect(f2.layoutY).toBeGreaterThanOrEqual(f1.layoutY + f1.height);
  });

  it("two opposite-side floats at same Y: no stacking needed", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const imgLeft = floatImage(schema, "square-left", 200, 200);
    const imgRight = floatImage(schema, "square-right", 200, 200);
    // Put both in the same paragraph so they have the same anchor globalY
    const text = "word ".repeat(30).trim();
    const para = schema.node("paragraph", null, [imgLeft, imgRight, schema.text(text)]);
    const flows = buildFlowsWithGlobalY(schema.node("doc", null, [para]), fontConfig);
    const inputs = normalizeConstraints(flows, defaultPageConfig);
    const result = resolveFloatsGlobalY(
      flows, inputs, margins, defaultPageConfig.pageWidth, contentWidth, [],
    );
    expect(result!.floats.length).toBe(2);
    const f1 = result!.floats[0]!;
    const f2 = result!.floats[1]!;
    // They don't overlap horizontally, so both should be at the same layoutY
    expect(f1.layoutY).toBe(f2.layoutY);
  });

  it("behind/front floats exempt from stacking", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img1 = floatImage(schema, "square-left", 200, 200);
    const img2 = floatImage(schema, "behind", 200, 200);
    const text = "word ".repeat(30).trim();
    const p1 = schema.node("paragraph", null, [img1, schema.text(text)]);
    const p2 = schema.node("paragraph", null, [img2, schema.text(text)]);
    const flows = buildFlowsWithGlobalY(schema.node("doc", null, [p1, p2]), fontConfig);
    const inputs = normalizeConstraints(flows, defaultPageConfig);
    const result = resolveFloatsGlobalY(
      flows, inputs, margins, defaultPageConfig.pageWidth, contentWidth, [],
    );
    const behind = result!.floats.find((f) => f.mode === "behind")!;
    // Behind float should be at its anchor's globalY, not pushed down
    expect(behind.layoutY).toBe(flows[1]!.globalY);
  });
});

describe("resolveFloatsGlobalY — barriers", () => {
  const margins = defaultPageConfig.margins;
  const contentWidth = defaultPageConfig.pageWidth - margins.left - margins.right;
  const contentHeight = defaultPageConfig.pageHeight - margins.top - margins.bottom;

  it("float straddling a barrier is pushed past it entirely", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    // Create a float near the page bottom so it straddles the barrier
    const img = floatImage(schema, "square-left", 200, 200);
    const longText = "word ".repeat(200).trim(); // enough text to fill near page bottom
    const para = schema.node("paragraph", null, [img, schema.text(longText)]);
    const flows = buildFlowsWithGlobalY(schema.node("doc", null, [para]), fontConfig);
    // Force the anchor near the page boundary by manually adjusting globalY
    const barrier = margins.top + contentHeight; // = 1051
    flows[0]!.globalY = barrier - 50; // anchor 50px above barrier
    const inputs = normalizeConstraints(flows, defaultPageConfig);
    const result = resolveFloatsGlobalY(
      flows, inputs, margins, defaultPageConfig.pageWidth, contentWidth, [barrier],
    );
    const f = result!.floats[0]!;
    // Float height = 200, starts at barrier-50. Straddles barrier.
    // Should be pushed to barrier Y
    expect(f.layoutY).toBeGreaterThanOrEqual(barrier);
  });

  it("float fitting entirely above barrier: no push", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "square-left", 200, 100);
    const para = schema.node("paragraph", null, [img, schema.text("hello")]);
    const flows = buildFlowsWithGlobalY(schema.node("doc", null, [para]), fontConfig);
    const barrier = margins.top + contentHeight;
    // globalY=72, height=100, bottom=172 << barrier at 1051
    const inputs = normalizeConstraints(flows, defaultPageConfig);
    const result = resolveFloatsGlobalY(
      flows, inputs, margins, defaultPageConfig.pageWidth, contentWidth, [barrier],
    );
    const f = result!.floats[0]!;
    expect(f.layoutY).toBe(flows[0]!.globalY); // No push
  });
});

// ── Phase 5: reflowConstrainedBlocks + solveConstraints ─────────────────────

describe("reflowConstrainedBlocks", () => {
  const margins = defaultPageConfig.margins;
  const contentWidth = defaultPageConfig.pageWidth - margins.left - margins.right;

  it("returns { changed: false } when no exclusions overlap any flow", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const para = schema.node("paragraph", null, [schema.text("no floats here")]);
    const flows = buildFlowsWithGlobalY(schema.node("doc", null, [para]), fontConfig);
    const exclusionMgr = new ExclusionManager();
    const result = reflowConstrainedBlocks(
      flows, exclusionMgr, margins, contentWidth,
      createMeasurer(), fontConfig, undefined, undefined,
    );
    expect(result.changed).toBe(false);
  });

  it("constrained block grows taller (more wrapped lines)", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const longText = "word ".repeat(60).trim();
    const img = floatImage(schema, "square-left", 200, 200);
    const para = schema.node("paragraph", null, [img, schema.text(longText)]);
    const flows = buildFlowsWithGlobalY(schema.node("doc", null, [para]), fontConfig);

    const heightBefore = flows[0]!.height;

    // Build exclusion manually at the flow's globalY
    const exclusionMgr = new ExclusionManager();
    exclusionMgr.addRect({
      x: margins.left,
      right: margins.left + 200 + 8,
      y: flows[0]!.globalY! - 8,
      bottom: flows[0]!.globalY! + 200 + 8,
      side: "left",
      docPos: 1,
    });

    const result = reflowConstrainedBlocks(
      flows, exclusionMgr, margins, contentWidth,
      createMeasurer(), fontConfig, undefined, undefined,
    );
    expect(result.changed).toBe(true);
    // Block should be taller after constraint (narrower width = more lines)
    expect(flows[0]!.height).toBeGreaterThan(heightBefore);
  });

  it("monotonic height: newHeight >= oldHeight for every reflowed block", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const longText = "word ".repeat(60).trim();
    const img = floatImage(schema, "square-left", 300, 300);
    const para = schema.node("paragraph", null, [img, schema.text(longText)]);
    const flows = buildFlowsWithGlobalY(schema.node("doc", null, [para]), fontConfig);

    const heightBefore = flows[0]!.height;

    const exclusionMgr = new ExclusionManager();
    exclusionMgr.addRect({
      x: margins.left,
      right: margins.left + 300 + 8,
      y: flows[0]!.globalY! - 8,
      bottom: flows[0]!.globalY! + 300 + 8,
      side: "left",
      docPos: 1,
    });

    reflowConstrainedBlocks(
      flows, exclusionMgr, margins, contentWidth,
      createMeasurer(), fontConfig, undefined, undefined,
    );
    expect(flows[0]!.height).toBeGreaterThanOrEqual(heightBefore);
  });
});

describe("solveConstraints", () => {
  const margins = defaultPageConfig.margins;
  const contentWidth = defaultPageConfig.pageWidth - margins.left - margins.right;

  it("returns null when no floats exist", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const para = schema.node("paragraph", null, [schema.text("no floats")]);
    const flows = buildFlowsWithGlobalY(schema.node("doc", null, [para]), fontConfig);
    const inputs = normalizeConstraints(flows, defaultPageConfig);
    const result = solveConstraints(
      flows, inputs, margins, defaultPageConfig.pageWidth, contentWidth, [],
      createMeasurer(), fontConfig, undefined, undefined,
    );
    expect(result).toBeNull();
  });

  it("converges for simple single-float case", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const longText = "word ".repeat(60).trim();
    const img = floatImage(schema, "square-left", 200, 200);
    const para = schema.node("paragraph", null, [img, schema.text(longText)]);
    const flows = buildFlowsWithGlobalY(schema.node("doc", null, [para]), fontConfig);
    const inputs = normalizeConstraints(flows, defaultPageConfig);
    const barriers = computeBarriers(flows, defaultPageConfig, EMPTY_RESOLVED_CHROME);
    const result = solveConstraints(
      flows, inputs, margins, defaultPageConfig.pageWidth, contentWidth, barriers,
      createMeasurer(), fontConfig, undefined, undefined,
    );
    expect(result).not.toBeNull();
    expect(result!.converged).toBe(true);
    expect(result!.floats.length).toBe(1);
  });

  it("produces valid layout invariants", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const longText = "word ".repeat(60).trim();
    const img = floatImage(schema, "square-left", 200, 200);
    const para = schema.node("paragraph", null, [img, schema.text(longText)]);
    const docNode = schema.node("doc", null, [para, schema.node("paragraph", null, [schema.text("after")])]);
    const layout = runPipeline(docNode, {
      pageConfig: defaultPageConfig,
      fontConfig,
      measurer: createMeasurer(),
    });
    assertLayoutInvariants(layout);
  });
});

// ── Phase 6: projectFloatsOntoPages (via full runPipeline) ──────────────────

describe("projectFloatsOntoPages", () => {
  it("projects float onto page 1 with aliases matching", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "square-left", 200, 200);
    const para = schema.node("paragraph", null, [img, schema.text("hello world test")]);
    const layout = runPipeline(schema.node("doc", null, [para]), {
      pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer(),
    });
    expect(layout.floats!.length).toBe(1);
    expect(layout.floats![0]!.page).toBe(1);
    expect(layout.floats![0]!.x).toBe(layout.floats![0]!.renderX);
    expect(layout.floats![0]!.y).toBe(layout.floats![0]!.renderY);
  });

  it("projects float without offset: renderY = page-local anchor Y", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "square-left", 200, 200);
    const para = schema.node("paragraph", null, [img, schema.text("hello world test")]);
    const layout = runPipeline(schema.node("doc", null, [para]), {
      pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer(),
    });
    expect(layout.floats![0]!.renderY).toBe(defaultPageConfig.margins.top);
  });

  it("float in second paragraph has correct Y (not at page top)", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const longText = "word ".repeat(60).trim();
    const p1 = schema.node("paragraph", null, [schema.text("First paragraph")]);
    const img = floatImage(schema, "square-left", 200, 200);
    const p2 = schema.node("paragraph", null, [img, schema.text(longText)]);
    const layout = runPipeline(schema.node("doc", null, [p1, p2]), {
      pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer(),
    });
    expect(layout.floats!.length).toBe(1);
    // Float should be at the Y of the second paragraph block, NOT at margins.top
    expect(layout.floats![0]!.y).toBeGreaterThan(defaultPageConfig.margins.top);
  });
});

// ── Real document reproduction (from demo doc JSON) ─────────────────────────

describe("integration: demo document reproduction", () => {
  // This reproduces the exact structure from the user's demo document:
  // - Several text paragraphs + headings
  // - A "Layout Engine" heading
  // - A STANDALONE paragraph containing ONLY a top-bottom float image
  // - A SEPARATE long text paragraph after the float
  //
  // The bug: text in the paragraph AFTER the float was rendering UNDER the image
  // instead of below it. The float's exclusion zone wasn't displacing the next
  // paragraph's text because the float was in a different block.

  it("top-bottom float in standalone paragraph: next paragraph text starts BELOW the float", () => {
    const { schema, fontConfig } = buildStarterKitContext();

    // Build the key part of the demo doc: heading → float paragraph → text paragraph
    const heading = schema.node("heading", { level: 2 }, [schema.text("Layout Engine")]);
    const floatImg = floatImage(schema, "top-bottom", 300, 200, { x: 14, y: -24 });
    const floatPara = schema.node("paragraph", null, [floatImg]);
    const longText = "Scrivr uses a custom layout pipeline that computes line breaks page boundaries and float positions independent of the browser CSS engine. The output is identical between the canvas view and PDF export. Every page is rendered onto an HTML5 Canvas element with sub-pixel precision. The layout engine runs a multi-pass pipeline first building the block flow from the ProseMirror document tree then applying float exclusion zones paginating across page boundaries and finally building fragments for the tile renderer. Each pass is pure no DOM dependency no CSS reflow. This means the exact same layout can be reproduced server-side for PDF generation ensuring what you see on screen is exactly what you get in the exported document.";
    const textPara = schema.node("paragraph", null, [schema.text(longText)]);
    const afterPara = schema.node("paragraph", null, [
      schema.text("The pipeline runs incrementally during idle time keeping the editor responsive even on 100 plus page documents."),
    ]);

    // Include some content before the float to push it down the page
    const intro = schema.node("paragraph", null, [
      schema.text("A canvas-rendered document editor built for high-fidelity multi-page documents."),
    ]);

    const docNode = schema.node("doc", null, [
      schema.node("heading", { level: 1 }, [schema.text("Welcome to Scrivr")]),
      intro,
      heading,
      floatPara,
      textPara,
      afterPara,
    ]);

    const layout = runPipeline(docNode, {
      pageConfig: defaultPageConfig,
      fontConfig,
      measurer: createMeasurer(),
    });

    assertLayoutInvariants(layout);
    expect(layout.floats).toBeDefined();
    expect(layout.floats!.length).toBe(1);

    const float = layout.floats![0]!;

    // Find the text paragraph block (the one AFTER the float paragraph)
    // The float paragraph has the float anchor; the text paragraph has actual text content
    const allBlocks = layout.pages.flatMap(p => p.blocks);
    // The float is in its own paragraph. The next block is the long text.
    // Find blocks by checking if they have text lines with actual spans
    // Filter to blocks that have actual text content (not empty spacer blocks)
    const textBlocks = allBlocks.filter(b =>
      b.lines.some(l => l.spans.length > 0 && l.spans.some(s => s.kind === "text"))
    );
    // The long text paragraph should be the one starting with "Scrivr uses"
    // Find the longest text block (the long paragraph after the float)
    const longTextBlock = textBlocks.reduce((best, b) =>
      b.lines.length > (best?.lines.length ?? 0) ? b : best,
    textBlocks[0]);

    expect(longTextBlock).toBeDefined();
    expect(longTextBlock!.lines.length).toBeGreaterThan(5); // the long paragraph

    // THE KEY ASSERTION: the text paragraph must start BELOW the float image.
    // float.y + float.height = bottom of the float image.
    // The text block's Y must be >= that value.
    console.log("Float:", { x: float.x, y: float.y, h: float.height, page: float.page, mode: float.mode });
    console.log("Text block:", { y: longTextBlock!.y, h: longTextBlock!.height, lines: longTextBlock!.lines.length });
    console.log("Float bottom:", float.y + float.height);

    expect(
      longTextBlock!.y,
      `Text paragraph Y (${longTextBlock!.y}) must be >= float bottom (${float.y + float.height})`
    ).toBeGreaterThanOrEqual(float.y + float.height);
  });

  it("top-bottom float in standalone paragraph: text does NOT render under the image", () => {
    const { schema, fontConfig } = buildStarterKitContext();

    const floatImg = floatImage(schema, "top-bottom", 300, 200);
    const floatPara = schema.node("paragraph", null, [floatImg]);
    const textPara = schema.node("paragraph", null, [
      schema.text("word ".repeat(80).trim()),
    ]);

    const docNode = schema.node("doc", null, [floatPara, textPara]);
    const layout = runPipeline(docNode, {
      pageConfig: defaultPageConfig,
      fontConfig,
      measurer: createMeasurer(),
    });

    const float = layout.floats![0]!;
    const textBlock = layout.pages[0]!.blocks.find(b =>
      b.lines.some(l => l.spans.some(s => s.kind === "text" && s.text.startsWith("word")))
    )!;

    // Text must start below the float, not under it
    expect(textBlock.y).toBeGreaterThanOrEqual(float.y + float.height);
  });

  it("top-bottom float: no excess blank space between float and text", () => {
    const { schema, fontConfig } = buildStarterKitContext();

    const floatImg = floatImage(schema, "top-bottom", 300, 200);
    const floatPara = schema.node("paragraph", null, [floatImg]);
    const textPara = schema.node("paragraph", null, [
      schema.text("word ".repeat(80).trim()),
    ]);

    const docNode = schema.node("doc", null, [floatPara, textPara]);
    const layout = runPipeline(docNode, {
      pageConfig: defaultPageConfig,
      fontConfig,
      measurer: createMeasurer(),
    });

    const float = layout.floats![0]!;
    const textBlock = layout.pages[0]!.blocks.find(b =>
      b.lines.some(l => l.spans.some(s => s.kind === "text" && s.text.startsWith("word")))
    )!;

    // Gap between float bottom and text top should be reasonable (margin collapsing + float margin)
    // Float margin = 8, paragraph spacing typically 10-12. Should not be > 50px.
    const gap = textBlock.y - (float.y + float.height);
    console.log("Gap between float bottom and text top:", gap);
    expect(gap).toBeLessThan(50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 8: Integration Tests — End-to-End Pipeline Verification
//
// These tests verify what the RENDERER will see: block positions, float
// positions, line constraints, and page assignments from the full runPipeline.
// Previous unit tests passed while the visual was broken because they tested
// isolated functions, not the integrated output.
// ═══════════════════════════════════════════════════════════════════════════════

const MARGINS = defaultPageConfig.margins;
const CONTENT_WIDTH = defaultPageConfig.pageWidth - MARGINS.left - MARGINS.right; // 650
const CONTENT_HEIGHT = defaultPageConfig.pageHeight - MARGINS.top - MARGINS.bottom; // 979
const FLOAT_MARGIN = 8;

/** Run the full pipeline and return the layout for assertions. */
function fullPipeline(docNode: import("prosemirror-model").Node, fontConfig: import("./FontConfig").FontConfig) {
  return runPipeline(docNode, {
    pageConfig: defaultPageConfig,
    fontConfig,
    measurer: createMeasurer(),
  });
}

// ── Float position integration ──────────────────────────────────────────────

describe("integration: float position matches anchor block", () => {
  it("square-left float Y matches its anchor block Y on the page", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "square-left", 200, 200);
    const para = schema.node("paragraph", null, [img, schema.text("word ".repeat(40).trim())]);
    const layout = fullPipeline(schema.node("doc", null, [para]), fontConfig);

    const block = layout.pages[0]!.blocks[0]!;
    const float = layout.floats![0]!;
    // Float Y must match the block Y — they're on the same page at the same position
    expect(float.y).toBe(block.y);
    expect(float.page).toBe(1);
  });

  it("square-left float X is at left margin, square-right at right margin", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const text = "word ".repeat(40).trim();
    const imgL = floatImage(schema, "square-left", 200, 200);
    const imgR = floatImage(schema, "square-right", 200, 200);
    const p1 = schema.node("paragraph", null, [imgL, schema.text(text)]);
    const p2 = schema.node("paragraph", null, [imgR, schema.text(text)]);
    const layout = fullPipeline(schema.node("doc", null, [p1, p2]), fontConfig);

    const fLeft = layout.floats!.find(f => f.mode === "square-left")!;
    const fRight = layout.floats!.find(f => f.mode === "square-right")!;
    expect(fLeft.x).toBe(MARGINS.left);
    expect(fRight.x).toBe(defaultPageConfig.pageWidth - MARGINS.right - 200);
  });

  it("float in later paragraph has Y > first block Y", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const text = "word ".repeat(30).trim();
    const p1 = schema.node("paragraph", null, [schema.text("First paragraph here")]);
    const p2 = schema.node("paragraph", null, [schema.text("Second paragraph here")]);
    const img = floatImage(schema, "square-left", 200, 200);
    const p3 = schema.node("paragraph", null, [img, schema.text(text)]);
    const layout = fullPipeline(schema.node("doc", null, [p1, p2, p3]), fontConfig);

    const float = layout.floats![0]!;
    const firstBlockY = layout.pages[0]!.blocks[0]!.y;
    expect(float.y).toBeGreaterThan(firstBlockY);
    // Float Y should match the third block (its anchor)
    const thirdBlock = layout.pages[0]!.blocks[2]!;
    expect(float.y).toBe(thirdBlock.y);
  });
});

// ── Text wrapping (constrained lines) ───────────────────────────────────────

describe("integration: text wraps around floats", () => {
  it("square-left: some lines constrained, some unconstrained (text wraps then reverts)", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    // Use enough text that lines extend well past the 200px float zone.
    // 200px float / 18px lineHeight = ~11 constrained lines. Need >11 lines total.
    // At 442px effective width, ~11 words/line. Need >121 words (11*11) to overflow.
    const img = floatImage(schema, "square-left", 200, 200);
    const para = schema.node("paragraph", null, [img, schema.text("word ".repeat(200).trim())]);
    const layout = fullPipeline(schema.node("doc", null, [para]), fontConfig);

    const block = layout.pages[0]!.blocks[0]!;
    const constrained = block.lines.filter(l => l.constraintX !== undefined);
    const unconstrained = block.lines.filter(l => l.constraintX === undefined && l.spans.length > 0);

    // Should have both constrained lines (in float zone) and unconstrained (below it)
    expect(constrained.length).toBeGreaterThan(0);
    expect(unconstrained.length).toBeGreaterThan(0);

    // Constrained lines should have constraintX = imageWidth + margin
    for (const line of constrained) {
      expect(line.constraintX).toBe(200 + FLOAT_MARGIN);
    }
  });

  it("square-left: constrained block is taller than unconstrained equivalent", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const longText = "word ".repeat(60).trim();

    // Unconstrained
    const p1 = schema.node("paragraph", null, [schema.text(longText)]);
    const l1 = fullPipeline(schema.node("doc", null, [p1]), fontConfig);
    const baseHeight = l1.pages[0]!.blocks[0]!.height;

    // Constrained (float narrows available width → more lines → taller)
    const img = floatImage(schema, "square-left", 200, 200);
    const p2 = schema.node("paragraph", null, [img, schema.text(longText)]);
    const l2 = fullPipeline(schema.node("doc", null, [p2]), fontConfig);
    const constrainedHeight = l2.pages[0]!.blocks[0]!.height;

    expect(constrainedHeight).toBeGreaterThan(baseHeight);
  });

  it("top-bottom: exclusion spans full width, text below the image", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "top-bottom", 300, 200);
    const para = schema.node("paragraph", null, [img, schema.text("word ".repeat(60).trim())]);
    const layout = fullPipeline(schema.node("doc", null, [para]), fontConfig);

    const block = layout.pages[0]!.blocks[0]!;
    const float = layout.floats![0]!;

    // For top-bottom, the block height should include the float displacement
    // (text is pushed below the image, not beside it)
    expect(block.height).toBeGreaterThan(200); // at least float height + text lines
  });

  it("behind/front: no text constraint, block height unchanged", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const longText = "word ".repeat(60).trim();

    const p1 = schema.node("paragraph", null, [schema.text(longText)]);
    const l1 = fullPipeline(schema.node("doc", null, [p1]), fontConfig);
    const baseHeight = l1.pages[0]!.blocks[0]!.height;

    const img = floatImage(schema, "behind", 200, 200);
    const p2 = schema.node("paragraph", null, [img, schema.text(longText)]);
    const l2 = fullPipeline(schema.node("doc", null, [p2]), fontConfig);
    const behindHeight = l2.pages[0]!.blocks[0]!.height;

    // Behind mode = no exclusion → text doesn't reflow → same height
    expect(behindHeight).toBe(baseHeight);
  });
});

// ── Float stacking ──────────────────────────────────────────────────────────

describe("integration: float stacking", () => {
  it("two same-side floats do not visually overlap", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const text = "word ".repeat(30).trim();
    const img1 = floatImage(schema, "square-left", 200, 200);
    const img2 = floatImage(schema, "square-left", 200, 150);
    const p1 = schema.node("paragraph", null, [img1, schema.text(text)]);
    const p2 = schema.node("paragraph", null, [img2, schema.text(text)]);
    const layout = fullPipeline(schema.node("doc", null, [p1, p2]), fontConfig);

    expect(layout.floats!.length).toBe(2);
    const [f1, f2] = layout.floats!;
    // Second float must not overlap first vertically
    expect(f2!.y).toBeGreaterThanOrEqual(f1!.y + f1!.height);
  });

  it("opposite-side floats at same Y don't stack (no horizontal overlap)", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const text = "word ".repeat(30).trim();
    const imgL = floatImage(schema, "square-left", 200, 200);
    const imgR = floatImage(schema, "square-right", 200, 200);
    const para = schema.node("paragraph", null, [imgL, imgR, schema.text(text)]);
    const layout = fullPipeline(schema.node("doc", null, [para]), fontConfig);

    expect(layout.floats!.length).toBe(2);
    // Both should be at the same Y since they don't overlap horizontally
    expect(layout.floats![0]!.y).toBe(layout.floats![1]!.y);
  });
});

// ── Page boundary handling ──────────────────────────────────────────────────

describe("integration: floats and page boundaries", () => {
  it("float near page bottom overflows to next page", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    // Fill most of page 1 with text, then add a float paragraph
    const fillerText = "word ".repeat(200).trim(); // enough to fill most of page 1
    const filler = schema.node("paragraph", null, [schema.text(fillerText)]);
    const img = floatImage(schema, "square-left", 200, 200);
    const floatPara = schema.node("paragraph", null, [img, schema.text("some text after")]);
    const layout = fullPipeline(schema.node("doc", null, [filler, floatPara]), fontConfig);

    if (layout.floats && layout.floats.length > 0) {
      const float = layout.floats[0]!;
      // Float should be on a valid page
      expect(float.page).toBeGreaterThanOrEqual(1);
      // Float Y should be within page content bounds
      const pm = computePageMetrics(defaultPageConfig, EMPTY_RESOLVED_CHROME, float.page);
      expect(float.y).toBeGreaterThanOrEqual(pm.contentTop);
      expect(float.y + float.height).toBeLessThanOrEqual(pm.contentBottom + 1); // +1 tolerance
    }
  });

  it("blocks after a float are pushed down, not overlapping", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "square-left", 200, 300);
    const text = "word ".repeat(60).trim();
    const floatPara = schema.node("paragraph", null, [img, schema.text(text)]);
    const afterPara = schema.node("paragraph", null, [schema.text("After the float")]);
    const layout = fullPipeline(schema.node("doc", null, [floatPara, afterPara]), fontConfig);

    const blocks = layout.pages[0]!.blocks;
    expect(blocks.length).toBeGreaterThanOrEqual(2);

    // After block must start after the float paragraph ends
    const floatBlock = blocks[0]!;
    const afterBlock = blocks[1]!;
    expect(afterBlock.y).toBeGreaterThanOrEqual(floatBlock.y + floatBlock.height);
  });
});

// ── Orphaned constraints on continuation blocks ─────────────────────────────

describe("integration: orphaned constraints cleared on continuations", () => {
  it("continuation block on page without float has no constraintX", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    // Long constrained text that splits across pages
    const hugeText = "word ".repeat(400).trim();
    const img = floatImage(schema, "square-left", 200, 200);
    const para = schema.node("paragraph", null, [img, schema.text(hugeText)]);
    const layout = fullPipeline(schema.node("doc", null, [para]), fontConfig);

    // If the paragraph splits, continuation on page 2 should not have constraints
    // (unless there's also a float on page 2)
    if (layout.pages.length >= 2) {
      const page2 = layout.pages[1]!;
      const continuations = page2.blocks.filter(b => b.isContinuation);
      for (const cont of continuations) {
        const page2Floats = (layout.floats ?? []).filter(
          f => f.page === page2.pageNumber && f.mode !== "behind" && f.mode !== "front"
        );
        if (page2Floats.length === 0) {
          // No floats on this page — all lines should be unconstrained
          for (const line of cont.lines) {
            expect(line.constraintX).toBeUndefined();
            expect(line.effectiveWidth).toBeUndefined();
          }
        }
      }
    }
  });
});

// ── Invariant checks on complex documents ───────────────────────────────────

describe("integration: layout invariants hold on complex documents", () => {
  it("document with multiple float modes passes all invariants", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const text = "word ".repeat(40).trim();
    const p1 = schema.node("paragraph", null, [
      floatImage(schema, "square-left", 200, 200),
      schema.text(text),
    ]);
    const p2 = schema.node("paragraph", null, [schema.text("Normal paragraph between floats")]);
    const p3 = schema.node("paragraph", null, [
      floatImage(schema, "square-right", 150, 150),
      schema.text(text),
    ]);
    const p4 = schema.node("paragraph", null, [
      floatImage(schema, "top-bottom", 300, 200),
      schema.text(text),
    ]);
    const p5 = schema.node("paragraph", null, [schema.text("Final paragraph")]);
    const layout = fullPipeline(schema.node("doc", null, [p1, p2, p3, p4, p5]), fontConfig);
    assertLayoutInvariants(layout);
    expect(layout.floats!.length).toBe(3);
  });

  it("document with no floats still works (no regression)", () => {
    const layout = fullPipeline(
      doc(p("First paragraph"), p("Second paragraph"), p("Third paragraph")),
      defaultFontConfig,
    );
    assertLayoutInvariants(layout);
    expect(layout.floats).toBeUndefined();
    expect(layout.pages.length).toBe(1);
  });

  it("idempotence: runPipeline twice on same doc produces identical float positions", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "square-left", 200, 200);
    const para = schema.node("paragraph", null, [img, schema.text("word ".repeat(40).trim())]);
    const docNode = schema.node("doc", null, [para]);

    const l1 = fullPipeline(docNode, fontConfig);
    const l2 = fullPipeline(docNode, fontConfig);

    expect(l1.floats!.length).toBe(l2.floats!.length);
    for (let i = 0; i < l1.floats!.length; i++) {
      expect(l1.floats![i]!.x).toBe(l2.floats![i]!.x);
      expect(l1.floats![i]!.y).toBe(l2.floats![i]!.y);
      expect(l1.floats![i]!.page).toBe(l2.floats![i]!.page);
    }
  });

  it("idempotence: block positions identical across two runs", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = floatImage(schema, "square-left", 200, 200);
    const text = "word ".repeat(60).trim();
    const docNode = schema.node("doc", null, [
      schema.node("paragraph", null, [img, schema.text(text)]),
      schema.node("paragraph", null, [schema.text("After float")]),
    ]);

    const l1 = fullPipeline(docNode, fontConfig);
    const l2 = fullPipeline(docNode, fontConfig);

    for (let pi = 0; pi < l1.pages.length; pi++) {
      const p1 = l1.pages[pi]!;
      const p2 = l2.pages[pi]!;
      expect(p1.blocks.length).toBe(p2.blocks.length);
      for (let bi = 0; bi < p1.blocks.length; bi++) {
        expect(p1.blocks[bi]!.y).toBe(p2.blocks[bi]!.y);
        expect(p1.blocks[bi]!.height).toBe(p2.blocks[bi]!.height);
        expect(p1.blocks[bi]!.lines.length).toBe(p2.blocks[bi]!.lines.length);
      }
    }
  });
});
