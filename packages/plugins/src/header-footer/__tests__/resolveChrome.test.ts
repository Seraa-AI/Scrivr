import { describe, it, expect, vi } from "vitest";
import type { LayoutIterationContext } from "@scrivr/core";

// runMiniPipeline returns a stub layout shape so the unit test stays isolated
// from the real layout pipeline. resolveChrome's wiring (slot presence,
// per-page selection) is the contract under test.
vi.mock("@scrivr/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@scrivr/core")>();
  return {
    ...actual,
    runMiniPipeline: vi.fn((_doc, _opts) => ({
      pages: [{ pageNumber: 1, blocks: [] }],
      pageConfig: {
        pageWidth: 816,
        pageHeight: 1056,
        margins: { top: 96, bottom: 96, left: 96, right: 96 },
        pageless: false,
      },
      version: 1,
      totalContentHeight: 36,
      metrics: [
        {
          contentTop: 96,
          contentBottom: 960,
          contentHeight: 864,
          contentWidth: 624,
          headerTop: 96,
          footerTop: 960,
          headerHeight: 0,
          footerHeight: 0,
          pageNumber: 1,
        },
      ],
      runId: 0,
      convergence: "stable" as const,
      iterationCount: 1,
      chromePayloads: {},
    })),
  };
});

import { resolveChrome } from "../resolveChrome";
import type { HeaderFooterPolicy } from "../types";
import { realSchema } from "../../test-utils";

// Real PM doc node — gives resolveChrome a real `doc.type.schema.nodeFromJSON`
// so it can deserialize each slot's content against the production schema.
const { doc: realDoc } = realSchema();

const mockInput = {
  doc: realDoc,
  pageConfig: {
    pageWidth: 816,
    pageHeight: 1056,
    margins: { top: 96, bottom: 96, left: 96, right: 96 },
    pageless: false,
  },
  measurer: {} as never,
  fontConfig: {} as never,
};

const mockCtx: LayoutIterationContext = {
  runId: 1,
  iteration: 1,
  maxIterations: 5,
  previousIterationPayload: null,
  previousRunPayload: null,
  currentFlowLayout: null,
  previousRunFlowLayout: null,
};

const makeDef = (text = "test") => ({
  content: {
    type: "doc" as const,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  },
});

describe("resolveChrome", () => {
  it("returns non-zero topForPage when defaultHeader is present", () => {
    const policy: HeaderFooterPolicy = {
      enabled: true,
      differentFirstPage: false,
      differentOddEven: false,
      defaultHeader: makeDef("header"),
    };

    const contrib = resolveChrome(policy, mockInput, mockCtx, 28);
    expect(contrib.topForPage(1)).toBeGreaterThan(0);
    expect(contrib.topForPage(5)).toBeGreaterThan(0);
  });

  it("returns non-zero bottomForPage when defaultFooter is present", () => {
    const policy: HeaderFooterPolicy = {
      enabled: true,
      differentFirstPage: false,
      differentOddEven: false,
      defaultFooter: makeDef("footer"),
    };

    const contrib = resolveChrome(policy, mockInput, mockCtx, 28);
    expect(contrib.bottomForPage(1)).toBeGreaterThan(0);
    expect(contrib.bottomForPage(3)).toBeGreaterThan(0);
  });

  it("returns zero heights when no slots are defined", () => {
    const policy: HeaderFooterPolicy = {
      enabled: true,
      differentFirstPage: false,
      differentOddEven: false,
    };

    const contrib = resolveChrome(policy, mockInput, mockCtx, 28);
    expect(contrib.topForPage(1)).toBe(0);
    expect(contrib.bottomForPage(1)).toBe(0);
  });

  it("returns different header height for page 1 when differentFirstPage is true", () => {
    const policy: HeaderFooterPolicy = {
      enabled: true,
      differentFirstPage: true,
      differentOddEven: false,
      defaultHeader: makeDef("default-header"),
      firstPageHeader: makeDef("first-header"),
    };

    const contrib = resolveChrome(policy, mockInput, mockCtx, 28);
    // Both should be non-zero (both slots have content)
    expect(contrib.topForPage(1)).toBeGreaterThan(0);
    expect(contrib.topForPage(2)).toBeGreaterThan(0);
  });

  it("returns zero for page 1 header when differentFirstPage is true but firstPageHeader is undefined", () => {
    const policy: HeaderFooterPolicy = {
      enabled: true,
      differentFirstPage: true,
      differentOddEven: false,
      defaultHeader: makeDef("default-header"),
      // no firstPageHeader
    };

    const contrib = resolveChrome(policy, mockInput, mockCtx, 28);
    expect(contrib.topForPage(1)).toBe(0); // no first-page slot
    expect(contrib.topForPage(2)).toBeGreaterThan(0); // default slot
  });

  it("always returns stable: true", () => {
    const policy: HeaderFooterPolicy = {
      enabled: true,
      differentFirstPage: false,
      differentOddEven: false,
      defaultHeader: makeDef("header"),
    };

    const contrib = resolveChrome(policy, mockInput, mockCtx, 28);
    expect(contrib.stable).toBe(true);
  });

  it("reserves at least activeEditingGap between header content and body, regardless of slot.margin", () => {
    // The editing affordance (e.g. React `HeaderFooterRibbon`, default
    // 28px) overlays the gap between the header band's content bottom
    // and the body's contentTop. Activating the surface used to widen
    // the gap from slot.margin to the ribbon height at active-only
    // measure time, which pushed body content down on click. The fix:
    // reserve activeEditingGap unconditionally so the gap is stable.
    //
    // Mocked runMiniPipeline returns totalContentHeight: 36,
    // marginTop: 96. With activeEditingGap=28 and no explicit
    // slot.margin: top = 96 + (36 + 28) = 160.
    const policy: HeaderFooterPolicy = {
      enabled: true,
      differentFirstPage: false,
      differentOddEven: false,
      defaultHeader: makeDef("header"),
    };

    const contrib = resolveChrome(policy, mockInput, mockCtx, 28);
    expect(contrib.topForPage(1)).toBe(96 + 36 + 28);
  });

  it("does not shrink the gap below activeEditingGap when the slot sets a smaller margin", () => {
    const policy: HeaderFooterPolicy = {
      enabled: true,
      differentFirstPage: false,
      differentOddEven: false,
      defaultHeader: { ...makeDef("header"), margin: 4 },
    };

    const contrib = resolveChrome(policy, mockInput, mockCtx, 28);
    // 96 (marginTop) + 36 (content) + max(4, 28) = 160
    expect(contrib.topForPage(1)).toBe(96 + 36 + 28);
  });

  it("respects a larger user-set margin (no upper clamp)", () => {
    const policy: HeaderFooterPolicy = {
      enabled: true,
      differentFirstPage: false,
      differentOddEven: false,
      defaultHeader: { ...makeDef("header"), margin: 60 },
    };

    const contrib = resolveChrome(policy, mockInput, mockCtx, 28);
    // 96 + 36 + max(60, 28) = 192
    expect(contrib.topForPage(1)).toBe(96 + 36 + 60);
  });

  it("honors a custom activeEditingGap (custom ribbon height)", () => {
    const policy: HeaderFooterPolicy = {
      enabled: true,
      differentFirstPage: false,
      differentOddEven: false,
      defaultHeader: makeDef("header"),
    };

    // 96 (marginTop) + 36 (content) + max(undefined ?? 40, 40) = 172
    const contrib = resolveChrome(policy, mockInput, mockCtx, 40);
    expect(contrib.topForPage(1)).toBe(96 + 36 + 40);
  });

  it("activeEditingGap=0 disables the floor — slot.margin honored as-is (headless / PDF mode)", () => {
    const policy: HeaderFooterPolicy = {
      enabled: true,
      differentFirstPage: false,
      differentOddEven: false,
      defaultHeader: { ...makeDef("header"), margin: 4 },
    };

    // 96 + 36 + max(4, 0) = 136 — no whitespace reserved for a UI that
    // isn't being drawn, slot's tight margin survives the measure step.
    const contrib = resolveChrome(policy, mockInput, mockCtx, 0);
    expect(contrib.topForPage(1)).toBe(96 + 36 + 4);
  });

  it("activeEditingGap=0 with unset slot.margin defaults to 0 (no gap at all)", () => {
    const policy: HeaderFooterPolicy = {
      enabled: true,
      differentFirstPage: false,
      differentOddEven: false,
      defaultHeader: makeDef("header"),
    };

    // 96 + 36 + max(undefined ?? 0, 0) = 132
    const contrib = resolveChrome(policy, mockInput, mockCtx, 0);
    expect(contrib.topForPage(1)).toBe(96 + 36 + 0);
  });

  it("attaches a ResolvedHeaderFooter payload", () => {
    const policy: HeaderFooterPolicy = {
      enabled: true,
      differentFirstPage: false,
      differentOddEven: false,
      defaultHeader: makeDef("header"),
    };

    const contrib = resolveChrome(policy, mockInput, mockCtx, 28);
    expect(contrib.payload).toBeDefined();
    const resolved = contrib.payload as {
      policy: HeaderFooterPolicy;
      slots: Record<string, unknown>;
    };
    expect(resolved.policy).toBe(policy);
    expect(resolved.slots.defaultHeader).toBeDefined();
  });
});
