/**
 * Per-page layout metrics — lets chrome contributors (headers, footers,
 * footnotes) reserve vertical space without raw margin arithmetic.
 */

import type { Node } from "prosemirror-model";
import type { DocumentLayout, PageConfig } from "./PageLayout";
import type { FontConfig } from "./FontConfig";
import type { TextMeasurer } from "./TextMeasurer";
import type { MarkDecorator } from "../extensions/types";
import type { BlockRegistry, InlineRegistry } from "./BlockRegistry";

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

export type PageFlowMetrics = Pick<PageMetrics, "contentTop" | "contentHeight">;

export function pageStartGlobalForMetrics(
  pageConfig: PageConfig,
  metricsFor: (pageNumber: number) => PageFlowMetrics,
  pageNumber: number,
): number {
  if (pageConfig.pageless) return metricsFor(1).contentTop;
  let y = metricsFor(1).contentTop;
  for (let page = 1; page < pageNumber; page++) {
    y += metricsFor(page).contentHeight;
  }
  return y;
}

export function pageLocalYToGlobalForMetrics(
  pageConfig: PageConfig,
  metricsFor: (pageNumber: number) => PageFlowMetrics,
  pageNumber: number,
  localY: number,
): number {
  return pageStartGlobalForMetrics(pageConfig, metricsFor, pageNumber)
    + (localY - metricsFor(pageNumber).contentTop);
}

/** One chrome contribution (header, footer, footnote band, etc.). */
export interface ChromeContribution {
  /**
   * Total space reserved from the TOP of the page (px). When replacesTopMargin
   * is true, this replaces margins.top entirely — the value represents the
   * full distance from the page edge to contentTop.
   */
  topForPage(pageNumber: number): number;
  /**
   * Total space reserved from the BOTTOM of the page (px). When
   * replacesBottomMargin is true, this replaces margins.bottom entirely.
   */
  bottomForPage(pageNumber: number): number;
  /** If true, topForPage replaces margins.top instead of adding to it. */
  replacesTopMargin?: boolean;
  /** If true, bottomForPage replaces margins.bottom instead of adding to it. */
  replacesBottomMargin?: boolean;
  /** Where the top chrome band starts (px from page edge). Used for headerTop in metrics. */
  topBandStart?: (pageNumber: number) => number;
  /** Where the bottom chrome band starts (px from page bottom). Used for footerTop in metrics. */
  bottomBandStart?: (pageNumber: number) => number;
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
  let topMarginReplaced = false;
  let bottomMarginReplaced = false;

  for (const contribution of Object.values(resolved.contributions)) {
    const top = contribution.topForPage(pageNumber);
    if (contribution.replacesTopMargin) {
      // This contributor's value replaces margins.top entirely
      headerHeight = top;
      topMarginReplaced = true;
    } else {
      headerHeight += top;
    }

    if (!config.pageless) {
      const bottom = contribution.bottomForPage(pageNumber);
      if (contribution.replacesBottomMargin) {
        footerHeight = bottom;
        bottomMarginReplaced = true;
      } else {
        footerHeight += bottom;
      }
    }
  }

  // When a contributor replaces the margin, contentTop is headerHeight directly
  // (it already includes the distance from the page edge). Otherwise, add to margins.
  const contentTop = topMarginReplaced ? headerHeight : margins.top + headerHeight;
  const contentBottom = config.pageless
    ? pageHeight
    : bottomMarginReplaced
      ? pageHeight - footerHeight
      : pageHeight - margins.bottom - footerHeight;
  const contentHeight = contentBottom - contentTop;
  const contentWidth = pageWidth - margins.left - margins.right;

  return {
    pageNumber,
    contentTop,
    contentBottom,
    contentHeight,
    contentWidth,
    headerTop: topMarginReplaced ? computeBandStart(resolved, pageNumber, "top", margins.top) : margins.top,
    footerTop: config.pageless
      ? pageHeight
      : contentBottom,
    headerHeight: topMarginReplaced
      ? headerHeight - computeBandStart(resolved, pageNumber, "top", margins.top)
      : headerHeight,
    footerHeight: bottomMarginReplaced
      ? footerHeight - computeBandStart(resolved, pageNumber, "bottom", margins.bottom)
      : footerHeight,
  };
}

/** Zero-contributor default — produces the same metrics as raw margin arithmetic. */
export const EMPTY_RESOLVED_CHROME: ResolvedChrome = Object.freeze({
  contributions: Object.freeze({} as Record<string, never>),
  metricsVersion: 0,
});

/** Find the band start position from contributions that replace margins. */
function computeBandStart(
  resolved: ResolvedChrome,
  pageNumber: number,
  side: "top" | "bottom",
  fallback: number,
): number {
  for (const contribution of Object.values(resolved.contributions)) {
    if (side === "top" && contribution.replacesTopMargin && contribution.topBandStart) {
      return contribution.topBandStart(pageNumber);
    }
    if (side === "bottom" && contribution.replacesBottomMargin && contribution.bottomBandStart) {
      return contribution.bottomBandStart(pageNumber);
    }
  }
  return fallback;
}

// ── Page chrome contributor API ─────────────────────────────────────────────
// Plugins (HeaderFooter, Footnotes, margin notes) implement
// PageChromeContribution and register it via Extension.addPageChrome(). The
// aggregator loop in aggregateChrome.ts iterates contributors until every
// one reports stable:true or MAX_ITERATIONS is reached.

/** Input passed to every contributor's measure() call. */
export interface PageChromeMeasureInput {
  doc: Node;
  pageConfig: PageConfig;
  measurer: TextMeasurer;
  fontConfig: FontConfig;
}

/**
 * Per-iteration context threaded through measure() so contributors can detect
 * stability, seed from the previous run, and read the flow layout produced by
 * the previous iteration.
 */
export interface LayoutIterationContext {
  /** Monotonic run id — increments once per full layout run. */
  runId: number;
  /** 1-indexed iteration within the current run. */
  iteration: number;
  /** Hard cap before the aggregator gives up. */
  maxIterations: number;
  /** Contributor payload from the previous iteration of THIS run (null on iter 1). */
  previousIterationPayload: unknown | null;
  /** Contributor payload from the previous RUN's final iteration (null on first run). */
  previousRunPayload: unknown | null;
  /** Flow layout produced using the previous iteration's chrome (null on iter 1). */
  currentFlowLayout: DocumentLayout | null;
  /** Flow layout from the previous run's final iteration (null on first run). */
  previousRunFlowLayout: DocumentLayout | null;
}

/** Input passed to every contributor's render() call during content-canvas paint. */
export interface PageChromePaintContext {
  ctx: CanvasRenderingContext2D;
  pageNumber: number;
  totalPages: number;
  metrics: PageMetrics;
  pageConfig: PageConfig;
  /** This contributor's payload from the final measure() call of the last run. */
  payload: unknown;
  /** Text measurer — for rendering mini-layout blocks in chrome bands. */
  measurer: TextMeasurer;
  /** Mark decorators from extensions — for rendering styled text in chrome bands. */
  markDecorators?: Map<string, MarkDecorator>;
  /** Block registry — dispatches block rendering to the correct strategy. */
  blockRegistry?: BlockRegistry;
  /** Inline object registry — renders inline images, widgets, etc. */
  inlineRegistry?: InlineRegistry;
}

/** Plugin-facing contributor registered via Extension.addPageChrome(). */
export interface PageChromeContribution {
  /** Unique name — routes payload back to render(). Namespace by extension. */
  name: string;
  /** Measure once per iteration; returns reserved space + stability signal. */
  measure(
    input: PageChromeMeasureInput,
    ctx: LayoutIterationContext,
  ): ChromeContribution;
  /** Paint this contributor's chrome band for one page. */
  render(ctx: PageChromePaintContext): void;
}
