/**
 * Per-page layout metrics — lets chrome contributors (headers, footers,
 * footnotes) reserve vertical space without raw margin arithmetic.
 */

import type { PageConfig } from "./PageLayout";

/** Geometry for a single page, derived from PageConfig + chrome reservations. */
export interface PageMetrics {
  /** 1-based page number. */
  pageNumber: number;
  /** Y where flow content starts (margins.top + headerHeight). */
  contentTop: number;
  /** Y where flow content ends (pageHeight - margins.bottom - footerHeight). */
  contentBottom: number;
  /** contentBottom - contentTop. */
  contentHeight: number;
  /** pageWidth - margins.left - margins.right. */
  contentWidth: number;
  /** Y of the header band top (= margins.top). */
  headerTop: number;
  /** Y of the footer band top. */
  footerTop: number;
  /** Resolved header height for this page. 0 when no chrome contributor. */
  headerHeight: number;
  /** Resolved footer height for this page. 0 when no chrome contributor. */
  footerHeight: number;
}

/** One chrome contribution (header, footer, footnote band, etc.). */
export interface ChromeContribution {
  /** Reserved top space on a given page (px). */
  topForPage(pageNumber: number): number;
  /** Reserved bottom space on a given page (px). */
  bottomForPage(pageNumber: number): number;
  /** Opaque state routed back to the contributor at paint time. */
  payload?: unknown;
  /** True when this contributor's reservations have stabilized. */
  stable: boolean;
  /** Extra pages needed after the last natural page (e.g. footnote overflow). */
  syntheticPages?: number;
}

/** Aggregated chrome contributions for one layout run. */
export interface ResolvedChrome {
  contributions: Record<string, ChromeContribution>;
  /** Bumps when any contributor's output changes — invalidates placement cache. */
  metricsVersion: number;
}

/** Compute PageMetrics for one page from config + chrome reservations. Pure, no caching. */
export function computePageMetrics(
  config: PageConfig,
  resolved: ResolvedChrome,
  pageNumber: number,
): PageMetrics {
  const { pageWidth, pageHeight, margins } = config;

  let headerHeight = 0;
  let footerHeight = 0;

  for (const contribution of Object.values(resolved.contributions)) {
    headerHeight += contribution.topForPage(pageNumber);
    // Pageless mode has no footer — flow grows unbounded.
    if (!config.pageless) {
      footerHeight += contribution.bottomForPage(pageNumber);
    }
  }

  const contentTop = margins.top + headerHeight;
  const contentBottom = config.pageless
    ? pageHeight
    : pageHeight - margins.bottom - footerHeight;
  const contentHeight = contentBottom - contentTop;
  const contentWidth = pageWidth - margins.left - margins.right;

  return {
    pageNumber,
    contentTop,
    contentBottom,
    contentHeight,
    contentWidth,
    headerTop: margins.top,
    footerTop: pageHeight - margins.bottom - footerHeight,
    headerHeight,
    footerHeight,
  };
}

/** Zero-contributor default — produces the same metrics as raw margin arithmetic. */
export const EMPTY_RESOLVED_CHROME: ResolvedChrome = Object.freeze({
  contributions: Object.freeze({} as Record<string, never>),
  metricsVersion: 0,
});
