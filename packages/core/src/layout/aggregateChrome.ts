/**
 * Chrome aggregator loop — runs PageChromeContributions until every one
 * reports stable:true or MAX_ITERATIONS is reached. Zero contributors exit
 * after iteration 1 with convergence:"stable". Exhaustion accepts the last
 * iteration's layout and flags convergence:"exhausted" for debugging.
 *
 * The loop deliberately does NOT bump `runPipelineDepth` — that guard
 * protects against re-entrant runPipeline calls, not internal iteration.
 * Contributors that need to measure mini-documents must use runMiniPipeline.
 */

import type { Node } from "prosemirror-model";
import {
  type PageLayoutOptions,
  type DocumentLayout,
  type FlowPipelineResult,
  runFlowPipeline,
} from "./PageLayout";
import {
  type ChromeContribution,
  type ResolvedChrome,
  type LayoutIterationContext,
  type PageChromeContribution,
  type PageChromeMeasureInput,
} from "./PageMetrics";

const MAX_ITERATIONS = 5;

/**
 * What a chrome resolution reserves, flattened to numbers.
 *
 * Read once, when the resolution is new. A contributor's closures are its own
 * to write and may answer from state that moves underneath them, so deciding
 * anything by calling last iteration's closures a second time would be asking
 * a question about the past and getting an answer about the present.
 */
function sampleReservations(resolved: ResolvedChrome, pageCount: number): string {
  const parts: string[] = [];
  // Sampled one page past the end: the last iteration's count is a lower
  // bound, and a band that changes only on a page that does not exist yet
  // still changes the layout that would create it.
  for (const name of Object.keys(resolved.contributions).sort()) {
    const c = resolved.contributions[name]!;
    parts.push(name, String(c.replacesTopMargin), String(c.replacesBottomMargin));
    for (let page = 1; page <= pageCount + 1; page++) {
      parts.push(String(c.topForPage(page)), String(c.bottomForPage(page)));
    }
  }
  return parts.join("|");
}

export interface ChromeLoopResult {
  /** Final flow pipeline result (pages + metrics; no floats/fragments yet). */
  flow: FlowPipelineResult;
  /** Chrome resolution used in the final iteration. */
  resolved: ResolvedChrome;
  /** "stable" when every contributor reported stable:true; otherwise "exhausted". */
  convergence: "stable" | "exhausted";
  /** 1..MAX_ITERATIONS. Zero contributors always returns 1. */
  iterationCount: number;
  /** Contributor payloads keyed by contribution.name. Seeds next run. */
  chromePayloads: Record<string, unknown>;
}

/**
 * Run the chrome aggregator. Zero contributors → one iteration, stable,
 * empty ResolvedChrome, empty payloads. One or more contributors → iterate
 * until convergence or exhaustion, then apply the final flow pipeline.
 */
export function runChromeLoop(
  doc: Node,
  options: PageLayoutOptions,
  contributions: PageChromeContribution[],
  runId: number,
  prevRunPayloads: Record<string, unknown>,
  prevRunFlowLayout: DocumentLayout | null,
  measureInput: PageChromeMeasureInput,
): ChromeLoopResult {
  let currentFlow: FlowPipelineResult | null = null;
  let previousSample: string | null = null;
  let finalContribs: Record<string, ChromeContribution> = {};
  let prevIterationPayloads: Record<string, unknown> = {};
  let converged = false;
  let iteration = 0;

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    iteration = i;

    const contribs: Record<string, ChromeContribution> = {};
    let allStable = true;

    for (const contrib of contributions) {
      const ctx: LayoutIterationContext = {
        runId,
        iteration: i,
        maxIterations: MAX_ITERATIONS,
        previousIterationPayload: prevIterationPayloads[contrib.name] ?? null,
        previousRunPayload: prevRunPayloads[contrib.name] ?? null,
        currentFlowLayout: currentFlow?.layout ?? null,
        previousRunFlowLayout: prevRunFlowLayout,
      };
      const result = contrib.measure(measureInput, ctx);
      contribs[contrib.name] = result;
      if (!result.stable) allStable = false;
    }

    const resolved: ResolvedChrome = { contributions: contribs, metricsVersion: 0 };
    // Re-paginating against chrome that reserves exactly what it did last
    // iteration would reproduce the pages already in hand. A contributor that
    // asked for another look without moving a band — a header token that grew
    // a digit wider — pays for the measure, not for the document.
    const sample: string | null =
      currentFlow === null
        ? null
        : sampleReservations(resolved, currentFlow.layout.pages.length);
    if (sample === null || sample !== previousSample) {
      currentFlow = runFlowPipeline(doc, options, resolved, runId);
      // Against the count this pagination produced, which is what the next
      // iteration will be compared on.
      previousSample = sampleReservations(resolved, currentFlow.layout.pages.length);
    }
    finalContribs = contribs;

    if (allStable) {
      converged = true;
      break;
    }

    // Capture payloads for the next iteration's previousIterationPayload.
    prevIterationPayloads = {};
    for (const [name, c] of Object.entries(contribs)) {
      if (c.payload !== undefined) prevIterationPayloads[name] = c.payload;
    }
  }

  if (!converged && (globalThis as Record<string, unknown>).__LAYOUT_DEBUG__) {
    const names = contributions.map((c) => c.name).join(", ");
    console.warn(
      `[aggregateChrome] convergence exhausted after ${MAX_ITERATIONS} iterations.` +
      ` Accepting last iteration's layout. Contributors: [${names}].`,
    );
  }

  const chromePayloads: Record<string, unknown> = {};
  for (const [name, c] of Object.entries(finalContribs)) {
    if (c.payload !== undefined) chromePayloads[name] = c.payload;
  }

  return {
    flow: currentFlow!,
    resolved: { contributions: finalContribs, metricsVersion: 0 },
    convergence: converged ? "stable" : "exhausted",
    iterationCount: iteration,
    chromePayloads,
  };
}
