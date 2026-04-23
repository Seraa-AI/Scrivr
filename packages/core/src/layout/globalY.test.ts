/**
 * Global-Y float pipeline tests.
 *
 * Tests the constraint solver invariants, not pixels.
 * Structured in tiers: deterministic edge cases → adversarial → invariants.
 */
import { describe, it, expect } from "vitest";
import {
  assignGlobalY,
  recomputeGlobalY,
  resolveFloatsGlobalY,
  reflowConstrainedBlocks,
  updateFloatAnchors,
  collapseMargins,
  buildBlockFlow,
  collectLayoutItems,
  defaultPageConfig,
} from "./PageLayout";
import type { FlowBlock, FloatLayout } from "./PageLayout";
import { ExclusionManager } from "./ExclusionManager";
import { defaultFontConfig } from "./FontConfig";
import {
  buildStarterKitContext,
  createMeasurer,
  paragraph as p,
  doc,
  pageBreak,
  MOCK_LINE_HEIGHT,
} from "../test-utils";

// ── Helpers ──────────────────────────────────────────────────────────────────

const { margins } = defaultPageConfig;
const contentWidth = defaultPageConfig.pageWidth - margins.left - margins.right;

/** Build FlowBlocks from a doc via the real pipeline (position-independent). */
function buildFlows(document: ReturnType<typeof doc>) {
  const { fontConfig } = buildStarterKitContext();
  const items = collectLayoutItems(document, fontConfig);
  const result = buildBlockFlow(
    items, 0,
    { margins, contentWidth },
    fontConfig,
    createMeasurer(),
    undefined,
    undefined,
  );
  return result.flows;
}

/** Create a minimal FlowBlock stub for unit tests. */
function stubFlow(opts: {
  height: number;
  spaceBefore?: number;
  spaceAfter?: number;
  isPageBreak?: true;
  hasFloatAnchor?: boolean;
}): FlowBlock {
  return {
    node: null as never,
    nodePos: 0,
    lines: [],
    height: opts.height,
    spaceBefore: opts.spaceBefore ?? 0,
    spaceAfter: opts.spaceAfter ?? 0,
    availableWidth: contentWidth,
    blockType: "paragraph",
    align: "left",
    indentLeft: 0,
    hasFloatAnchor: opts.hasFloatAnchor ?? false,
    inputHash: 0,
    wasCacheHit: false,
    ...(opts.isPageBreak ? { isPageBreak: true as const } : {}),
  };
}

// ── assignGlobalY ────────────────────────────────────────────────────────────

describe("assignGlobalY", () => {
  it("stamps globalY on a single block at startY", () => {
    const flows = [stubFlow({ height: 50 })];
    assignGlobalY(flows, 72);
    expect(flows[0]!.globalY).toBe(72);
  });

  it("stacks two blocks with margin collapsing", () => {
    const flows = [
      stubFlow({ height: 50, spaceAfter: 10 }),
      stubFlow({ height: 30, spaceBefore: 15 }),
    ];
    assignGlobalY(flows, 0);
    expect(flows[0]!.globalY).toBe(0);
    // gap = max(10, 15) = 15
    expect(flows[1]!.globalY).toBe(50 + 15);
  });

  it("first block has no gap (isFirst = true)", () => {
    const flows = [stubFlow({ height: 50, spaceBefore: 20 })];
    assignGlobalY(flows, 100);
    expect(flows[0]!.globalY).toBe(100); // no gap on first block
  });

  it("page break gets globalY but no height contribution", () => {
    const flows = [
      stubFlow({ height: 50 }),
      stubFlow({ height: 0, isPageBreak: true }),
      stubFlow({ height: 30 }),
    ];
    assignGlobalY(flows, 0);
    expect(flows[0]!.globalY).toBe(0);
    expect(flows[1]!.globalY).toBe(50); // page break at y=50
    expect(flows[2]!.globalY).toBe(50); // next block starts at same Y (page break has no height)
  });

  it("cumulative: three blocks stack correctly", () => {
    const flows = [
      stubFlow({ height: 100, spaceAfter: 5 }),
      stubFlow({ height: 80, spaceBefore: 10, spaceAfter: 20 }),
      stubFlow({ height: 60, spaceBefore: 8 }),
    ];
    assignGlobalY(flows, 10);
    expect(flows[0]!.globalY).toBe(10);
    // gap1 = max(5, 10) = 10
    expect(flows[1]!.globalY).toBe(10 + 100 + 10);
    // gap2 = max(20, 8) = 20
    expect(flows[2]!.globalY).toBe(120 + 80 + 20);
  });
});

// ── recomputeGlobalY ─────────────────────────────────────────────────────────

describe("recomputeGlobalY", () => {
  it("recomputes downstream only after height change", () => {
    const flows = [
      stubFlow({ height: 50, spaceAfter: 5 }),
      stubFlow({ height: 30, spaceBefore: 10, spaceAfter: 0 }),
      stubFlow({ height: 40, spaceBefore: 0 }),
    ];
    assignGlobalY(flows, 0);

    // Simulate a height change on block 1
    flows[1]!.height = 60; // was 30

    recomputeGlobalY(flows, 2); // only recompute from index 2
    // Block 0 unchanged
    expect(flows[0]!.globalY).toBe(0);
    // Block 1 unchanged (we only recompute from index 2)
    expect(flows[1]!.globalY).toBe(60); // original value
    // Block 2: prev = block1 at globalY=60, height=60, gap = max(0, 0) = 0
    expect(flows[2]!.globalY).toBe(60 + 60);
  });

  it("is a no-op for startIndex 0 or beyond length", () => {
    const flows = [stubFlow({ height: 50 })];
    assignGlobalY(flows, 10);
    recomputeGlobalY(flows, 0);
    expect(flows[0]!.globalY).toBe(10);
    recomputeGlobalY(flows, 5);
    expect(flows[0]!.globalY).toBe(10);
  });
});

// ── ExclusionManager global-Y mode ───────────────────────────────────────────

describe("ExclusionManager — global-Y mode", () => {
  it("getConstraint without page skips page filter", () => {
    const mgr = new ExclusionManager();
    mgr.addRect({
      x: 72, right: 280, y: 100, bottom: 300,
      side: "left", docPos: 1,
    });

    const c = mgr.getConstraint(undefined, 150, 18, 72, 650);
    expect(c).not.toBeNull();
    expect(c!.x).toBeGreaterThan(0);
  });

  it("getConstraint with page still filters", () => {
    const mgr = new ExclusionManager();
    mgr.addRect({
      page: 1,
      x: 72, right: 280, y: 100, bottom: 300,
      side: "left", docPos: 1,
    });

    // Page 1: should find it
    expect(mgr.getConstraint(1, 150, 18, 72, 650)).not.toBeNull();
    // Page 2: should not find it
    expect(mgr.getConstraint(2, 150, 18, 72, 650)).toBeNull();
  });

  it("hasExclusionsInRange detects overlap", () => {
    const mgr = new ExclusionManager();
    mgr.addRect({
      x: 0, right: 100, y: 200, bottom: 400,
      side: "left", docPos: 1,
    });

    expect(mgr.hasExclusionsInRange(100, 300)).toBe(true);
    expect(mgr.hasExclusionsInRange(400, 500)).toBe(false);
    expect(mgr.hasExclusionsInRange(0, 200)).toBe(false);
  });
});

// ── resolveFloatsGlobalY ─────────────────────────────────────────────────────

describe("resolveFloatsGlobalY", () => {
  it("returns null when no floats exist", () => {
    const flows = [stubFlow({ height: 50 })];
    assignGlobalY(flows, 72);
    const result = resolveFloatsGlobalY(flows, margins, defaultPageConfig.pageWidth, contentWidth, []);
    expect(result).toBeNull();
  });

  it("places a single float at anchor globalY", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const longText = "word ".repeat(60).trim();
    const img = schema.nodes["image"]!.create({ src: "", width: 200, height: 200, wrappingMode: "square-left" });
    const para = schema.node("paragraph", null, [img, schema.text(longText)]);
    const document = schema.node("doc", null, [para]);

    const items = collectLayoutItems(document, fontConfig);
    const { flows } = buildBlockFlow(
      items, 0,
      { margins, contentWidth },
      fontConfig,
      createMeasurer(),
      undefined, undefined,
    );
    assignGlobalY(flows, margins.top);

    const result = resolveFloatsGlobalY(flows, margins, defaultPageConfig.pageWidth, contentWidth, []);
    expect(result).not.toBeNull();
    expect(result!.floats).toHaveLength(1);
    expect(result!.floats[0]!.globalY).toBeDefined();
    expect(result!.floats[0]!.globalY).toBeGreaterThanOrEqual(margins.top);
  });

  it("two same-side floats do not overlap (stacking)", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const longText = "word ".repeat(40).trim();
    const img1 = schema.nodes["image"]!.create({ src: "", width: 200, height: 150, wrappingMode: "square-left" });
    const img2 = schema.nodes["image"]!.create({ src: "", width: 200, height: 150, wrappingMode: "square-left" });
    const para1 = schema.node("paragraph", null, [img1, schema.text(longText)]);
    const para2 = schema.node("paragraph", null, [img2, schema.text(longText)]);
    const document = schema.node("doc", null, [para1, para2]);

    const items = collectLayoutItems(document, fontConfig);
    const { flows } = buildBlockFlow(
      items, 0,
      { margins, contentWidth },
      fontConfig,
      createMeasurer(),
      undefined, undefined,
    );
    assignGlobalY(flows, margins.top);

    const result = resolveFloatsGlobalY(flows, margins, defaultPageConfig.pageWidth, contentWidth, []);
    expect(result).not.toBeNull();
    const [f1, f2] = result!.floats;
    // Second float must be below first (no overlap)
    expect(f2!.globalY!).toBeGreaterThanOrEqual(f1!.globalY! + f1!.height);
  });

  it("page break barrier pushes float below break", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const img = schema.nodes["image"]!.create({ src: "", width: 200, height: 200, wrappingMode: "square-left" });
    const para = schema.node("paragraph", null, [img, schema.text("hello")]);
    const document = schema.node("doc", null, [para]);

    const items = collectLayoutItems(document, fontConfig);
    const { flows } = buildBlockFlow(
      items, 0,
      { margins, contentWidth },
      fontConfig,
      createMeasurer(),
      undefined, undefined,
    );
    assignGlobalY(flows, margins.top);

    // Place a page break barrier at y=100 — float anchor is at margins.top (72)
    // Float height 200 would extend past 100, so it should be pushed to 100
    const result = resolveFloatsGlobalY(flows, margins, defaultPageConfig.pageWidth, contentWidth, [100]);
    expect(result).not.toBeNull();
    const float = result!.floats[0]!;
    expect(float.globalY!).toBeGreaterThanOrEqual(100);
  });
});

// ── Global invariants ────────────────────────────────────────────────────────

describe("Global-Y invariants", () => {
  it("monotonic Y: no block has globalY less than its predecessor", () => {
    const flows = [
      stubFlow({ height: 50, spaceAfter: 10 }),
      stubFlow({ height: 30, spaceBefore: 5 }),
      stubFlow({ height: 80, spaceBefore: 0 }),
      stubFlow({ height: 20, spaceBefore: 15 }),
    ];
    assignGlobalY(flows, 0);

    for (let i = 1; i < flows.length; i++) {
      expect(flows[i]!.globalY!).toBeGreaterThanOrEqual(flows[i - 1]!.globalY!);
    }
  });

  it("no overlap: each block starts at or after the previous ends", () => {
    const flows = [
      stubFlow({ height: 50, spaceAfter: 10 }),
      stubFlow({ height: 30, spaceBefore: 5 }),
      stubFlow({ height: 80, spaceBefore: 0 }),
    ];
    assignGlobalY(flows, 0);

    for (let i = 1; i < flows.length; i++) {
      const prev = flows[i - 1]!;
      const curr = flows[i]!;
      expect(curr.globalY!).toBeGreaterThanOrEqual(prev.globalY! + prev.height);
    }
  });

  it("floats obey downward gravity (globalY >= anchorY)", () => {
    const { schema, fontConfig } = buildStarterKitContext();
    const longText = "word ".repeat(40).trim();
    const img = schema.nodes["image"]!.create({ src: "", width: 200, height: 200, wrappingMode: "square-left" });
    const para = schema.node("paragraph", null, [img, schema.text(longText)]);
    const document = schema.node("doc", null, [para]);

    const items = collectLayoutItems(document, fontConfig);
    const { flows } = buildBlockFlow(
      items, 0,
      { margins, contentWidth },
      fontConfig,
      createMeasurer(),
      undefined, undefined,
    );
    assignGlobalY(flows, margins.top);

    const result = resolveFloatsGlobalY(flows, margins, defaultPageConfig.pageWidth, contentWidth, []);
    if (result) {
      for (const float of result.floats) {
        expect(float.globalY!).toBeGreaterThanOrEqual(float.anchorBlockY);
      }
    }
  });

  it("stability: assignGlobalY is idempotent", () => {
    const flows = [
      stubFlow({ height: 50, spaceAfter: 10 }),
      stubFlow({ height: 30, spaceBefore: 5 }),
    ];
    assignGlobalY(flows, 72);
    const first = flows.map((f) => f.globalY);

    assignGlobalY(flows, 72);
    const second = flows.map((f) => f.globalY);

    expect(first).toEqual(second);
  });

  it("determinism: same inputs produce same globalY", () => {
    const makeFlows = () => [
      stubFlow({ height: 50, spaceAfter: 10 }),
      stubFlow({ height: 30, spaceBefore: 5 }),
      stubFlow({ height: 80, spaceBefore: 0 }),
    ];

    const a = makeFlows();
    const b = makeFlows();
    assignGlobalY(a, 72);
    assignGlobalY(b, 72);

    expect(a.map((f) => f.globalY)).toEqual(b.map((f) => f.globalY));
  });
});

// ── reflowConstrainedBlocks ──────────────────────────────────────────────────

describe("reflowConstrainedBlocks", () => {
  it("returns changed: false when no exclusions exist", () => {
    const flows = [stubFlow({ height: 50 })];
    assignGlobalY(flows, 0);
    const mgr = new ExclusionManager();

    const { changed } = reflowConstrainedBlocks(
      flows, mgr, margins, contentWidth,
      createMeasurer(), defaultFontConfig,
    );
    expect(changed).toBe(false);
  });
});

