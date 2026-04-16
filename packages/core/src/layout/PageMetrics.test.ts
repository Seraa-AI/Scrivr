import { describe, it, expect } from "vitest";
import {
  computePageMetrics,
  EMPTY_RESOLVED_CHROME,
  type ChromeContribution,
  type ResolvedChrome,
} from "./PageMetrics";
import { defaultPageConfig, defaultPagelessConfig, type PageConfig } from "./PageLayout";

/**
 * A4 at 96dpi with 1-inch margins (defaultPageConfig):
 *   pageWidth:  794
 *   pageHeight: 1123
 *   margins:    { top: 72, right: 72, bottom: 72, left: 72 }
 *
 * Pre-refactor hand-computed formula (what every existing test currently
 * expects — this is the contract we must not break):
 *
 *   contentTop    = 72
 *   contentBottom = 1123 - 72 = 1051
 *   contentHeight = 1051 - 72 = 979
 *   contentWidth  = 794 - 72 - 72 = 650
 */

describe("computePageMetrics — zero contributors (Phase 0 baseline)", () => {
  it("matches the hand-computed formula on page 1", () => {
    const m = computePageMetrics(defaultPageConfig, EMPTY_RESOLVED_CHROME, 1);
    expect(m.pageNumber).toBe(1);
    expect(m.contentTop).toBe(72);
    expect(m.contentBottom).toBe(1051);
    expect(m.contentHeight).toBe(979);
    expect(m.contentWidth).toBe(650);
    expect(m.headerTop).toBe(72);
    expect(m.footerTop).toBe(1051);
    expect(m.headerHeight).toBe(0);
    expect(m.footerHeight).toBe(0);
  });

  it("matches the hand-computed formula on every page (pages 1..10)", () => {
    // With zero contributors, per-page variation must not exist. Every page
    // produces identical metrics except for `pageNumber`. This is the
    // "zero behavior change" property that lets Phase 0 ship without
    // breaking any existing layout tests.
    for (let page = 1; page <= 10; page++) {
      const m = computePageMetrics(defaultPageConfig, EMPTY_RESOLVED_CHROME, page);
      expect(m.pageNumber).toBe(page);
      expect(m.contentTop).toBe(72);
      expect(m.contentBottom).toBe(1051);
      expect(m.contentHeight).toBe(979);
      expect(m.contentWidth).toBe(650);
      expect(m.headerHeight).toBe(0);
      expect(m.footerHeight).toBe(0);
    }
  });

  it("respects custom margins", () => {
    const config: PageConfig = {
      pageWidth: 1000,
      pageHeight: 800,
      margins: { top: 50, right: 30, bottom: 40, left: 20 },
    };
    const m = computePageMetrics(config, EMPTY_RESOLVED_CHROME, 1);
    expect(m.contentTop).toBe(50);
    expect(m.contentBottom).toBe(760);
    expect(m.contentHeight).toBe(710);
    expect(m.contentWidth).toBe(950);
    expect(m.headerTop).toBe(50);
    expect(m.footerTop).toBe(760);
  });

  it("pageless mode — footer reservations are skipped", () => {
    // Pageless mode uses pageHeight=0 and disables bottom clamping. With
    // zero contributors, there's nothing to skip anyway, but we verify
    // the metrics come out in a consistent shape rather than NaN/negative.
    const m = computePageMetrics(defaultPagelessConfig, EMPTY_RESOLVED_CHROME, 1);
    expect(m.contentTop).toBe(40);        // pagelessConfig.margins.top
    expect(m.headerHeight).toBe(0);
    expect(m.footerHeight).toBe(0);
    // contentBottom in pageless mode falls through to `pageHeight` (0)
    // per the documented behavior — callers that respect `config.pageless`
    // never clamp against it.
    expect(m.contentBottom).toBe(0);
    // footerTop mirrors contentBottom in pageless — no margins.bottom subtraction.
    expect(m.footerTop).toBe(m.contentBottom);
    expect(m.footerTop).toBe(defaultPagelessConfig.pageHeight);
  });
});

describe("computePageMetrics — with contributors (forward-compat validation)", () => {
  /**
   * A stub contributor that returns constant top/bottom reservations.
   * Used to verify the summation + per-page plumbing works before any
   * real plugin (headerFooter, footnotes) ships in a later PR.
   */
  function constContribution(top: number, bottom: number): ChromeContribution {
    return {
      topForPage: () => top,
      bottomForPage: () => bottom,
      stable: true,
    };
  }

  /**
   * A stub contributor that varies per page — different top reservation
   * on page 1 vs. the rest. Emulates `differentFirstPage` header behavior.
   */
  function firstPageHeader(firstTop: number, restTop: number): ChromeContribution {
    return {
      topForPage: (pageNumber) => (pageNumber === 1 ? firstTop : restTop),
      bottomForPage: () => 0,
      stable: true,
    };
  }

  it("single contributor reserves top space", () => {
    const resolved: ResolvedChrome = {
      contributions: { header: constContribution(40, 0) },
      metricsVersion: 1,
    };
    const m = computePageMetrics(defaultPageConfig, resolved, 1);
    expect(m.headerHeight).toBe(40);
    expect(m.footerHeight).toBe(0);
    expect(m.contentTop).toBe(72 + 40);      // margins.top + header
    expect(m.contentBottom).toBe(1051);      // unchanged
    expect(m.contentHeight).toBe(1051 - 112); // 939
  });

  it("single contributor reserves bottom space", () => {
    const resolved: ResolvedChrome = {
      contributions: { footer: constContribution(0, 30) },
      metricsVersion: 1,
    };
    const m = computePageMetrics(defaultPageConfig, resolved, 1);
    expect(m.headerHeight).toBe(0);
    expect(m.footerHeight).toBe(30);
    expect(m.contentTop).toBe(72);
    expect(m.contentBottom).toBe(1051 - 30); // 1021
    expect(m.footerTop).toBe(1021);
  });

  it("multiple contributors sum their reservations", () => {
    // Header: 40px. Footer: 30px. Footnote band: 60px bottom. Total top=40, bottom=90.
    const resolved: ResolvedChrome = {
      contributions: {
        headerFooter: constContribution(40, 30),
        footnotes: constContribution(0, 60),
      },
      metricsVersion: 1,
    };
    const m = computePageMetrics(defaultPageConfig, resolved, 1);
    expect(m.headerHeight).toBe(40);
    expect(m.footerHeight).toBe(90);
    expect(m.contentTop).toBe(112);
    expect(m.contentBottom).toBe(1051 - 90); // 961
    expect(m.contentHeight).toBe(961 - 112); // 849
    expect(m.footerTop).toBe(961);
  });

  it("per-page variation — differentFirstPage header", () => {
    const resolved: ResolvedChrome = {
      contributions: { header: firstPageHeader(120, 40) },
      metricsVersion: 1,
    };
    const m1 = computePageMetrics(defaultPageConfig, resolved, 1);
    const m2 = computePageMetrics(defaultPageConfig, resolved, 2);
    const m3 = computePageMetrics(defaultPageConfig, resolved, 3);
    expect(m1.headerHeight).toBe(120);
    expect(m2.headerHeight).toBe(40);
    expect(m3.headerHeight).toBe(40);
    expect(m1.contentTop).toBe(192);
    expect(m2.contentTop).toBe(112);
    expect(m3.contentTop).toBe(112);
    // Page 1 has less flow space — this is the "differentFirstPage" behavior
    // the whole per-page refactor exists for.
    expect(m1.contentHeight).toBeLessThan(m2.contentHeight);
  });

  it("contributor order in the record doesn't affect the result", () => {
    const c1 = constContribution(20, 10);
    const c2 = constContribution(30, 20);
    const resolvedA: ResolvedChrome = {
      contributions: { a: c1, b: c2 },
      metricsVersion: 1,
    };
    const resolvedB: ResolvedChrome = {
      contributions: { b: c2, a: c1 },
      metricsVersion: 1,
    };
    const mA = computePageMetrics(defaultPageConfig, resolvedA, 1);
    const mB = computePageMetrics(defaultPageConfig, resolvedB, 1);
    expect(mA.headerHeight).toBe(mB.headerHeight);
    expect(mA.footerHeight).toBe(mB.footerHeight);
    expect(mA.contentTop).toBe(mB.contentTop);
    expect(mA.contentBottom).toBe(mB.contentBottom);
  });

  it("pageless mode ignores footer contributions", () => {
    const resolved: ResolvedChrome = {
      contributions: { header: constContribution(40, 30) },
      metricsVersion: 1,
    };
    const m = computePageMetrics(defaultPagelessConfig, resolved, 1);
    // Top reservation still applies — pageless has a meaningful content top.
    expect(m.headerHeight).toBe(40);
    // Bottom reservation is skipped — pageless has no meaningful bottom.
    expect(m.footerHeight).toBe(0);
  });
});

describe("EMPTY_RESOLVED_CHROME", () => {
  it("has zero contributors and metricsVersion 0", () => {
    expect(EMPTY_RESOLVED_CHROME.contributions).toEqual({});
    expect(EMPTY_RESOLVED_CHROME.metricsVersion).toBe(0);
  });

  it("is a stable reference (same object across accesses)", () => {
    // Not strictly required, but nice for identity-based optimization later.
    expect(EMPTY_RESOLVED_CHROME).toBe(EMPTY_RESOLVED_CHROME);
  });
});
