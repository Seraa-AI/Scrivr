import { describe, it, expect, vi, afterEach } from "vitest";
import { runChromeLoop } from "./aggregateChrome";
import {
  runPipeline,
  defaultPageConfig,
  type PageLayoutOptions,
  type DocumentLayout,
} from "./PageLayout";
import type {
  ChromeContribution,
  LayoutIterationContext,
  PageChromeContribution,
  PageChromeMeasureInput,
} from "./PageMetrics";
import { applyPageFont, defaultFontConfig, DEFAULT_FONT_FAMILY } from "./FontConfig";
import { createMeasurer, paragraph as p, doc } from "../test-utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildMeasureInput(docNode: ReturnType<typeof doc>): PageChromeMeasureInput {
  const measurer = createMeasurer();
  const fontConfig = applyPageFont(
    defaultFontConfig,
    defaultPageConfig.fontFamily ?? DEFAULT_FONT_FAMILY,
  );
  return { doc: docNode, pageConfig: defaultPageConfig, measurer, fontConfig };
}

function buildOptions(): PageLayoutOptions {
  return { pageConfig: defaultPageConfig, measurer: createMeasurer() };
}

// A contributor that always reports stable:true on iteration 1. Headers etc.
function stableContribution(
  name: string,
  top: number,
  bottom = 0,
  payload: unknown = { mark: 1 },
): PageChromeContribution {
  return {
    name,
    measure: (): ChromeContribution => ({
      topForPage: () => top,
      bottomForPage: () => bottom,
      stable: true,
      payload,
    }),
    render: () => {},
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LAYOUT_DEBUG__;
});

// ── Zero contributors ─────────────────────────────────────────────────────────

describe("runChromeLoop — zero contributors", () => {
  it("exits after one iteration with empty payloads + stable convergence", () => {
    const d = doc(p("hello"));
    const result = runChromeLoop(
      d, buildOptions(), [], 1, {}, null, buildMeasureInput(d),
    );
    expect(result.convergence).toBe("stable");
    expect(result.iterationCount).toBe(1);
    expect(result.chromePayloads).toEqual({});
    expect(result.resolved.contributions).toEqual({});
    expect(result.resolved.metricsVersion).toBe(0);
  });

  it("produces metrics matching the pre-chrome formula", () => {
    const d = doc(p("hello"));
    const result = runChromeLoop(
      d, buildOptions(), [], 1, {}, null, buildMeasureInput(d),
    );
    const m = result.flow.layout.metrics![0]!;
    expect(m.contentTop).toBe(defaultPageConfig.margins.top);
    expect(m.headerHeight).toBe(0);
    expect(m.footerHeight).toBe(0);
  });
});

// ── Single non-iterative contributor (header case) ────────────────────────────

describe("runChromeLoop — single stable contributor", () => {
  it("exits after iteration 1 and reserves top space", () => {
    const d = doc(p("hello"));
    const header = stableContribution("header", 30, 0, { rendered: "H" });
    const result = runChromeLoop(
      d, buildOptions(), [header], 1, {}, null, buildMeasureInput(d),
    );
    expect(result.iterationCount).toBe(1);
    expect(result.convergence).toBe("stable");
    expect(result.flow.layout.metrics![0]!.contentTop).toBe(
      defaultPageConfig.margins.top + 30,
    );
    expect(result.chromePayloads["header"]).toEqual({ rendered: "H" });
  });
});

// ── Iterative contributor converging at iteration 2 ───────────────────────────

describe("runChromeLoop — iterative convergence", () => {
  it("converges at iteration 2 when stability depends on previousIterationPayload", () => {
    const d = doc(p("hello"));
    const calls: LayoutIterationContext[] = [];
    const settling: PageChromeContribution = {
      name: "settling",
      measure: (_input, ctx) => {
        calls.push(ctx);
        // Iteration 1: no previous payload → unstable. Iteration 2: has it → stable.
        return {
          topForPage: () => 20,
          bottomForPage: () => 0,
          stable: ctx.previousIterationPayload !== null,
          payload: { iter: ctx.iteration },
        };
      },
      render: () => {},
    };
    const result = runChromeLoop(
      d, buildOptions(), [settling], 1, {}, null, buildMeasureInput(d),
    );
    expect(result.iterationCount).toBe(2);
    expect(result.convergence).toBe("stable");
    expect(calls[0]!.previousIterationPayload).toBeNull();
    expect(calls[1]!.previousIterationPayload).toEqual({ iter: 1 });
  });
});

// ── Exhaustion after MAX_ITERATIONS ───────────────────────────────────────────

describe("runChromeLoop — exhaustion", () => {
  it("gives up after 5 iterations and flags convergence 'exhausted'", () => {
    const d = doc(p("hello"));
    const neverStable: PageChromeContribution = {
      name: "never",
      measure: () => ({
        topForPage: () => 10,
        bottomForPage: () => 0,
        stable: false,
        payload: Math.random(),
      }),
      render: () => {},
    };
    const result = runChromeLoop(
      d, buildOptions(), [neverStable], 1, {}, null, buildMeasureInput(d),
    );
    expect(result.iterationCount).toBe(5);
    expect(result.convergence).toBe("exhausted");
    // Exhausted layout is still well-formed.
    expect(result.flow.layout.pages.length).toBeGreaterThan(0);
    expect(result.flow.layout.metrics![0]!.contentTop).toBe(
      defaultPageConfig.margins.top + 10,
    );
  });

  it("warns via console.warn when __LAYOUT_DEBUG__ is set", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    (globalThis as Record<string, unknown>).__LAYOUT_DEBUG__ = true;
    const d = doc(p("hello"));
    const neverStable: PageChromeContribution = {
      name: "loud",
      measure: () => ({
        topForPage: () => 1, bottomForPage: () => 0, stable: false, payload: {},
      }),
      render: () => {},
    };
    runChromeLoop(d, buildOptions(), [neverStable], 1, {}, null, buildMeasureInput(d));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatch(/convergence exhausted.*loud/);
    spy.mockRestore();
  });
});

// ── Two contributors stack correctly ──────────────────────────────────────────

describe("runChromeLoop — multi-contributor stacking", () => {
  it("stacks top+bottom reservations and routes payloads by name", () => {
    const d = doc(p("hello"));
    const header = stableContribution("header", 30, 0, { slot: "H" });
    const footer = stableContribution("footer", 0, 20, { slot: "F" });
    const result = runChromeLoop(
      d, buildOptions(), [header, footer], 1, {}, null, buildMeasureInput(d),
    );
    const m = result.flow.layout.metrics![0]!;
    expect(m.contentTop).toBe(defaultPageConfig.margins.top + 30);
    expect(m.contentBottom).toBe(
      defaultPageConfig.pageHeight - defaultPageConfig.margins.bottom - 20,
    );
    expect(result.chromePayloads).toEqual({
      header: { slot: "H" },
      footer: { slot: "F" },
    });
  });
});

// ── previousRunPayload seeds iteration 1 ──────────────────────────────────────

describe("runChromeLoop — previousRunPayload seeding", () => {
  it("exits in iteration 1 when previousRunPayload is available", () => {
    const d = doc(p("hello"));
    const seeded: PageChromeContribution = {
      name: "seeded",
      measure: (_input, ctx) => ({
        topForPage: () => 10,
        bottomForPage: () => 0,
        // Stable whenever any prior payload is available:
        //   Run 1: iter 1 null → unstable; iter 2 prevIteration set → stable.
        //   Run 2: iter 1 prevRun set → stable immediately.
        stable:
          ctx.previousIterationPayload !== null ||
          ctx.previousRunPayload !== null,
        payload: { seed: true },
      }),
      render: () => {},
    };

    // Run 1: no previousRunPayload → 2 iterations.
    const run1 = runChromeLoop(
      d, buildOptions(), [seeded], 1, {}, null, buildMeasureInput(d),
    );
    expect(run1.iterationCount).toBe(2);

    // Run 2: payload carried over → 1 iteration.
    const run2 = runChromeLoop(
      d, buildOptions(), [seeded], 2,
      { seeded: { seed: true } }, run1.flow.layout, buildMeasureInput(d),
    );
    expect(run2.iterationCount).toBe(1);
    expect(run2.convergence).toBe("stable");
  });
});

// ── currentFlowLayout null on iter 1, non-null on iter 2+ ─────────────────────

describe("runChromeLoop — currentFlowLayout context", () => {
  it("is null on iteration 1 and populated on iteration 2", () => {
    const d = doc(p("hello"));
    const observed: Array<DocumentLayout | null> = [];
    const probe: PageChromeContribution = {
      name: "probe",
      measure: (_input, ctx) => {
        observed.push(ctx.currentFlowLayout);
        return {
          topForPage: () => 5,
          bottomForPage: () => 0,
          stable: ctx.iteration >= 2,
          payload: ctx.iteration,
        };
      },
      render: () => {},
    };
    runChromeLoop(d, buildOptions(), [probe], 1, {}, null, buildMeasureInput(d));
    expect(observed[0]).toBeNull();
    expect(observed[1]).not.toBeNull();
    expect(observed[1]!.pages.length).toBeGreaterThan(0);
  });
});

// ── Recursion guard unaffected ────────────────────────────────────────────────

describe("runPipeline recursion guard — unaffected by aggregator loop", () => {
  it("does NOT raise depth when runChromeLoop iterates internally", () => {
    // Contributor that invokes runPipeline (forbidden) would trip the guard.
    // Here we just confirm runChromeLoop itself runs many iterations without
    // tripping the guard, because it calls runFlowPipeline directly, not runPipeline.
    const d = doc(p("hello"));
    const iterCount = { n: 0 };
    const settling: PageChromeContribution = {
      name: "settling",
      measure: (_input, ctx) => {
        iterCount.n = ctx.iteration;
        return {
          topForPage: () => 10, bottomForPage: () => 0,
          stable: ctx.iteration >= 3, payload: ctx.iteration,
        };
      },
      render: () => {},
    };
    // Must NOT throw — guard should only trip on true runPipeline re-entry.
    expect(() => {
      runChromeLoop(d, buildOptions(), [settling], 1, {}, null, buildMeasureInput(d));
    }).not.toThrow();
    expect(iterCount.n).toBe(3);

    // Subsequent runPipeline call still works (counter was never bumped).
    expect(() => runPipeline(d, buildOptions())).not.toThrow();
  });
});
