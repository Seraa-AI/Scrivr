import { describe, it, expect, vi } from "vitest";
import type { ChromeContribution, LayoutIterationContext } from "@scrivr/core";

// Mock runMiniPipeline before importing resolveChrome
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
      _chromePayloads: {},
    })),
  };
});

import { resolveChrome } from "../resolveChrome";
import type { HeaderFooterPolicy } from "../types";
import type { Node } from "prosemirror-model";

const mockInput = {
  doc: {
    type: {
      schema: {
        nodeFromJSON: vi.fn(() => ({ type: { name: "doc" } })),
      },
    },
  } as unknown as Node,
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

    const contrib = resolveChrome(policy, mockInput, mockCtx);
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

    const contrib = resolveChrome(policy, mockInput, mockCtx);
    expect(contrib.bottomForPage(1)).toBeGreaterThan(0);
    expect(contrib.bottomForPage(3)).toBeGreaterThan(0);
  });

  it("returns zero heights when no slots are defined", () => {
    const policy: HeaderFooterPolicy = {
      enabled: true,
      differentFirstPage: false,
      differentOddEven: false,
    };

    const contrib = resolveChrome(policy, mockInput, mockCtx);
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

    const contrib = resolveChrome(policy, mockInput, mockCtx);
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

    const contrib = resolveChrome(policy, mockInput, mockCtx);
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

    const contrib = resolveChrome(policy, mockInput, mockCtx);
    expect(contrib.stable).toBe(true);
  });

  it("attaches a ResolvedHeaderFooter payload", () => {
    const policy: HeaderFooterPolicy = {
      enabled: true,
      differentFirstPage: false,
      differentOddEven: false,
      defaultHeader: makeDef("header"),
    };

    const contrib = resolveChrome(policy, mockInput, mockCtx);
    expect(contrib.payload).toBeDefined();
    const resolved = contrib.payload as {
      policy: HeaderFooterPolicy;
      slots: Record<string, unknown>;
    };
    expect(resolved.policy).toBe(policy);
    expect(resolved.slots.defaultHeader).toBeDefined();
  });
});
