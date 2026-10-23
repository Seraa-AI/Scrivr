import { describe, it, expect } from "vitest";
import { pageRegionAt, resolvePagePoint, type PagePointContext, type PageRegionLayout } from "./pagePoint";
import {
  computePageMetrics,
  EMPTY_RESOLVED_CHROME,
  type ResolvedChrome,
} from "./PageMetrics";
import { defaultPageConfig, defaultPagelessConfig, type PageConfig } from "./PageLayout";

/**
 * Regions are geometry over data layout already produces — page config and
 * per-page metrics — so they are tested without a document or a DOM.
 *
 * defaultPageConfig: 794 × 1123, 72px margins on every side.
 */

const GAP = 24;

function pagedLayout(pageCount: number, chrome: ResolvedChrome = EMPTY_RESOLVED_CHROME): PageRegionLayout {
  return layoutFor(defaultPageConfig, pageCount, chrome, pageCount * defaultPageConfig.pageHeight);
}

function layoutFor(
  pageConfig: PageConfig,
  pageCount: number,
  chrome: ResolvedChrome,
  totalContentHeight: number,
): PageRegionLayout {
  const metrics = Array.from({ length: pageCount }, (_, i) => computePageMetrics(pageConfig, chrome, i + 1));
  return { pageConfig, metrics, totalContentHeight };
}

/** A 60px header band and a 60px footer band on every page. */
const BANDS: ResolvedChrome = {
  contributions: {
    bands: { topForPage: () => 60, bottomForPage: () => 60, stable: true },
  },
  metricsVersion: 1,
};

function pagedContext(layout: PageRegionLayout, origin = { left: 0, top: 0 }): PagePointContext {
  const tileHeight = layout.pageConfig.pageHeight;
  return { origin, pageless: false, tileHeight, slotHeight: tileHeight + GAP, layout };
}

describe("pageRegionAt — paged, no header/footer policy", () => {
  const layout = pagedLayout(2);

  it("classifies the content box as content", () => {
    expect(pageRegionAt(layout, 1, 400, 500)).toBe("content");
    // The content box edges are inclusive.
    expect(pageRegionAt(layout, 1, 72, 72)).toBe("content");
    expect(pageRegionAt(layout, 1, 794 - 72, 1123 - 72)).toBe("content");
  });

  it("treats the top and bottom margin strips as the header and footer", () => {
    expect(pageRegionAt(layout, 1, 400, 0)).toBe("header");
    expect(pageRegionAt(layout, 1, 400, 71)).toBe("header");
    expect(pageRegionAt(layout, 1, 400, 1123 - 71)).toBe("footer");
    expect(pageRegionAt(layout, 1, 400, 1123)).toBe("footer");
  });

  it("classifies the side margins as margin", () => {
    expect(pageRegionAt(layout, 1, 10, 500)).toBe("margin");
    expect(pageRegionAt(layout, 1, 794 - 10, 500)).toBe("margin");
  });

  it("gives the header and footer strips the full page width, corners included", () => {
    expect(pageRegionAt(layout, 1, 10, 10)).toBe("header");
    expect(pageRegionAt(layout, 1, 794 - 10, 1123 - 10)).toBe("footer");
  });

  it("classifies points off the page as outside", () => {
    expect(pageRegionAt(layout, 1, -1, 500)).toBe("outside");
    expect(pageRegionAt(layout, 1, 795, 500)).toBe("outside");
    expect(pageRegionAt(layout, 1, 400, -1)).toBe("outside");
    expect(pageRegionAt(layout, 1, 400, 1124)).toBe("outside");
  });

  it("returns null for a page with no metrics", () => {
    expect(pageRegionAt(layout, 3, 400, 500)).toBeNull();
    expect(pageRegionAt(layout, 0, 400, 500)).toBeNull();
  });
});

describe("pageRegionAt — paged, with header/footer bands", () => {
  // contentTop = 72 + 60 = 132; footerTop = 1123 - 72 - 60 = 991.
  const layout = pagedLayout(1, BANDS);

  it("uses the resolved band bounds, not the raw margins", () => {
    expect(pageRegionAt(layout, 1, 400, 100)).toBe("header");
    expect(pageRegionAt(layout, 1, 400, 131)).toBe("header");
    expect(pageRegionAt(layout, 1, 400, 132)).toBe("content");
    expect(pageRegionAt(layout, 1, 400, 991)).toBe("content");
    expect(pageRegionAt(layout, 1, 400, 992)).toBe("footer");
  });
});

describe("pageRegionAt — pageless", () => {
  // defaultPagelessConfig: 885 wide, 40px top margin, 73px side margins.
  const layout = layoutFor(defaultPagelessConfig, 1, EMPTY_RESOLVED_CHROME, 5000);

  it("has a top strip but no footer — a pageless page has no bottom", () => {
    expect(pageRegionAt(layout, 1, 400, 20)).toBe("header");
    expect(pageRegionAt(layout, 1, 400, 40)).toBe("content");
    expect(pageRegionAt(layout, 1, 400, 4990)).toBe("content");
  });

  it("classifies side margins, and points past the content height as outside", () => {
    expect(pageRegionAt(layout, 1, 20, 1000)).toBe("margin");
    expect(pageRegionAt(layout, 1, 885 - 20, 1000)).toBe("margin");
    expect(pageRegionAt(layout, 1, 400, 5001)).toBe("outside");
  });
});

describe("resolvePagePoint — paged", () => {
  const layout = pagedLayout(2);
  const ctx = pagedContext(layout);
  const slot = 1123 + GAP;

  it("maps a client point to a page-local point on the right page", () => {
    expect(resolvePagePoint(400, 500, ctx)).toEqual({ page: 1, x: 400, y: 500, region: "content" });
    expect(resolvePagePoint(400, slot + 500, ctx)).toEqual({ page: 2, x: 400, y: 500, region: "content" });
  });

  it("subtracts the container origin", () => {
    const shifted = pagedContext(layout, { left: 100, top: 50 });
    expect(resolvePagePoint(500, 550, shifted)).toEqual({ page: 1, x: 400, y: 500, region: "content" });
  });

  it("reports the gap between pages, with y clamped to the page bottom", () => {
    expect(resolvePagePoint(400, 1123, ctx)).toEqual({ page: 1, x: 400, y: 1123, region: "gap" });
    expect(resolvePagePoint(400, 1123 + GAP - 1, ctx)).toEqual({ page: 1, x: 400, y: 1123, region: "gap" });
  });

  it("treats the pixel rows either side of the gap as page", () => {
    expect(resolvePagePoint(400, 1122, ctx).region).toBe("footer");
    expect(resolvePagePoint(400, slot, ctx)).toEqual({ page: 2, x: 400, y: 0, region: "header" });
  });

  it("reports points off the page horizontally as outside", () => {
    expect(resolvePagePoint(-5, 500, ctx).region).toBe("outside");
    expect(resolvePagePoint(900, 500, ctx).region).toBe("outside");
  });

  it("reports points above the first page and past the last page as outside", () => {
    expect(resolvePagePoint(400, -10, ctx)).toMatchObject({ page: 0, region: "outside" });
    expect(resolvePagePoint(400, 2 * slot + 10, ctx)).toMatchObject({ page: 3, region: "outside" });
  });
});

describe("resolvePagePoint — pageless", () => {
  const layout = layoutFor(defaultPagelessConfig, 1, EMPTY_RESOLVED_CHROME, 5000);
  const ctx: PagePointContext = {
    origin: { left: 0, top: 0 },
    pageless: true,
    tileHeight: 307,
    slotHeight: 307,
    layout,
  };

  it("is always page 1 with y equal to the visual y — tiles are not pages", () => {
    expect(resolvePagePoint(400, 2000, ctx)).toEqual({ page: 1, x: 400, y: 2000, region: "content" });
  });

  it("never reports a gap at tile boundaries", () => {
    expect(resolvePagePoint(400, 307, ctx).region).toBe("content");
    expect(resolvePagePoint(400, 306, ctx).region).toBe("content");
  });
});
