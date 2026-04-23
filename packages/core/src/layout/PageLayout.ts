import { Node } from "prosemirror-model";
import type { FontModifier } from "../extensions/types";
import { TextMeasurer } from "./TextMeasurer";
import {
  FontConfig,
  defaultFontConfig,
  DEFAULT_FONT_FAMILY,
  getBlockStyle,
  BlockStyle,
  applyPageFont,
} from "./FontConfig";
import { layoutBlock, LayoutBlock } from "./BlockLayout";
import type { InlineRegistry } from "./BlockRegistry";
import type { LayoutLine, ConstraintProvider } from "./LineBreaker";
import { ExclusionManager } from "./ExclusionManager";
import {
  computePageMetrics,
  EMPTY_RESOLVED_CHROME,
  type PageMetrics,
  type ResolvedChrome,
  type PageChromeContribution,
  type PageChromeMeasureInput,
} from "./PageMetrics";
import { fitLinesInCapacity } from "./splitLines";
import { runChromeLoop } from "./aggregateChrome";

export interface PageConfig {
  pageWidth: number;
  pageHeight: number;
  margins: { top: number; right: number; bottom: number; left: number };
  /**
   * Document-level default font family (e.g. "Georgia, serif" or "Inter, sans-serif").
   * When set, overrides the font family in every block style — paragraph, headings, etc.
   * Font sizes and weights defined by each block style are preserved.
   * Absent = use whatever family is declared in each block style.
   */
  fontFamily?: string;
  /**
   * When true, pagination is disabled. All blocks land on a single virtual page
   * and `y` grows unbounded. The tile renderer uses `DocumentLayout.totalContentHeight`
   * to size the scroll container. `pageHeight` is unused in this mode.
   */
  pageless?: boolean;
}

export interface LayoutPage {
  pageNumber: number;
  blocks: LayoutBlock[];
}

/**
 * A float image that has been lifted out of the normal flow.
 * Produced by the Pass 2 float analysis step in layoutDocument.
 * Consumed by PageRenderer to draw the image at its absolute position.
 */
export interface FloatLayout {
  /** ProseMirror doc position of the float anchor span */
  docPos: number;
  /** Page this float appears on (1-based) */
  page: number;
  /** Left edge in page coordinates */
  x: number;
  /** Top edge in page coordinates */
  y: number;
  width: number;
  height: number;
  /** wrappingMode value — 'square-left' | 'square-right' | 'top-bottom' | 'behind' | 'front' */
  mode: string;
  /** The ProseMirror image node */
  node: Node;
  /** Absolute Y in continuous layout space. Set by resolveFloatsGlobalY(). */
  globalY?: number;
  /**
   * Pass 1 y-coordinate of the anchor block — stored so Pass 4 can apply the
   * correct yDelta correction without overwriting Fix 1's stacking offset.
   * Pass 4 computes: newY = f.y + (finalAnchorY - anchorBlockY), which shifts
   * the float by exactly how much the anchor block moved in Pass 3, preserving
   * any extra downward offset that float stacking added.
   */
  anchorBlockY: number;
  /**
   * Page number of the anchor span (where the image node lives in the doc).
   * May differ from `page` when float stacking pushes the float past the page
   * bottom and it overflows onto the next page. Pass 4 uses this to avoid
   * resetting the float's page back to the anchor's page.
   */
  anchorPage: number;
}

/**
 * One page-part of one source block — the atom the tile renderer paints.
 *
 * Unsplit blocks produce a single fragment (fragmentCount = 1).
 * Blocks split across pages produce N fragments (one per page they span).
 *
 * Sorted by page ascending, then y ascending within each page. This ordering
 * enables O(log N) binary search in pageless mode and O(1) page lookup in
 * paged mode via DocumentLayout.fragmentsByPage.
 */
export interface LayoutFragment {
  /** 0-based index of this part within its source block. 0 for unsplit. */
  fragmentIndex: number;
  /** Total parts this source block was split into. 1 for unsplit. */
  fragmentCount: number;
  /** nodePos of the original unsplit source block. */
  sourceNodePos: number;
  /** Page number (1-based). */
  page: number;
  /** Left edge in page-local coordinates. */
  x: number;
  /** Top edge in page-local coordinates. */
  y: number;
  /** Width of the block content area. */
  width: number;
  /** Height of this fragment (lines only, no spaceBefore/spaceAfter). */
  height: number;
  /**
   * Index of the first line in block.lines that this fragment renders.
   * Always 0 in the current implementation — reserved for the future
   * shared-FlowBlock.lines optimization where all fragments of a split
   * block point into a single LayoutLine[] without copying.
   */
  lineStart: number;
  /** Number of lines this fragment renders (block.lines.length). */
  lineCount: number;
  /** The LayoutBlock this fragment was produced from — used by drawBlock(). */
  block: LayoutBlock;
}

export interface DocumentLayout {
  pages: LayoutPage[];
  pageConfig: PageConfig;
  /**
   * Increments on every layout run. PageRenderer checks this before drawing
   * to abort stale renders when the document changes mid-scroll.
   */
  version: number;
  /**
   * Total scroll height of the document in CSS pixels.
   * Paged mode:   pages.length * pageHeight  (computed by runPipeline).
   * Pageless mode: final block bottom + bottom margin (computed by runPipeline).
   * Used by TileManager to size the scroll container.
   */
  totalContentHeight: number;
  /**
   * True when the layout was stopped early via `maxBlocks`. The pages
   * present are correct; blocks beyond the cutoff have not been measured.
   * Editor schedules a background pass to complete the layout.
   */
  isPartial?: boolean;
  /**
   * Saved cursor state for O(N) incremental chunked layout.
   * Present when isPartial:true. Pass back via PageLayoutOptions.resumption
   * to continue exactly where this run stopped — avoids O(N²) re-iteration.
   */
  resumption?: LayoutResumption;
  /**
   * Float images lifted out of the normal text flow.
   * Each entry has absolute page coordinates so PageRenderer can draw it.
   * Absent (or empty) when the document has no floating images.
   */
  floats?: FloatLayout[];
  /**
   * Snapshot of the Pass 1 page/block positions BEFORE runFloatPass mutated
   * them. Set only when the layout contains floats.
   *
   * Phase 1b early termination copies blocks from previousLayout. If it
   * copied from the float-processed pages, those blocks would carry stale
   * Pass-3 yDelta values. When the new run's Pass 3 then adds its own yDelta
   * on top, positions double-shift and blocks overflow the page, disappearing
   * from the visible area. Phase 1b must copy from these clean Pass 1
   * positions so runFloatPass starts from a correct baseline every time.
   */
  _pass1Pages?: LayoutPage[];
  /**
   * Flat fragment index — one entry per page-part of each block, sorted by
   * page then y. Used by the tile renderer for O(log N) binary search in
   * pageless mode. Absent on partial (streaming) layouts.
   */
  fragments?: LayoutFragment[];
  /**
   * Fragments grouped by page (0-indexed: fragmentsByPage[pageNumber - 1]).
   * Used by the tile renderer for O(1) lookup in paged mode.
   * Absent on partial (streaming) layouts.
   */
  fragmentsByPage?: LayoutFragment[][];

  // ── Multi-surface layout fields ───────────────────────────────────────────
  //
  // Optional so older call sites that construct DocumentLayout literals
  // without them continue to compile. Consumers that rely on the values
  // check for presence or fall back to legacy behavior.

  /** Per-page metrics, one entry per page. Optional for test fixtures. */
  metrics?: PageMetrics[];

  /** Monotonic per-run identity for cache invalidation. Currently aliased to `version`. */
  runId?: number;
  /** Whether the chrome aggregator converged. Always "stable" until iterative contributors exist. */
  convergence?: "stable" | "exhausted";
  /** How many iterations the chrome aggregator ran. Debug/telemetry only. */
  iterationCount?: number;
  /**
   * @internal
   * Chrome contributor payloads keyed by contribution.name. runPipeline always
   * writes an object (possibly empty); absent only on test fixtures that
   * bypass runPipeline. Seeds the next run's previousRunPayload.
   */
  _chromePayloads?: Record<string, unknown>;
}

/**
 * Saved cursor state from a partial layout pass.
 * Returned with isPartial:true; passed back as PageLayoutOptions.resumption
 * to resume from the exact item where the previous chunk stopped.
 */
export interface LayoutResumption {
  /** The flat item list — cached to avoid re-walking the doc. */
  items: LayoutItem[];
  /** Index of the first item that was NOT yet processed. */
  nextItemIndex: number;
  /** Pages completely finished by previous chunks. */
  completedPages: LayoutPage[];
  /** The page currently being built (may have partial blocks). */
  currentPage: LayoutPage;
  /** Y cursor position on currentPage. */
  currentY: number;
  /** spaceAfter of the last placed block, for margin collapsing. */
  prevSpaceAfter: number;
  /** Layout version carried through all chunks. */
  version: number;
  /**
   * Number of fully-completed pages as of the end of the previous chunk.
   * Used by LayoutCoordinator to skip clearing charMap entries for pages
   * that are already final and have not changed in this chunk.
   */
  prevPageCount: number;
}

/**
 * Cached measurement result for a single block node.
 * Keyed by Node reference in a WeakMap — ProseMirror's structural sharing
 * guarantees that unchanged nodes keep the same JS object identity across
 * transactions, so pointer equality is a perfect cache key.
 *
 * All fields are position-independent: LayoutLine x-coordinates are relative
 * to the line origin, not the page. The cached entry is valid as long as
 * availableWidth matches (invalidated if margins change).
 */
export interface MeasureCacheEntry {
  /** Content width the block was measured at — invalidates entry if margins change */
  availableWidth: number;
  /**
   * The nodePos at which these lines were last measured. Span docPos values
   * are absolute and must be adjusted when the block shifts in the document.
   */
  nodePos: number;
  height: number;
  lines: LayoutLine[];
  spaceBefore: number;
  spaceAfter: number;
  blockType: string;
  align: BlockStyle["align"];
  /**
   * Phase 1b — early termination.
   *
   * The targetY (y + gap, page-local, BEFORE overflow) and page number where
   * this block was last placed. If the current run arrives at the same values,
   * all downstream blocks are guaranteed to be identical to `previousLayout`
   * and the loop can exit early.
   *
   * Undefined on first layout (cache entries have no placement history yet).
   */
  placedTargetY?: number;
  placedPage?: number;

  /** Run that last placed this block — guards early-termination across chrome changes. */
  placedRunId?: number;
  /** contentTop of the page this block was placed on — detects stale cache from chrome changes. */
  placedContentTop?: number;
}

/**
 * Geometry-only config for buildBlockFlow — no page height since this stage
 * performs measurement only; pagination lives in layoutDocument's loop.
 */
export interface FlowConfig {
  margins: PageConfig["margins"];
  contentWidth: number;
}

/**
 * Measurement result for a single block in document flow order.
 * Position-independent — no page assignments. The pagination loop in
 * layoutDocument consumes FlowBlock[] and decides page placement.
 */
export interface FlowBlock {
  /** Original ProseMirror node. */
  node: Node;
  nodePos: number;
  /** Measured lines — position-independent (lineHeight only, no absolute Y). */
  lines: LayoutLine[];
  height: number;
  /** Block style spacing (styleKey-aware, e.g. list_item overrides paragraph). */
  spaceBefore: number;
  spaceAfter: number;
  availableWidth: number;
  blockType: string;
  align: BlockStyle["align"];
  listMarker?: string;
  listMarkerX?: number;
  indentLeft: number;
  /** True if any line span is a zero-width float anchor. */
  hasFloatAnchor: boolean;
  /** djb2 hash of nodePos + textContent + availableWidth for incremental re-layout. */
  inputHash: number;
  /** Absolute Y in continuous layout space. Set by assignGlobalY(). */
  globalY?: number;
  /** True when this entry represents a hard page break node. */
  isPageBreak?: true;
  /** True when the block measurement was a cache hit. */
  wasCacheHit: boolean;
  // Phase 1b: cache snapshot taken before this run's measurement.
  preCachedTargetY?: number;
  preCachedPage?: number;
  /** Cached placedRunId snapshot for early-termination guard. */
  preCachedRunId?: number;
  /** Cached placedContentTop snapshot for early-termination guard. */
  preCachedContentTop?: number;
  prevNodePos?: number;
}

export interface PageLayoutOptions {
  pageConfig: PageConfig;
  measurer: TextMeasurer;
  fontConfig?: FontConfig;
  /**
   * Pass the previous version so callers can increment it.
   * Defaults to 1 on first layout.
   */
  previousVersion?: number;
  /** Optional font modifier map from the ExtensionManager. Enables extensions to declare font effects. */
  fontModifiers?: Map<string, FontModifier>;
  /**
   * Block measurement cache keyed by Node reference.
   * When provided, unchanged blocks (same ProseMirror Node object) skip the
   * layoutBlock call entirely — O(1) cache hit instead of O(chars) re-measure.
   * The Editor owns this WeakMap and passes it on every runPipeline call.
   */
  measureCache?: WeakMap<Node, MeasureCacheEntry>;
  /**
   * Phase 1b — early termination.
   *
   * Pass the layout produced by the immediately preceding run. When the loop
   * finds a cache-hit block at an identical (targetY, page) as last time, all
   * downstream blocks are guaranteed unchanged — remaining pages are copied
   * from this layout instead of re-iterating.
   */
  previousLayout?: DocumentLayout;
  /**
   * Streaming layout — stop after measuring this many blocks and return
   * a partial layout (`isPartial: true`). The Editor uses this to show the
   * first visible pages immediately, then completes the rest via
   * requestIdleCallback so the browser can paint without blocking.
   *
   * When undefined the full document is always laid out in one pass.
   */
  maxBlocks?: number;
  /**
   * Resume a chunked layout pass from a previous partial result.
   * When provided, skips collectLayoutItems() and starts directly from
   * resumption.nextItemIndex with the saved page/Y cursor state.
   * Makes each chunk O(chunkSize) instead of O(totalBlocks) — total O(N).
   */
  resumption?: LayoutResumption;
  /**
   * Page chrome contributors from the ExtensionManager. Empty or omitted →
   * runChromeLoop takes the zero-contributor fast path (one iteration,
   * EMPTY_RESOLVED_CHROME, identical to pre-aggregator behaviour).
   */
  pageChromeContributions?: PageChromeContribution[];
  /** Inline object registry — enables dynamic measurement for tokens during layout. */
  inlineRegistry?: InlineRegistry;
}

/** A4 at 96dpi with 1-inch margins */
export const defaultPageConfig: PageConfig = {
  pageWidth: 794,
  pageHeight: 1123,
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
};

export const defaultPagelessConfig: PageConfig = {
  pageWidth: 885,
  pageHeight: 0,
  margins: { top: 40, right: 73, bottom: 40, left: 73 },
  pageless: true,
};

/**
 * runPipeline — top-level layout orchestrator.
 *
 * Drives all three pipeline stages in order:
 *   Stage 1    buildBlockFlow          — position-independent measurement
 *   Stage 1.75 resolveFloats           — global-Y constraint solving (pre-pagination)
 *   Stage 2    paginateFlow            — assign blocks to pages
 *   Stage 3    projectFloatsOntoPages  — project global-Y floats onto paginated pages
 *
 * Returns a fully positioned DocumentLayout. Does NOT touch the CharacterMap.
 * This function is the single source of truth for orchestration; both
 * LayoutCoordinator and tests call it instead of duplicating the logic.
 */
// Recursion guard — throws if runPipeline is called while already on the stack.
// Chrome contributors must use runMiniPipeline() instead.
let _runPipelineDepth = 0;

/** Test-only: set the recursion depth counter to simulate re-entry. */
export function __setRunPipelineDepthForTest(n: number): void {
  _runPipelineDepth = n;
}

export function runPipeline(
  doc: Node,
  options: PageLayoutOptions,
): DocumentLayout {
  // Recursion guard — use runMiniPipeline() from chrome contributor hooks.
  if (_runPipelineDepth > 0) {
    throw new Error(
      "[runPipeline] recursive call detected. Chrome contributors must call " +
      "runMiniPipeline() from their measure() hook, not runPipeline(). " +
      "runPipeline invokes aggregateChrome which would re-enter every " +
      "contributor and infinite-loop.",
    );
  }
  _runPipelineDepth++;
  try {
    return _runPipelineBody(doc, options);
  } finally {
    _runPipelineDepth--;
  }
}

/**
 * Flow-only pipeline result. Pages + metrics are populated, floats/fragments
 * are not — those are applied once after the chrome-aggregator loop converges.
 * Chrome contributors re-run this per iteration via the aggregator.
 */
export interface FlowPipelineResult {
  /** Pass-1 DocumentLayout with pages, metrics, runId. No floats, no fragments. */
  layout: DocumentLayout;
  /** True when streaming cutoff stopped pagination mid-document. */
  isPartial: boolean;
  /** Geometry + font context — float projection needs all of these. */
  margins: PageConfig["margins"];
  pageWidth: number;
  contentWidth: number;
  fontConfig: FontConfig;
  fontModifiers: Map<string, FontModifier> | undefined;
  measurer: TextMeasurer;
  /** Y cursor at end of pagination — used for pageless totalContentHeight. */
  y: number;
  /** FlowBlocks with globalY set. Used by _runPipelineBody for float page assignment. */
  flows: FlowBlock[];
  /**
   * Floats resolved in global-Y space by the pre-pagination constraint loop.
   * null when the document has no float anchors. Used by _runPipelineBody
   * for page-local float projection.
   */
  resolvedFloats: { floats: FloatLayout[]; exclusionMgr: ExclusionManager } | null;
}

/**
 * Stage 1 + Stage 2 of the pipeline (measure + paginate). Extracted so the
 * chrome aggregator can call it N times per layout run while floats + fragments
 * only run once on the final, converged pages.
 */
export function runFlowPipeline(
  doc: Node,
  options: PageLayoutOptions,
  resolved: ResolvedChrome,
  runId: number,
): FlowPipelineResult {
  const { fontModifiers, measureCache, previousLayout, pageConfig, measurer } = options;
  const baseConfig = options.fontConfig ?? defaultFontConfig;
  const fontConfig = applyPageFont(baseConfig, pageConfig.fontFamily ?? DEFAULT_FONT_FAMILY);

  const { pageWidth, pageHeight, margins } = pageConfig;
  const contentWidth = pageWidth - margins.left - margins.right;
  const maxBlocks = options.maxBlocks;

  // Per-page metrics with single-entry cache (pages advance sequentially).
  let cachedMetricsPage = -1;
  let cachedMetrics: PageMetrics | null = null;
  const metricsFor = (pageNumber: number): PageMetrics => {
    if (cachedMetricsPage === pageNumber && cachedMetrics !== null) {
      return cachedMetrics;
    }
    cachedMetrics = computePageMetrics(pageConfig, resolved, pageNumber);
    cachedMetricsPage = pageNumber;
    return cachedMetrics;
  };

  // Resumption: restore cursor from prior chunk instead of re-walking the doc.
  const r = options.resumption;
  const items = r ? r.items : collectLayoutItems(doc, fontConfig);
  const startIndex = r ? r.nextItemIndex : 0;
  const pages: LayoutPage[] = r ? r.completedPages : [];
  const currentPage: LayoutPage = r ? r.currentPage : { pageNumber: 1, blocks: [] };
  const initY = r ? r.currentY : metricsFor(1).contentTop;
  const initPrevSpaceAfter = r ? r.prevSpaceAfter : 0;
  const chunkVersion = r ? r.version : runId;

  // Stage 1: measure.
  const flowConfig: FlowConfig = { margins, contentWidth };
  const flowResult = buildBlockFlow(
    items, startIndex, flowConfig, fontConfig,
    measurer, fontModifiers, measureCache, maxBlocks, options.inlineRegistry,
  );

  // Stage 1.5: assign continuous global Y coordinates.
  // Purely additive — stamps globalY on each flow for future use.
  assignGlobalY(flowResult.flows, initY);

  // Stage 1.75: pre-pagination float constraint resolution.
  //
  // 1. Resolve float positions in global-Y space
  // 2. Compute pre-reflow page boundaries (for float page membership)
  // 3. Run constraint loop (reflow text around floats)
  //
  // The key invariant: float page membership is determined by the UNCONSTRAINED
  // anchor position. Text reflow grows blocks, but that growth must not change
  // which page a float belongs to (matches CSS spec / browser behavior).

  // Collect explicit page break barriers.
  const pageBreakBarriers: number[] = [];
  for (const flow of flowResult.flows) {
    if (flow.isPageBreak && flow.globalY !== undefined) {
      pageBreakBarriers.push(flow.globalY);
    }
  }

  // Compute estimated page boundaries from unconstrained flow heights.
  // Walk flows, accumulate heights, mark where paginateFlow will break.
  // These are globalY values where a page boundary occurs.
  if (!pageConfig.pageless && pageConfig.pageHeight > 0) {
    const pm1 = metricsFor(1);
    const pageContentHeight = pm1.contentHeight;
    if (pageContentHeight > 0) {
      let pageTopGlobalY = initY;
      let y = initY;
      let prevSpaceAfter = 0;
      let isFirstOnPage = true;
      for (const flow of flowResult.flows) {
        if (flow.isPageBreak || flow.globalY === undefined) continue;
        const gap = isFirstOnPage ? 0 : collapseMargins(prevSpaceAfter, flow.spaceBefore);
        const blockTop = y + gap;
        const blockBottom = blockTop + flow.height;
        const pageBottomGlobalY = pageTopGlobalY + pageContentHeight;

        if (blockBottom > pageBottomGlobalY && !isFirstOnPage) {
          // Page break before this block.
          pageBreakBarriers.push(pageBottomGlobalY);
          pageTopGlobalY = pageBottomGlobalY;
          isFirstOnPage = true;
          // Don't advance y — this block will be first on the new page.
          // Re-process it on the next iteration? No — the flow's globalY
          // is already set. We just mark the barrier. The flow will land
          // on the next page during actual pagination.
        }

        y = blockTop + flow.height;
        prevSpaceAfter = flow.spaceAfter;
        isFirstOnPage = false;
      }
    }
  }

  // Resolve float positions using global-Y + page break barriers.
  const resolvedFloats = resolveFloatsGlobalY(
    flowResult.flows, margins, pageWidth, contentWidth, pageBreakBarriers,
  );

  if (resolvedFloats) {
    // Fixed-point loop: reflow constrained blocks, then recompute downstream
    // globalY values. Float positions are resolved once above and are stable.
    for (let iter = 0; iter < 3; iter++) {
      const { changed, firstChangedIndex } = reflowConstrainedBlocks(
        flowResult.flows, resolvedFloats.exclusionMgr, margins, contentWidth,
        measurer, fontConfig, fontModifiers, options.inlineRegistry,
      );
      if (!changed) break;
      recomputeGlobalY(flowResult.flows, firstChangedIndex + 1);
    }
  }

  // Stage 2: paginate.
  const pr = paginateFlow(
    flowResult.flows, pageConfig, resolved, metricsFor, runId,
    {
      previousLayout,
      measureCache,
      pageless: pageConfig.pageless,
      init: { pages, page: currentPage, y: initY, prevSpaceAfter: initPrevSpaceAfter },
    },
  );

  const isPartial = flowResult.reachedCutoff && !pr.earlyTerminated;
  const context = {
    margins, pageWidth, contentWidth, fontConfig, fontModifiers, measurer,
  };

  if (isPartial) {
    const resumption: LayoutResumption = {
      items,
      nextItemIndex: flowResult.cutoffIndex,
      completedPages: pr.pages,
      currentPage: { ...pr.currentPage, blocks: [...pr.currentPage.blocks] },
      currentY: pr.y,
      prevSpaceAfter: pr.prevSpaceAfter,
      version: chunkVersion,
      prevPageCount: pr.pages.length,
    };
    const partialPages = [...pr.pages, pr.currentPage];
    const layout: DocumentLayout = {
      pages: partialPages,
      pageConfig,
      version: chunkVersion,
      isPartial: true,
      resumption,
      totalContentHeight: pageConfig.pageless
        ? pr.y + margins.bottom
        : partialPages.length * pageHeight,
      metrics: pr.metrics,
      runId,
      convergence: "stable",
      iterationCount: 1,
    };
    return { layout, isPartial: true, ...context, y: pr.y, flows: flowResult.flows, resolvedFloats: resolvedFloats ?? null };
  }

  const allPages = pr.earlyTerminated ? pr.pages : [...pr.pages, pr.currentPage];
  const layout: DocumentLayout = {
    pages: allPages,
    pageConfig,
    version: chunkVersion,
    totalContentHeight: 0,
    metrics: pr.metrics,
    runId,
    convergence: "stable",
    iterationCount: 1,
  };
  return { layout, isPartial: false, ...context, y: pr.y, flows: flowResult.flows, resolvedFloats: resolvedFloats ?? null };
}

function _runPipelineBody(
  doc: Node,
  options: PageLayoutOptions,
): DocumentLayout {
  const { pageConfig, previousLayout } = options;
  const { pageHeight, margins } = pageConfig;
  const version = (options.previousVersion ?? 0) + 1;
  const runId = version; // Same identity for now; can diverge later if needed.

  // Resolve fontConfig once — shared with chrome contributors' measure() input
  // so mini-doc layouts inside their hooks use the same typography.
  const baseConfig = options.fontConfig ?? defaultFontConfig;
  const resolvedFontConfig = applyPageFont(
    baseConfig,
    pageConfig.fontFamily ?? DEFAULT_FONT_FAMILY,
  );
  const measureInput: PageChromeMeasureInput = {
    doc,
    pageConfig,
    measurer: options.measurer,
    fontConfig: resolvedFontConfig,
  };

  const contributions = options.pageChromeContributions ?? [];
  const prevRunPayloads = previousLayout?._chromePayloads ?? {};
  const prevRunFlowLayout = previousLayout ?? null;

  // Stages 1 + 2 — measure + paginate, wrapped in the chrome aggregator loop.
  // Zero contributors short-circuits after iteration 1 with identical output
  // to the pre-aggregator single-pass path.
  const chromeResult = runChromeLoop(
    doc, options, contributions, runId,
    prevRunPayloads, prevRunFlowLayout, measureInput,
  );
  const fp = chromeResult.flow;

  // Propagate aggregator outcome + payloads into the layout returned to callers.
  const layoutWithChrome: DocumentLayout = {
    ...fp.layout,
    convergence: chromeResult.convergence,
    iterationCount: chromeResult.iterationCount,
    _chromePayloads: chromeResult.chromePayloads,
  };

  // Stage 3: float page projection.
  // Constraint resolution happened pre-pagination (Stage 1.75). This pass
  // projects global-Y float positions onto pages and handles overflow.
  // When resolvedFloats is null, the document has no floats — skip entirely.
  const floated = fp.resolvedFloats
    ? projectFloatsOntoPages(layoutWithChrome, fp.resolvedFloats, pageConfig)
    : layoutWithChrome;
  if (fp.isPartial) return floated;

  // Stage 4: fragment index + totalContentHeight.
  const { fragments, fragmentsByPage } = buildFragments(floated.pages);
  const totalContentHeight = pageConfig.pageless
    ? fp.y + margins.bottom
    : floated.pages.length * pageHeight;
  return { ...floated, fragments, fragmentsByPage, totalContentHeight };
}

/** Options bag for paginateFlow — cross-cutting context + resumption cursor. */
export interface PaginateFlowOptions {
  previousLayout?: DocumentLayout | undefined;
  measureCache?: WeakMap<Node, MeasureCacheEntry> | undefined;
  pageless?: boolean | undefined;
  /** Initial page cursor. Fresh run: pages=[], page=empty page 1. Resumption: from prior chunk. */
  init: {
    pages: LayoutPage[];
    page: LayoutPage;
    y: number;
    prevSpaceAfter: number;
  };
}

/** Result of paginateFlow. `metrics` aligns 1:1 with the pages the caller uses. */
export interface PaginateFlowResult {
  /** All completed pages. When earlyTerminated, currentPage is already included. */
  pages: LayoutPage[];
  /** The page currently being built — only valid when earlyTerminated === false. */
  currentPage: LayoutPage;
  /** Y cursor at end of loop — only valid when earlyTerminated === false. */
  y: number;
  /** Spacing state at end — only valid when earlyTerminated === false. */
  prevSpaceAfter: number;
  /** True when Phase 1b fired and all remaining pages were copied from previousLayout. */
  earlyTerminated: boolean;
  /**
   * Per-page metrics accumulated during pagination. Aligned with the pages
   * the caller delivers: `earlyTerminated ? pages : [...pages, currentPage]`.
   */
  metrics: PageMetrics[];
}

/** Stage 2: assign measured FlowBlocks to pages. All positions read through metricsFor(). */
export function paginateFlow(
  flows: FlowBlock[],
  pageConfig: PageConfig,
  resolved: ResolvedChrome,
  metricsFor: (pageNumber: number) => PageMetrics,
  runId: number,
  opts: PaginateFlowOptions,
): PaginateFlowResult {
  // `resolved` is threaded through metricsFor; reserved for future cache checks
  // keyed off resolved.metricsVersion. Read access today is intentional no-op.
  void resolved;

  const { previousLayout, measureCache, pageless, init } = opts;
  const { margins } = pageConfig;
  const pages = init.pages;
  let currentPage = init.page;
  let y = init.y;
  let prevSpaceAfter = init.prevSpaceAfter;

  // Metrics aligned with [...pages, currentPage]. When early-term pushes
  // currentPage into pages, this invariant still holds because the trailing
  // entry is re-used as the corresponding pages entry.
  const metrics: PageMetrics[] = [];
  for (const p of pages) metrics.push(metricsFor(p.pageNumber));
  metrics.push(metricsFor(currentPage.pageNumber));

  // Phase 1b: only valid after we've seen at least one cache miss (= the edit point).
  let seenCacheMiss = false;
  let earlyTerminated = false;

  for (const flow of flows) {
    // ── Hard page break (skipped in pageless mode) ───────────────────────────
    if (flow.isPageBreak && !pageless) {
      pages.push(currentPage);
      currentPage = newPage(pages.length + 1);
      y = metricsFor(currentPage.pageNumber).contentTop;
      metrics.push(metricsFor(currentPage.pageNumber));
      prevSpaceAfter = 0;
      continue;
    }

    const { node, nodePos } = flow;

    if (!flow.wasCacheHit) seenCacheMiss = true;

    // ── Margin collapsing ────────────────────────────────────────────────────
    const isFirstOnPage = currentPage.blocks.length === 0;
    const gap = isFirstOnPage
      ? 0
      : collapseMargins(prevSpaceAfter, flow.spaceBefore);

    const targetY = y + gap;
    const blockX = margins.left + flow.indentLeft;
    const blockWidth = flow.availableWidth;

    // Build a positioned LayoutBlock from the FlowBlock measurements.
    const buildBlock = (x: number, bY: number): LayoutBlock => ({
      node,
      nodePos,
      x,
      y: bY,
      width: blockWidth,
      height: flow.height,
      lines: flow.lines,
      spaceBefore: flow.spaceBefore,
      spaceAfter: flow.spaceAfter,
      blockType: flow.blockType,
      align: flow.align,
      availableWidth: blockWidth,
    });

    const block = buildBlock(blockX, targetY);

    if (flow.listMarker !== undefined) {
      block.listMarker = flow.listMarker;
      block.listMarkerX = flow.listMarkerX!;
      block.blockType = "list_item";
    }

    // ── Per-page geometry snapshot ───────────────────────────────────────────
    // Computed once per outer-loop iteration. `currentMetrics` is stable for
    // the duration of this block's placement — it only changes when we advance
    // to a new page (leaf reflow or split-loop advance), at which point we
    // re-fetch with the new page number.
    const currentMetrics = metricsFor(currentPage.pageNumber);

    // ── Page overflow check (disabled in pageless mode) ───────────────────────
    const blockBottom = targetY + flow.height;
    const pageBottom = currentMetrics.contentBottom;
    const contentHeight = currentMetrics.contentHeight;
    // Text blocks can always be split; leaf blocks need the !isFirstOnPage guard
    // to avoid infinite empty-page loops when the block exceeds contentHeight.
    const overflows = !pageless && blockBottom > pageBottom && (!isFirstOnPage || flow.lines.length > 0);

    // ── Layout debug log ──────────────────────────────────────────────────────
    if ((globalThis as Record<string,unknown>).__LAYOUT_DEBUG__) {
      console.log(
        `[layout] block="${node.type.name}" nodePos=${nodePos}` +
        ` page=${currentPage.pageNumber} isFirstOnPage=${isFirstOnPage}` +
        ` gap=${gap.toFixed(1)} y=${y.toFixed(1)} targetY=${targetY.toFixed(1)}` +
        ` height=${flow.height.toFixed(1)} blockBottom=${blockBottom.toFixed(1)}` +
        ` pageBottom=${pageBottom.toFixed(1)} overflows=${overflows}` +
        ` lines=${flow.lines.length}`
      );
    }

    if (!overflows) {
      // ── Normal placement ───────────────────────────────────────────────────
      if ((globalThis as Record<string,unknown>).__LAYOUT_DEBUG__) {
        console.log(`  → NORMAL PLACEMENT (page ${currentPage.pageNumber})`);
      }
      currentPage.blocks.push(block);
      y = targetY + flow.height;
      prevSpaceAfter = flow.spaceAfter;
    } else if (flow.lines.length === 0) {
      // ── Leaf block (image, HR): move whole block to next page ──────────────
      const tooTallForAnyPage = flow.height > contentHeight;
      if (tooTallForAnyPage) {
        if ((globalThis as Record<string,unknown>).__LAYOUT_DEBUG__) {
          console.log(`  → LEAF too-tall: forced onto current page ${currentPage.pageNumber}`);
        }
        currentPage.blocks.push(block);
        y = targetY + flow.height;
        prevSpaceAfter = flow.spaceAfter;
      } else {
        if ((globalThis as Record<string,unknown>).__LAYOUT_DEBUG__) {
          console.log(`  → LEAF moved to page ${pages.length + 2}`);
        }
        pages.push(currentPage);
        currentPage = newPage(pages.length + 1);
        // Fetch the NEW page's metrics — differentFirstPage or footnote bands
        // can make this differ from the page we just left.
        const newPageContentTop = metricsFor(currentPage.pageNumber).contentTop;
        metrics.push(metricsFor(currentPage.pageNumber));
        y = newPageContentTop;
        prevSpaceAfter = 0;

        const reflow = buildBlock(blockX, newPageContentTop);
        if (flow.listMarker !== undefined) {
          reflow.listMarker = flow.listMarker;
          reflow.listMarkerX = flow.listMarkerX!;
          reflow.blockType = "list_item";
        }

        currentPage.blocks.push(reflow);
        y = newPageContentTop + flow.height;
        prevSpaceAfter = flow.spaceAfter;
      }
    } else {
      // ── Text block: split lines across page boundaries ─────────────────────
      if ((globalThis as Record<string,unknown>).__LAYOUT_DEBUG__) {
        console.log(`  → SPLIT PATH entered (${flow.lines.length} lines total)`);
      }
      let remainingLines = flow.lines;
      let hasPlacedAnyPart = false;
      let currentPartStartY = targetY;
      let fragmentIdx = 0;
      // Tracks whether gap-suppression has already been applied for this block.
      // If linesFit=0 fires a second time after gap-suppress, force 1 line
      // (sub-pixel shortfall: pageBottom - y is just barely less than lineHeight).
      let gapSuppressApplied = false;

      while (remainingLines.length > 0) {
        const partStartY = currentPartStartY;
        // Per-page metrics snapshot for THIS iteration of the split loop.
        // Re-fetched on every pass because the page may have advanced via
        // the "advance to next" branch below.
        const splitMetrics = metricsFor(currentPage.pageNumber);
        const pageAvailable = splitMetrics.contentBottom - partStartY;

        const fitResult = fitLinesInCapacity(remainingLines, pageAvailable);
        let linesFit = fitResult.fitted.length;
        let heightFit = fitResult.fittedHeight;

        if ((globalThis as Record<string,unknown>).__LAYOUT_DEBUG__) {
          console.log(
            `    split iter: page=${currentPage.pageNumber} partStartY=${partStartY.toFixed(1)}` +
            ` pageAvailable=${pageAvailable.toFixed(1)} linesFit=${linesFit}` +
            ` remaining=${remainingLines.length} hasPlacedAnyPart=${hasPlacedAnyPart}` +
            ` firstLineH=${remainingLines[0]!.lineHeight.toFixed(1)}`
          );
        }

        if (linesFit === 0) {
          if (hasPlacedAnyPart || partStartY === splitMetrics.contentTop || gapSuppressApplied) {
            // Force one line: top-of-page guard or sub-pixel shortfall.
            if ((globalThis as Record<string,unknown>).__LAYOUT_DEBUG__) {
              console.log(`    → linesFit=0 FORCE 1 line (top-of-page / sub-pixel guard)`);
            }
            linesFit = 1;
            heightFit = remainingLines[0]!.lineHeight;
          } else if (splitMetrics.contentBottom - y >= remainingLines[0]!.lineHeight - 0.5) {
            // Inter-block gap pushed targetY into dead zone. Suppress and retry.
            if ((globalThis as Record<string,unknown>).__LAYOUT_DEBUG__) {
              console.log(`    → linesFit=0 GAP SUPPRESS: retry at y=${y.toFixed(1)}`);
            }
            currentPartStartY = y;
            gapSuppressApplied = true;
            continue;
          } else {
            // No room on this page at all — advance to next.
            if ((globalThis as Record<string,unknown>).__LAYOUT_DEBUG__) {
              console.log(`    → linesFit=0 ADVANCE to page ${pages.length + 2}`);
            }
            pages.push(currentPage);
            currentPage = newPage(pages.length + 1);
            metrics.push(metricsFor(currentPage.pageNumber));
            prevSpaceAfter = 0;
            currentPartStartY = metricsFor(currentPage.pageNumber).contentTop;
            gapSuppressApplied = false;
            continue;
          }
        }

        const isLastPart = linesFit >= remainingLines.length;
        const isCont = hasPlacedAnyPart;
        const partLines = remainingLines.slice(0, linesFit);

        const partBlock: LayoutBlock = {
          node,
          nodePos,
          x: blockX,
          y: partStartY,
          width: blockWidth,
          height: heightFit,
          lines: partLines,
          spaceBefore: isCont ? 0 : flow.spaceBefore,
          spaceAfter: isLastPart ? flow.spaceAfter : 0,
          blockType: flow.blockType,
          align: flow.align,
          availableWidth: blockWidth,
          ...(isCont ? { isContinuation: true as const } : {}),
          ...(!isLastPart ? { continuesOnNextPage: true as const } : {}),
          // Only stamp fragment identity on actual split parts (not unsplit blocks).
          ...(isCont || !isLastPart ? { fragmentIndex: fragmentIdx, sourceNodePos: nodePos } : {}),
        };

        if (flow.listMarker !== undefined) {
          if (!isCont) {
            partBlock.listMarker = flow.listMarker;
            partBlock.listMarkerX = flow.listMarkerX!;
          }
          partBlock.blockType = "list_item";
        }

        if ((globalThis as Record<string,unknown>).__LAYOUT_DEBUG__) {
          console.log(
            `    → PLACED ${linesFit} lines on page ${currentPage.pageNumber}` +
            ` at y=${partStartY.toFixed(1)} isCont=${isCont} isLastPart=${isLastPart}`
          );
        }
        currentPage.blocks.push(partBlock);
        hasPlacedAnyPart = true;
        fragmentIdx++;

        if (!isLastPart) {
          pages.push(currentPage);
          currentPage = newPage(pages.length + 1);
          metrics.push(metricsFor(currentPage.pageNumber));
          prevSpaceAfter = 0;
          currentPartStartY = metricsFor(currentPage.pageNumber).contentTop;
          remainingLines = remainingLines.slice(linesFit);
        } else {
          y = partStartY + heightFit;
          prevSpaceAfter = flow.spaceAfter;
          break;
        }
      }
    }

    // ── Update placement tracking in cache ────────────────────────────────────
    const cachedEntry = measureCache?.get(node);
    if (cachedEntry) {
      cachedEntry.placedTargetY = targetY;
      cachedEntry.placedPage = currentPage.pageNumber;
      cachedEntry.placedRunId = runId;
      cachedEntry.placedContentTop = metricsFor(currentPage.pageNumber).contentTop;
    }

    // Early termination: copy downstream pages from previous run when
    // targetY, page, runId, and contentTop all match the cached placement.
    if (
      previousLayout &&
      seenCacheMiss &&
      flow.wasCacheHit &&
      flow.preCachedTargetY !== undefined &&
      flow.preCachedPage !== undefined &&
      flow.preCachedRunId !== undefined &&
      flow.preCachedContentTop !== undefined &&
      targetY === flow.preCachedTargetY &&
      currentPage.pageNumber === flow.preCachedPage &&
      previousLayout.runId !== undefined &&
      flow.preCachedRunId === previousLayout.runId &&
      flow.preCachedContentTop === currentMetrics.contentTop
    ) {
      const delta = flow.prevNodePos !== undefined ? nodePos - flow.prevNodePos : 0;
      const prevPages = previousLayout._pass1Pages ?? previousLayout.pages;
      const curPageIdx = currentPage.pageNumber - 1;

      if (curPageIdx < prevPages.length) {
        const prevCurPage = prevPages[curPageIdx]!;
        const oldNodePos = nodePos - delta;
        const triggerIdx = prevCurPage.blocks.findIndex((b) => b.nodePos === oldNodePos);

        if (triggerIdx >= 0) {
          for (let bi = triggerIdx + 1; bi < prevCurPage.blocks.length; bi++) {
            currentPage.blocks.push(shiftBlock(prevCurPage.blocks[bi]!, delta, measureCache));
          }
          // currentPage pushed into pages — its metrics entry is already the
          // trailing one, now aligned 1:1 with pages.
          pages.push(currentPage);

          for (let pi = curPageIdx + 1; pi < prevPages.length; pi++) {
            const prevPage = prevPages[pi]!;
            pages.push({
              pageNumber: prevPage.pageNumber,
              blocks: prevPage.blocks.map((b) => shiftBlock(b, delta, measureCache)),
            });
            metrics.push(metricsFor(prevPage.pageNumber));
          }

          earlyTerminated = true;
          break;
        }
      }
    }
  }

  return { pages, currentPage, y, prevSpaceAfter, earlyTerminated, metrics };
}

/**
 * Stage 1 of the layout pipeline: measure every block in document order and
 * return a flat array of position-independent FlowBlocks.
 *
 * No page boundaries are applied here — that is paginateFlow's job.
 * This function is pure measurement: same inputs always produce the same output.
 *
 * @param items      Flat item list from collectLayoutItems() or resumption cache.
 * @param startIndex First item to process (0 for fresh layout, resumption.nextItemIndex for chunks).
 * @param config     Content area geometry — no pageHeight, no pagination decisions.
 * @param maxBlocks  Stop early after this many blocks (streaming layout support).
 */

// ── Helpers used by buildBlockFlow ───────────────────────────────────────────

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function computeInputHash(nodePos: number, node: Node, availableWidth: number): number {
  return djb2(`${nodePos}:${(node as { textContent?: string }).textContent ?? ""}:${availableWidth}`);
}

function blockHasFloatAnchor(lines: LayoutLine[]): boolean {
  for (const line of lines) {
    for (const span of line.spans) {
      if (span.kind !== "object" || span.width !== 0) continue;
      const wm = span.node.attrs["wrappingMode"] as string | undefined;
      if (wm && wm !== "inline") return true;
    }
  }
  return false;
}

export function buildBlockFlow(
  items: LayoutItem[],
  startIndex: number,
  config: FlowConfig,
  fontConfig: FontConfig,
  measurer: TextMeasurer,
  fontModifiers: Map<string, FontModifier> | undefined,
  measureCache: WeakMap<Node, MeasureCacheEntry> | undefined,
  maxBlocks?: number,
  inlineRegistry?: InlineRegistry,
): { flows: FlowBlock[]; reachedCutoff: boolean; cutoffIndex: number } {
  const { margins, contentWidth } = config;
  const flows: FlowBlock[] = [];
  let processedBlocks = 0;

  for (let itemIdx = startIndex; itemIdx < items.length; itemIdx++) {
    const item = items[itemIdx]!;

    if (item.isPageBreak) {
      flows.push({
        node: item.node,
        nodePos: item.nodePos,
        lines: [],
        height: 0,
        spaceBefore: 0,
        spaceAfter: 0,
        availableWidth: 0,
        blockType: "pageBreak",
        align: "left",
        indentLeft: 0,
        hasFloatAnchor: false,
        inputHash: 0,
        isPageBreak: true,
        wasCacheHit: false,
      });
      continue;
    }

    // ── Streaming cutoff ─────────────────────────────────────────────────────
    if (maxBlocks !== undefined && processedBlocks >= maxBlocks) {
      return { flows, reachedCutoff: true, cutoffIndex: itemIdx };
    }

    const { node, nodePos, listMarker, indentLeft, styleKey } = item;
    const level = node.attrs["level"] as number | undefined;
    const blockStyle = getBlockStyle(fontConfig, styleKey ?? node.type.name, level);
    const blockWidth = contentWidth - indentLeft;
    const blockX = margins.left + indentLeft;

    // Phase 1b: capture cache snapshot BEFORE resolveBlockEntry may update it.
    const preCached = measureCache?.get(node);
    const isHit = preCached !== undefined && preCached.availableWidth === blockWidth;

    // Measure — position-independent (targetY=0, page=1 are not stored in entry).
    const entry = resolveBlockEntry(
      node, nodePos, blockX, 0, blockWidth, 1,
      measurer, fontConfig, fontModifiers, measureCache, inlineRegistry,
    );

    flows.push({
      node,
      nodePos,
      lines: entry.lines,
      height: entry.height,
      spaceBefore: blockStyle.spaceBefore,
      spaceAfter: blockStyle.spaceAfter,
      availableWidth: blockWidth,
      blockType: entry.blockType,
      align: entry.align,
      ...(listMarker !== undefined ? {
        listMarker,
        listMarkerX: blockX - MARKER_RIGHT_GAP,
      } : {}),
      indentLeft,
      hasFloatAnchor: blockHasFloatAnchor(entry.lines),
      inputHash: computeInputHash(nodePos, node, blockWidth),
      wasCacheHit: isHit,
      ...(preCached?.placedTargetY    !== undefined ? { preCachedTargetY:    preCached.placedTargetY    } : {}),
      ...(preCached?.placedPage        !== undefined ? { preCachedPage:       preCached.placedPage       } : {}),
      ...(preCached?.placedRunId       !== undefined ? { preCachedRunId:      preCached.placedRunId      } : {}),
      ...(preCached?.placedContentTop  !== undefined ? { preCachedContentTop: preCached.placedContentTop } : {}),
      ...(preCached?.nodePos           !== undefined ? { prevNodePos:         preCached.nodePos          } : {}),
    });

    processedBlocks++;
  }

  return { flows, reachedCutoff: false, cutoffIndex: items.length };
}

/**
 * Stage 3 (new): project pre-resolved global-Y floats onto paginated pages.
 *
 * Constraint resolution already happened in Stage 1.75. This pass:
 *   1. Finds each float's anchor on the paginated pages
 *   2. Derives page-local Y from the anchor's paginated position
 *   3. Uses pre-reflow anchor globalY for page membership (browser rule:
 *      float page is determined by anchor position BEFORE text reflow)
 *   4. Handles page overflow and materialises empty pages
 *   5. Snapshots _pass1Pages for Phase 1b
 *
 * No block re-layout. The text was already constrained in Stage 1.75.
 */
function projectFloatsOntoPages(
  paginatedLayout: DocumentLayout,
  resolvedFloats: { floats: FloatLayout[]; exclusionMgr: ExclusionManager },
  pageConfig: PageConfig,
): DocumentLayout {
  const { pages } = paginatedLayout;

  // Snapshot Pass 1 page/block positions for Phase 1b early termination.
  const pass1Pages: LayoutPage[] = pages.map((p) => ({
    pageNumber: p.pageNumber,
    blocks: [...p.blocks],
  }));

  // Per-page metrics lookup.
  const metricsForPage = (pageNumber: number): PageMetrics => {
    const idx = pageNumber - 1;
    const m = paginatedLayout.metrics?.[idx];
    if (m && m.pageNumber === pageNumber) return m;
    return computePageMetrics(pageConfig, EMPTY_RESOLVED_CHROME, pageNumber);
  };

  // Build anchor map from paginated pages: docPos → { page, blockY }.
  const anchorMap = new Map<number, { page: number; blockY: number }>();
  for (const page of pages) {
    for (const block of page.blocks) {
      for (const line of block.lines) {
        for (const span of line.spans) {
          if (span.kind !== "object" || span.width !== 0) continue;
          const wm = span.node.attrs["wrappingMode"] as string | undefined;
          if (!wm || wm === "inline") continue;
          anchorMap.set(span.docPos, { page: page.pageNumber, blockY: block.y });
        }
      }
    }
  }

  // Project each float onto its anchor's page.
  const floats = resolvedFloats.floats.map((f) => {
    if (f.globalY === undefined) return f;

    // In pageless mode, everything is on page 1.
    if (pageConfig.pageless) {
      return { ...f, page: 1, y: f.globalY, anchorPage: 1 };
    }

    const anchor = anchorMap.get(f.docPos);
    if (!anchor) return f;

    // Page membership from paginated anchor position.
    // The anchor block's page-local position was determined by paginateFlow
    // using the constrained flow heights. Since the anchor block itself
    // (the zero-height float anchor) doesn't change height during constraint
    // reflow, its paginated position reflects the pre-reflow position.
    const delta = f.globalY - f.anchorBlockY;
    const candidateY = anchor.blockY + delta;
    let floatPage = anchor.page;
    const anchorPage = anchor.page;

    // If the float extends past the page bottom, overflow to the next page.
    const pageBottom = metricsForPage(floatPage).contentBottom;
    if (f.mode !== "behind" && f.mode !== "front" &&
        candidateY + f.height > pageBottom) {
      floatPage = anchorPage + 1;
      const nextContentTop = metricsForPage(floatPage).contentTop;
      return { ...f, page: floatPage, y: nextContentTop, anchorPage };
    }

    return { ...f, page: floatPage, y: candidateY, anchorPage };
  });

  // Materialise empty pages for floats that landed on non-existent pages.
  for (const f of floats) {
    if (!pages.find((p) => p.pageNumber === f.page)) {
      const newP: LayoutPage = { pageNumber: f.page, blocks: [] };
      const insertAt = pages.findIndex((p) => p.pageNumber > f.page);
      if (insertAt === -1) pages.push(newP);
      else pages.splice(insertAt, 0, newP);
    }
  }

  clearOrphanedConstraints(pages, floats);
  return { ...paginatedLayout, floats, _pass1Pages: pass1Pages };
}

/**
 * Clears stale float constraints on continuation blocks.
 *
 * When a constrained block splits across pages, overflow lines may carry
 * constraintX / effectiveWidth from the pre-pagination line-break pass.
 * Lines that don't overlap any float on their page revert to full width.
 */
function clearOrphanedConstraints(
  pages: LayoutPage[],
  floats: FloatLayout[],
): void {
  for (const page of pages) {
    const pageFloats = floats.filter(
      (f) => f.page === page.pageNumber && f.mode !== "behind" && f.mode !== "front",
    );

    if (pageFloats.length === 0) {
      // No wrapping floats on this page — clear all constraints on continuations.
      for (const block of page.blocks) {
        if (!block.isContinuation) continue;
        for (const line of block.lines) {
          clearLineConstraints(line);
        }
      }
      continue;
    }

    // Page has floats — only clear lines that fall outside all float zones.
    for (const block of page.blocks) {
      if (!block.isContinuation) continue;
      let lineY = block.y;
      for (const line of block.lines) {
        if (line.constraintX !== undefined || line.effectiveWidth !== undefined) {
          const overlaps = pageFloats.some(
            (f) => lineY < f.y + f.height && lineY + line.lineHeight > f.y,
          );
          if (!overlaps) clearLineConstraints(line);
        }
        lineY += line.lineHeight;
      }
    }
  }
}

/** Remove constraintX / effectiveWidth from a line (exactOptionalPropertyTypes safe). */
function clearLineConstraints(line: LayoutLine): void {
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  const rec = line as unknown as Record<string, unknown>;
  delete rec["constraintX"];
  delete rec["effectiveWidth"];
}

/**
 * Stage 4 of the layout pipeline: build the LayoutFragment index.
 *
 * Iterates pages in order and emits one LayoutFragment per LayoutBlock.
 * Split blocks (fragmentCount > 1) produce multiple fragments — one per
 * page-slice — with incrementing fragmentIndex values.
 *
 * The returned array is sorted by page ascending, then by y ascending within
 * each page (natural iteration order over pages[].blocks[]).
 *
 * Also builds fragmentsByPage: a parallel array indexed by (pageNumber - 1)
 * for O(1) lookup in paged-mode tile rendering.
 */
export function buildFragments(pages: LayoutPage[]): {
  fragments: LayoutFragment[];
  fragmentsByPage: LayoutFragment[][];
} {
  // Pass 1: count how many page-parts each source block contributes.
  // This lets us emit the correct fragmentCount on every fragment without
  // requiring it to be pre-stamped on LayoutBlock.
  const partCounts = new Map<number, number>();
  for (const page of pages) {
    for (const block of page.blocks) {
      const src = block.sourceNodePos ?? block.nodePos;
      partCounts.set(src, (partCounts.get(src) ?? 0) + 1);
    }
  }

  // Pass 2: emit fragments in page / y order.
  const fragments: LayoutFragment[] = [];
  const fragmentsByPage: LayoutFragment[][] = [];
  const nextIndex = new Map<number, number>(); // tracks fragmentIndex per sourceNodePos

  for (const page of pages) {
    const pageFrags: LayoutFragment[] = [];

    for (const block of page.blocks) {
      const sourceNodePos = block.sourceNodePos ?? block.nodePos;
      const fragmentCount = partCounts.get(sourceNodePos) ?? 1;
      const fragmentIndex = nextIndex.get(sourceNodePos) ?? 0;
      nextIndex.set(sourceNodePos, fragmentIndex + 1);

      const frag: LayoutFragment = {
        fragmentIndex,
        fragmentCount,
        sourceNodePos,
        page: page.pageNumber,
        x: block.x,
        y: block.y,
        width: block.availableWidth,
        height: block.height,
        lineStart: 0,
        lineCount: block.lines.length,
        block,
      };
      fragments.push(frag);
      pageFrags.push(frag);
    }

    fragmentsByPage[page.pageNumber - 1] = pageFrags;
  }

  return { fragments, fragmentsByPage };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function newPage(pageNumber: number): LayoutPage {
  return { pageNumber, blocks: [] };
}

/**
 * Returns a LayoutBlock with nodePos and span docPos values shifted by `delta`.
 * Used by the Phase 1b early-termination path when copying blocks from
 * `previousLayout` that haven't passed through the main loop this run.
 *
 * When `delta === 0` the original block is returned unchanged (no allocation).
 *
 * Also updates the measureCache entry for the block so the next layout run
 * sees a correct nodePos and avoids redundant adjustment.
 */
function shiftBlock(
  block: LayoutBlock,
  delta: number,
  measureCache: WeakMap<Node, MeasureCacheEntry> | undefined,
): LayoutBlock {
  if (delta === 0) return block;

  const adjustedLines = block.lines.map((line) => ({
    ...line,
    spans: line.spans.map((span) => ({ ...span, docPos: span.docPos + delta })),
  }));

  const shifted: LayoutBlock = {
    ...block,
    nodePos: block.nodePos + delta,
    lines: adjustedLines,
  };

  // Propagate the correction into the cache so the next run's resolveBlockEntry
  // sees delta === 0 and skips the per-span adjustment.
  if (measureCache) {
    const cached = measureCache.get(block.node);
    // Only update the cache when this block holds ALL the cached lines.
    // Split-part blocks carry a subset of lines; updating with partial data
    // would corrupt subsequent layout runs that expect the full measurement.
    if (cached && block.lines.length === cached.lines.length) {
      // Keep placedTargetY / placedPage intact — they reflect the correct
      // placement positions from the previous run and are still valid.
      measureCache.set(block.node, {
        ...cached,
        nodePos: cached.nodePos + delta,
        lines: adjustedLines,
      });
    }
  }

  return shifted;
}

/** A single item ready for layout — either a plain block or an expanded list item. */
export interface LayoutItem {
  isPageBreak?: true;
  node: Node;
  nodePos: number;
  /** Extra left indent in px (0 for regular blocks, LIST_INDENT for list items). */
  indentLeft: number;
  /** Bullet character or ordered number, e.g. "•" or "1.". Undefined for non-list blocks. */
  listMarker?: string;
  /**
   * Override the FontConfig key used for block-style lookup.
   * List items lay out their inner `paragraph` node but should use the
   * `list_item` spacing defined in addBlockStyles(), not the paragraph style.
   */
  styleKey?: string;
}

const LIST_INDENT = 24; // px — text starts this far right of the margin
const MARKER_RIGHT_GAP = 6; // px — gap between the marker's right edge and the text

/**
 * Walks the doc's top-level children and returns a flat array of layout items.
 * List container nodes (bulletList, orderedList) are expanded into one item
 * per list item so each renders as an independent LayoutBlock.
 */
export function collectLayoutItems(doc: Node, _fontConfig: FontConfig): LayoutItem[] {
  const items: LayoutItem[] = [];

  doc.forEach((node, offset) => {
    if (node.type.name === "pageBreak") {
      items.push({ isPageBreak: true, node, nodePos: offset, indentLeft: 0 });
      return;
    }

    if (node.type.name === "bulletList" || node.type.name === "orderedList") {
      const isBullet = node.type.name === "bulletList";
      let itemIndex = (node.attrs["order"] as number) ?? 1;

      node.forEach((listItem, liOffset) => {
        // nodePos of the paragraph inside this listItem:
        // offset (before bulletList) + 1 (into bulletList) + liOffset (before listItem) + 1 (into listItem)
        const paraNodePos = offset + 1 + liOffset + 1;
        const para = listItem.firstChild;
        if (!para) return;

        const marker = isBullet ? "•" : `${itemIndex}.`;

        items.push({
          node: para,
          nodePos: paraNodePos,
          indentLeft: LIST_INDENT,
          listMarker: marker,
          styleKey: "list_item",
        });

        itemIndex++;
      });
      return;
    }

    items.push({ node, nodePos: offset, indentLeft: 0 });
  });

  return items;
}

/**
 * Returns a `MeasureCacheEntry` for the given node, either from the cache or
 * by calling `layoutBlock` once and writing the result back.
 *
 * Centralises all cache read/write logic so the main layout loop stays clean.
 *
 * LayoutLine x-coordinates are relative to the line origin — position-independent.
 * However, LayoutSpan.docPos values are absolute ProseMirror positions. Because
 * ProseMirror's structural sharing keeps the same Node reference for unchanged
 * blocks even when text is inserted/deleted before them, a cached entry's docPos
 * values can become stale. We fix this by storing the nodePos at measure-time and
 * adjusting span docPos values by the delta on every cache hit.
 */
function resolveBlockEntry(
  node: Node,
  nodePos: number,
  blockX: number,
  targetY: number,
  blockWidth: number,
  pageNumber: number,
  measurer: TextMeasurer,
  fontConfig: FontConfig,
  fontModifiers: Map<string, FontModifier> | undefined,
  measureCache: WeakMap<Node, MeasureCacheEntry> | undefined,
  inlineRegistry?: InlineRegistry,
): MeasureCacheEntry {
  const cached = measureCache?.get(node);
  if (cached && cached.availableWidth === blockWidth) {
    const delta = nodePos - cached.nodePos;
    if (!delta) return cached;

    // Block shifted in the document (text inserted/deleted before it).
    // Adjust all span docPos values and update the cache entry.
    const adjustedLines = cached.lines.map((line) => ({
      ...line,
      spans: line.spans.map((span) => ({ ...span, docPos: span.docPos + delta })),
    }));
    const updated: MeasureCacheEntry = { ...cached, nodePos, lines: adjustedLines };
    measureCache!.set(node, updated);
    return updated;
  }

  // Cache miss — measure and populate. map is intentionally omitted:
  // CharacterMap population is deferred to Editor.ensurePagePopulated().
  const measured = layoutBlock(node, {
    nodePos,
    x: blockX,
    y: targetY,
    availableWidth: blockWidth,
    page: pageNumber,
    measurer,
    fontConfig,
    ...(fontModifiers ? { fontModifiers } : {}),
    ...(inlineRegistry ? { inlineRegistry } : {}),
  });

  const entry: MeasureCacheEntry = {
    availableWidth: blockWidth,
    nodePos,
    height: measured.height,
    lines: measured.lines,
    spaceBefore: measured.spaceBefore,
    spaceAfter: measured.spaceAfter,
    blockType: measured.blockType,
    align: measured.align,
  };
  measureCache?.set(node, entry);
  return entry;
}

/**
 * CSS-style margin collapsing.
 * The gap between two adjacent blocks is the larger of their margins, not the sum.
 */
export function collapseMargins(
  spaceAfter: number,
  spaceBefore: number,
): number {
  return Math.max(spaceAfter, spaceBefore);
}

/**
 * Stamps `globalY` on each FlowBlock by stacking top-to-bottom with margin
 * collapsing. Page break nodes get a globalY marker but no height contribution.
 *
 * This is the first step in the global-Y pipeline: establish continuous layout
 * coordinates before float constraint resolution.
 */
export function assignGlobalY(flows: FlowBlock[], startY: number): void {
  let y = startY;
  let prevSpaceAfter = 0;
  let isFirst = true;

  for (const flow of flows) {
    if (flow.isPageBreak) {
      flow.globalY = y;
      continue;
    }

    const gap = isFirst ? 0 : collapseMargins(prevSpaceAfter, flow.spaceBefore);
    flow.globalY = y + gap;
    y = flow.globalY + flow.height;
    prevSpaceAfter = flow.spaceAfter;
    isFirst = false;
  }
}

/**
 * Re-stamps globalY starting from `startIndex`, preserving margin collapsing.
 * Called after constrained reflow changes a block's height — only recomputes
 * downstream, not the entire list.
 */
export function recomputeGlobalY(flows: FlowBlock[], startIndex: number): void {
  if (startIndex <= 0 || startIndex >= flows.length) return;

  // Seed from the block just before startIndex.
  let prev = flows[startIndex - 1]!;
  let y = (prev.globalY ?? 0) + (prev.isPageBreak ? 0 : prev.height);
  let prevSpaceAfter = prev.isPageBreak ? 0 : prev.spaceAfter;

  for (let i = startIndex; i < flows.length; i++) {
    const flow = flows[i]!;
    if (flow.isPageBreak) {
      flow.globalY = y;
      continue;
    }
    const gap = collapseMargins(prevSpaceAfter, flow.spaceBefore);
    flow.globalY = y + gap;
    y = flow.globalY + flow.height;
    prevSpaceAfter = flow.spaceAfter;
  }
}

// ── Global-Y float anchor ────────────────────────────────────────────────────

interface GlobalFloatAnchor {
  docPos: number;
  node: Node;
  /** Index of the owning FlowBlock in the flows array. */
  flowIndex: number;
  /** Line index within the block where the anchor span lives. */
  resolvedLineIndex: number;
  /** Inline x offset within the line (for future tight-wrap + cursor). */
  inlineOffset: number;
  /** Global Y of the anchor: block.globalY + cumulative line heights to this line. */
  globalY: number;
}

/**
 * Walks FlowBlocks and collects float anchors with global-Y coordinates.
 * Similar to collectFloatAnchors but operates on FlowBlock[] instead of LayoutPage[].
 */
function collectFloatAnchorsFromFlows(flows: FlowBlock[]): GlobalFloatAnchor[] {
  const anchors: GlobalFloatAnchor[] = [];

  for (let fi = 0; fi < flows.length; fi++) {
    const flow = flows[fi]!;
    if (!flow.hasFloatAnchor || flow.globalY === undefined) continue;

    let lineYOffset = 0;
    for (let li = 0; li < flow.lines.length; li++) {
      const line = flow.lines[li]!;
      for (const span of line.spans) {
        if (span.kind !== "object") continue;
        if (span.width !== 0) continue;
        const wm = span.node.attrs["wrappingMode"] as string | undefined;
        if (!wm || wm === "inline") continue;
        anchors.push({
          docPos: span.docPos,
          node: span.node,
          flowIndex: fi,
          resolvedLineIndex: li,
          inlineOffset: span.x,
          globalY: flow.globalY + lineYOffset,
        });
      }
      lineYOffset += line.lineHeight;
    }
  }

  return anchors;
}

const FLOAT_MARGIN_GLOBAL = 8; // px gap around each float (matches applyFloatLayout)

/**
 * Resolves float positions in continuous global-Y space.
 *
 * Replaces the page-local float placement in applyFloatLayout Pass 2.
 * Floats are positioned relative to their anchor's globalY, stacked downward,
 * and pushed past page break barriers (floats never visually overlap a page break).
 *
 * Returns null if no floats exist in the document.
 */
export function resolveFloatsGlobalY(
  flows: FlowBlock[],
  margins: PageConfig["margins"],
  pageWidth: number,
  contentWidth: number,
  pageBreakYs: number[],
): { floats: FloatLayout[]; exclusionMgr: ExclusionManager } | null {
  const anchors = collectFloatAnchorsFromFlows(flows);
  if (anchors.length === 0) return null;

  const exclusionMgr = new ExclusionManager();
  const floats: FloatLayout[] = [];

  const contentX = margins.left;
  const contentRight = pageWidth - margins.right;

  for (const anchor of anchors) {
    const attrs = anchor.node.attrs as {
      width?: number;
      height?: number;
      wrappingMode?: string;
      floatOffset?: { x: number; y: number };
    };

    const nodeWidth  = typeof attrs.width  === "number" ? attrs.width  : 200;
    const nodeHeight = typeof attrs.height === "number" ? attrs.height : 200;
    const mode       = attrs.wrappingMode ?? "inline";
    const offsetX    = attrs.floatOffset?.x ?? 0;
    const offsetY    = attrs.floatOffset?.y ?? 0;

    const clampedNodeWidth = Math.min(nodeWidth, contentWidth);

    // Compute X position (same logic as current applyFloatLayout Pass 2).
    let floatX: number;
    if (mode === "square-right") {
      floatX = contentRight - clampedNodeWidth + offsetX;
    } else {
      floatX = contentX + offsetX;
    }
    floatX = Math.max(contentX, Math.min(floatX, contentRight - clampedNodeWidth));

    // Stacking: push below any already-placed float with physical overlap.
    // Operates in global Y — no page boundaries.
    let candidateY = anchor.globalY + offsetY;
    if (mode !== "behind" && mode !== "front") {
      let changed = true;
      while (changed) {
        changed = false;
        for (const placed of floats) {
          if (placed.mode === "behind" || placed.mode === "front") continue;
          const hOverlap = floatX < placed.x + placed.width && floatX + clampedNodeWidth > placed.x;
          const placedGY = placed.globalY ?? placed.y;
          const vOverlap = candidateY < placedGY + placed.height && candidateY + nodeHeight > placedGY;
          if (hOverlap && vOverlap) {
            candidateY = placedGY + placed.height;
            changed = true;
          }
        }
      }
    }

    // Page break barrier: floats cannot visually overlap a page break.
    // Text CAN cross page breaks; floats CANNOT.
    if (mode !== "behind" && mode !== "front") {
      for (const breakY of pageBreakYs) {
        if (candidateY < breakY && candidateY + nodeHeight > breakY) {
          candidateY = breakY;
        }
      }
    }

    floats.push({
      docPos: anchor.docPos,
      page: 0,  // filled by pagination projection later
      x: floatX,
      y: 0,     // filled by pagination projection later
      width: clampedNodeWidth,
      height: nodeHeight,
      mode,
      node: anchor.node,
      globalY: candidateY,
      anchorBlockY: anchor.globalY,
      anchorPage: 0,  // filled by pagination later
    });

    // Build exclusion rect (global Y, no page).
    if (mode === "behind" || mode === "front") continue;

    const side: "left" | "right" | "full" =
      mode === "square-left" ? "left" :
      mode === "square-right" ? "right" :
      "full";

    const exclLeft  = side === "full" ? contentX     : floatX - FLOAT_MARGIN_GLOBAL;
    const exclRight = side === "full" ? contentRight : floatX + clampedNodeWidth + FLOAT_MARGIN_GLOBAL;

    exclusionMgr.addRect({
      // No page field — global Y mode
      x: exclLeft,
      right: exclRight,
      y: candidateY - FLOAT_MARGIN_GLOBAL,
      bottom: candidateY + nodeHeight + FLOAT_MARGIN_GLOBAL,
      side,
      docPos: anchor.docPos,
    });
  }

  return { floats, exclusionMgr };
}

/**
 * Re-layouts blocks whose lines overlap float exclusion zones, updating their
 * height and lines in place. Returns true if any block's height changed.
 *
 * After reflow, call `recomputeGlobalY` on downstream blocks and
 * `updateFloatAnchors` to re-derive float positions from updated anchors.
 *
 * ConstraintProvider is pure: (globalY) => { left, right }. No mutation,
 * no caching inside. Will be shared with cursor, hit-testing, and selection.
 */
export function reflowConstrainedBlocks(
  flows: FlowBlock[],
  exclusionMgr: ExclusionManager,
  margins: PageConfig["margins"],
  contentWidth: number,
  measurer: TextMeasurer,
  fontConfig: FontConfig,
  fontModifiers?: Map<string, FontModifier>,
  inlineRegistry?: InlineRegistry,
): { changed: boolean; firstChangedIndex: number } {
  let changed = false;
  let firstChangedIndex = flows.length;
  const blockX = margins.left;

  for (let fi = 0; fi < flows.length; fi++) {
    const flow = flows[fi]!;
    if (flow.isPageBreak || !flow.lines.length || flow.globalY === undefined) continue;

    // Per-line overlap check: a block may only overlap a float mid-way.
    let hasOverlap = false;
    let lineY = flow.globalY;
    for (const line of flow.lines) {
      if (exclusionMgr.hasExclusionsInRange(lineY, lineY + line.lineHeight)) {
        hasOverlap = true;
        break;
      }
      lineY += line.lineHeight;
    }
    if (!hasOverlap) continue;

    // Build pure ConstraintProvider for this block.
    const blockContentX = blockX + flow.indentLeft;
    const blockAvailWidth = contentWidth - flow.indentLeft;
    const constraintProvider: ConstraintProvider = (absoluteLineY: number) => {
      return exclusionMgr.getConstraint(
        undefined,  // global Y mode — no page filter
        absoluteLineY,
        1,
        blockContentX,
        blockAvailWidth,
      );
    };

    const reflowed = layoutBlock(flow.node, {
      nodePos: flow.nodePos,
      x: blockContentX,
      y: flow.globalY,
      availableWidth: blockAvailWidth,
      page: 1,  // placeholder — not used in global Y mode
      measurer,
      fontConfig,
      ...(fontModifiers ? { fontModifiers } : {}),
      constraintProvider,
      ...(inlineRegistry ? { inlineRegistry } : {}),
    });

    if (reflowed.height !== flow.height) {
      changed = true;
      if (fi < firstChangedIndex) firstChangedIndex = fi;
    }

    // Update flow in place with reflowed results.
    flow.lines = reflowed.lines;
    flow.height = reflowed.height;
  }

  return { changed, firstChangedIndex };
}

/**
 * Re-derives float globalY positions from their anchor blocks' updated globalY.
 * Called after reflowConstrainedBlocks + recomputeGlobalY shifts blocks.
 */
export function updateFloatAnchors(
  floats: FloatLayout[],
  flows: FlowBlock[],
): void {
  const anchors = collectFloatAnchorsFromFlows(flows);

  for (const float of floats) {
    const anchor = anchors.find((a) => a.docPos === float.docPos);
    if (!anchor) continue;

    const oldAnchorY = float.anchorBlockY;
    const newAnchorY = anchor.globalY;
    if (oldAnchorY === newAnchorY) continue;

    const delta = newAnchorY - oldAnchorY;
    float.globalY = (float.globalY ?? 0) + delta;
    float.anchorBlockY = newAnchorY;
  }
}
