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
  type PageLayoutOptions,
  runFlowPipeline,
} from "./PageLayout";
import { EMPTY_RESOLVED_CHROME } from "./PageMetrics";
import type { FontConfig } from "./FontConfig";

export interface MiniPipelineOptions {
  /** PageConfig for the mini-doc. `pageless` is forced to true internally. */
  pageConfig: PageConfig;
  measurer: TextMeasurer;
  fontConfig?: FontConfig;
  fontModifiers?: Map<string, FontModifier>;
}

/**
 * Measure a mini-doc synchronously on a single pageless page.
 *
 * Intentionally shares runFlowPipeline with runPipeline but bypasses the
 * chrome aggregator loop — safe to call from inside a chrome contributor's
 * measure() hook without triggering recursion. runPipeline's depth guard
 * enforces this if misused.
 */
export function runMiniPipeline(
  doc: Node,
  options: MiniPipelineOptions,
): DocumentLayout {
  const pageConfig: PageConfig = { ...options.pageConfig, pageless: true };
  const plOptions: PageLayoutOptions = {
    pageConfig,
    measurer: options.measurer,
    ...(options.fontConfig !== undefined && { fontConfig: options.fontConfig }),
    ...(options.fontModifiers !== undefined && { fontModifiers: options.fontModifiers }),
  };

  // runId: 0 signals "not a real layout run" — cache layers key off runId === previousLayout.runId.
  const fp = runFlowPipeline(doc, plOptions, EMPTY_RESOLVED_CHROME, 0);
  const page1Metrics = fp.layout.metrics![0]!;
  const singlePage = fp.layout.pages[0]!;
  const naturalHeight = fp.y - page1Metrics.contentTop;

  return {
    pages: [singlePage],
    pageConfig,
    version: 1,
    totalContentHeight: naturalHeight,
    metrics: [page1Metrics],
    runId: 0,
    convergence: "stable",
    iterationCount: 1,
    _chromePayloads: {},
  };
}
