import { describe, it, expect, afterEach } from "vitest";
import { runMiniPipeline } from "./runMiniPipeline";
import { runPipeline, defaultPageConfig, __setRunPipelineDepthForTest } from "./PageLayout";
import { createMeasurer, paragraph as p, heading, doc } from "../test-utils";

describe("runMiniPipeline", () => {
  describe("basic measurement", () => {
    it("measures a single paragraph mini-doc and returns one page", () => {
      const miniDoc = doc(p("Hello mini-world"));
      const layout = runMiniPipeline(miniDoc, {
        pageConfig: defaultPageConfig,
        measurer: createMeasurer(),
      });
      expect(layout.pages).toHaveLength(1);
      expect(layout.pages[0]!.blocks.length).toBeGreaterThan(0);
    });

    it("stacks multiple blocks on a single virtual page (pageless)", () => {
      // Build a mini-doc with enough blocks to overflow a standard page —
      // in runMiniPipeline this must still produce one page because
      // pageless is forced internally.
      const blocks = Array.from({ length: 60 }, (_, i) => p(`Line ${i + 1}`));
      const layout = runMiniPipeline(doc(...blocks), {
        pageConfig: defaultPageConfig,
        measurer: createMeasurer(),
      });
      expect(layout.pages).toHaveLength(1);
      expect(layout.pages[0]!.blocks.length).toBe(60);
    });

    it("totalContentHeight reflects the natural height of the mini-doc", () => {
      const layout = runMiniPipeline(doc(p("Just one line")), {
        pageConfig: defaultPageConfig,
        measurer: createMeasurer(),
      });
      // One paragraph at default font size should have a small, non-zero height.
      expect(layout.totalContentHeight).toBeGreaterThan(0);
      expect(layout.totalContentHeight).toBeLessThan(100);
    });

    it("natural height scales with the number of blocks", () => {
      // The mock measurer returns a constant lineHeight regardless of font
      // size, so heading-vs-paragraph comparisons don't show size differences
      // in tests. Instead we verify that adding more blocks increases the
      // natural height proportionally — which is the load-bearing property
      // for chrome-band height computation (more content → taller band).
      const oneBlock = runMiniPipeline(doc(p("Single")), {
        pageConfig: defaultPageConfig,
        measurer: createMeasurer(),
      });
      const threeBlocks = runMiniPipeline(doc(p("One"), p("Two"), p("Three")), {
        pageConfig: defaultPageConfig,
        measurer: createMeasurer(),
      });
      expect(threeBlocks.totalContentHeight).toBeGreaterThan(oneBlock.totalContentHeight);
      // Also exercise heading() so the import stays warm — heading renders
      // via the same flow path as paragraph, we just can't assert on the
      // height difference with the mock measurer.
      const withHeading = runMiniPipeline(doc(heading(1, "Title"), p("Body")), {
        pageConfig: defaultPageConfig,
        measurer: createMeasurer(),
      });
      expect(withHeading.pages[0]!.blocks.length).toBe(2);
    });
  });

  describe("DocumentLayout shape", () => {
    it("returns a minimal DocumentLayout with the measurement-only fields populated", () => {
      const layout = runMiniPipeline(doc(p("Test")), {
        pageConfig: defaultPageConfig,
        measurer: createMeasurer(),
      });

      // Fields that must be present
      expect(layout.pages).toBeDefined();
      expect(layout.pageConfig).toBeDefined();
      expect(layout.version).toBe(1);
      expect(layout.totalContentHeight).toBeGreaterThanOrEqual(0);
      expect(layout.metrics).toHaveLength(1);
      expect(layout.runId).toBe(0);
      expect(layout.convergence).toBe("stable");
      expect(layout.iterationCount).toBe(1);

      // Fields that should NOT be set for mini-docs
      expect(layout.fragments).toBeUndefined();
      expect(layout.fragmentsByPage).toBeUndefined();
      expect(layout.floats).toBeUndefined();
      expect(layout.isPartial).toBeFalsy();
      expect(layout.resumption).toBeUndefined();
    });

    it("forces pageless mode even when caller passes a paged PageConfig", () => {
      // defaultPageConfig is a paged config (pageless: false / undefined).
      // runMiniPipeline should force pageless internally.
      const layout = runMiniPipeline(doc(p("Force pageless")), {
        pageConfig: defaultPageConfig,
        measurer: createMeasurer(),
      });
      expect(layout.pageConfig.pageless).toBe(true);
    });

    it("metrics[0] matches computePageMetrics for page 1", () => {
      const layout = runMiniPipeline(doc(p("Check metrics")), {
        pageConfig: defaultPageConfig,
        measurer: createMeasurer(),
      });
      const m = layout.metrics![0]!;
      expect(m.pageNumber).toBe(1);
      // Pageless mode: contentBottom falls through to pageHeight (which may
      // be 0 for pagelessConfig or the actual pageHeight for a paged config
      // being forced pageless). Either way, contentTop equals margins.top.
      expect(m.contentTop).toBe(defaultPageConfig.margins.top);
    });
  });
});

describe("runPipeline recursion guard", () => {
  // Clean up any test-only depth manipulation after each test so we don't
  // leak state into subsequent tests.
  afterEach(() => {
    __setRunPipelineDepthForTest(0);
  });

  it("throws when runPipeline is called while already running", () => {
    // Simulate re-entry by artificially bumping the depth counter. In
    // production this happens when a chrome contributor's measure() hook
    // accidentally calls runPipeline instead of runMiniPipeline.
    __setRunPipelineDepthForTest(1);

    expect(() => {
      runPipeline(doc(p("Anything")), {
        pageConfig: defaultPageConfig,
        measurer: createMeasurer(),
      });
    }).toThrow(/recursive call detected/i);
  });

  it("error message points at runMiniPipeline as the fix", () => {
    __setRunPipelineDepthForTest(1);

    try {
      runPipeline(doc(p("Anything")), {
        pageConfig: defaultPageConfig,
        measurer: createMeasurer(),
      });
      expect.fail("expected runPipeline to throw");
    } catch (e) {
      // The error message should mention runMiniPipeline so future devs
      // who hit this know what to call instead.
      expect((e as Error).message).toMatch(/runMiniPipeline/);
      expect((e as Error).message).toMatch(/aggregateChrome/);
    }
  });

  it("normal runPipeline calls complete without tripping the guard", () => {
    // Sanity: ensure the guard doesn't spuriously fire on sequential calls.
    // Reset depth first in case prior test left it non-zero.
    __setRunPipelineDepthForTest(0);

    const layout1 = runPipeline(doc(p("First")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    expect(layout1.pages.length).toBeGreaterThanOrEqual(1);

    const layout2 = runPipeline(doc(p("Second")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    expect(layout2.pages.length).toBeGreaterThanOrEqual(1);
  });

  it("runMiniPipeline is NOT affected by the guard (can be called freely)", () => {
    // runMiniPipeline doesn't increment the depth counter because it
    // cannot call aggregateChrome. Multiple calls should be fine, even
    // when depth has been artificially bumped.
    __setRunPipelineDepthForTest(1);

    const layout = runMiniPipeline(doc(p("Inside chrome")), {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
    });
    expect(layout.pages).toHaveLength(1);
  });
});
