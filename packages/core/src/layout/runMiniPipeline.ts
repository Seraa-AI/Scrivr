/**
 * runMiniPipeline — measurement-only layout pass for mini-documents (headers,
 * footers, footnote bodies). Runs buildBlockFlow + paginateFlow in pageless
 * mode without chrome aggregation, so it's safe to call from inside a chrome
 * contributor's measure() hook without triggering recursive pagination.
 */

import type { Node } from "prosemirror-model";
import type { FontModifier } from "../extensions/types";
import type { TextMeasurer } from "./TextMeasurer";
import {
  type PageConfig,
  type DocumentLayout,
  type FlowConfig,
  collectLayoutItems,
  buildBlockFlow,
  paginateFlow,
} from "./PageLayout";
import {
  EMPTY_RESOLVED_CHROME,
  computePageMetrics,
  type PageMetrics,
} from "./PageMetrics";
import {
  defaultFontConfig,
  DEFAULT_FONT_FAMILY,
  applyPageFont,
  type FontConfig,
} from "./FontConfig";

export interface MiniPipelineOptions {
  /** PageConfig for the mini-doc. `pageless` is forced to true internally. */
  pageConfig: PageConfig;
  measurer: TextMeasurer;
  fontConfig?: FontConfig;
  fontModifiers?: Map<string, FontModifier>;
}

/** Measure a mini-doc synchronously on a single pageless page. */
export function runMiniPipeline(
  doc: Node,
  options: MiniPipelineOptions,
): DocumentLayout {
  const { measurer, fontModifiers } = options;
  const pageConfig: PageConfig = { ...options.pageConfig, pageless: true };

  const baseConfig = options.fontConfig ?? defaultFontConfig;
  const fontConfig = applyPageFont(
    baseConfig,
    pageConfig.fontFamily ?? DEFAULT_FONT_FAMILY,
  );

  const { pageWidth, margins } = pageConfig;
  const contentWidth = pageWidth - margins.left - margins.right;

  const resolved = EMPTY_RESOLVED_CHROME;
  const page1Metrics = computePageMetrics(pageConfig, resolved, 1);
  const metricsFor = (pageNumber: number): PageMetrics =>
    pageNumber === 1
      ? page1Metrics
      : computePageMetrics(pageConfig, resolved, pageNumber);

  // Measure blocks
  const items = collectLayoutItems(doc, fontConfig);
  const flowConfig: FlowConfig = { margins, contentWidth };
  const flowResult = buildBlockFlow(
    items,
    0,
    flowConfig,
    fontConfig,
    measurer,
    fontModifiers,
    undefined,
    undefined,
  );

  // Stack blocks on a single pageless page
  const initPage: { pageNumber: number; blocks: [] } = { pageNumber: 1, blocks: [] };
  const pr = paginateFlow(
    flowResult.flows,
    pageConfig,
    resolved,
    metricsFor,
    0,
    undefined,
    undefined,
    [],
    initPage,
    page1Metrics.contentTop,
    0,
    true,
  );

  const singlePage = pr.currentPage;
  const naturalHeight = pr.y - page1Metrics.contentTop;

  return {
    pages: [singlePage],
    pageConfig,
    version: 1,
    totalContentHeight: naturalHeight,
    metrics: [page1Metrics],
    runId: 0,
    convergence: "stable",
    iterationCount: 1,
  };
}
