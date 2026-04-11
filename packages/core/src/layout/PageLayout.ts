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
import type { LayoutLine, ConstraintProvider } from "./LineBreaker";
import { ExclusionManager } from "./ExclusionManager";
import {
  computePageMetrics,
  EMPTY_RESOLVED_CHROME,
  type PageMetrics,
  type ResolvedChrome,
} from "./PageMetrics";

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

  // ── Phase 0 additions (multi-surface foundation) ──────────────────────────
  //
  // These fields are populated by runPipeline starting with the Phase 0 PR
  // (refactor/layout-primitives). They're optional so older call sites that
  // construct DocumentLayout literals without them continue to compile during
  // the staged rollout. Consumers that actually rely on the values check for
  // presence or fall back to legacy behavior.
  //
  // See docs/header-footer-plan.md §3 and docs/multi-surface-architecture.md
  // §3.4/§8.6 for the full design.

  /**
   * Per-page metrics bundle, one entry per `pages[i]`.
   * Always set by runPipeline going forward, even with zero chrome contributors
   * (Phase 0 state) — in that case every entry reduces to the hand-computed
   * `margins.top` / `pageHeight - margins.bottom` formula for its page number.
   *
   * Optional because tests and legacy paths may construct DocumentLayout
   * without running the pipeline (e.g. synthesizing a single-page fixture).
   */
  metrics?: PageMetrics[];

  /**
   * Monotonic identity for this layout run. Incremented per full run. Used
   * by the Phase 1b early-termination cache to distinguish "this block was
   * placed in the run we're comparing against" from "this block was placed
   * in some older run we can no longer trust."
   *
   * In Phase 0 this is aliased to `version` since the two counters serve
   * the same purpose (per-run identity). Future PRs may split them if a
   * second identity lane is needed (e.g., to decouple render-staleness
   * tracking from cache-invalidation tracking).
   */
  runId?: number;

  /**
   * Whether the iterative chrome loop reached a fixed point. Always
   * `"stable"` in Phase 0 because there are no iterative contributors yet
   * (the aggregator effectively runs 1 iteration). Later PRs that wire real
   * contributors (footnotes) set this to `"exhausted"` when MAX_ITERATIONS
   * fires without convergence.
   *
   * `convergence: "exhausted"` is a valid, usable layout — just non-optimal.
   * Strict-mode export (see `docs/export-extensibility.md` §12.1) can
   * choose to throw rather than ship an exhausted layout.
   */
  convergence?: "stable" | "exhausted";

  /**
   * Number of iterations the chrome aggregator ran. Always `1` in Phase 0
   * (no iteration). Debug/telemetry only — no layout logic reads this.
   */
  iterationCount?: number;
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

  /**
   * Phase 1b — two-guard cache invariant (Phase 0 additions).
   *
   * These fields make the early-termination shortcut safe across chrome
   * configuration changes. See docs/header-footer-plan.md §3.4 and
   * docs/multi-surface-architecture.md §8.6 for the full rationale.
   *
   * - `placedRunId`: the `runId` of the layout run that placed this block.
   *   Phase 1b only accepts the shortcut when the block's placed run equals
   *   `previousLayout.runId`, i.e. the cache entry is fresh from the run
   *   whose pages we'd be copying.
   *
   * - `placedContentTop`: the `PageMetrics.contentTop` of the specific page
   *   this block was placed on. If that page's contentTop differs between
   *   runs (e.g. a header plugin activated and reserved 40px), the cached
   *   `placedTargetY` is stale by exactly that delta and the shortcut is
   *   invalid. Storing placedContentTop lets us detect this.
   *
   * Both are optional because legacy entries written before Phase 0 don't
   * have them set — in that case the Phase 1b guard bails out and the
   * shortcut is skipped, which is the safe default.
   */
  placedRunId?: number;
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
  /** True when this entry represents a hard page break node. */
  isPageBreak?: true;
  /** True when the block measurement was a cache hit. */
  wasCacheHit: boolean;
  // Phase 1b: cache snapshot taken before this run's measurement.
  preCachedTargetY?: number;
  preCachedPage?: number;
  /**
   * Phase 1b two-guard additions (Phase 0). See MeasureCacheEntry.placedRunId
   * / placedContentTop for the rationale. These are the snapshot of those
   * values at the time buildBlockFlow ran for THIS layout run — copied from
   * the previous run's cache entry so the Phase 1b guard can compare them.
   */
  preCachedRunId?: number;
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
 *   Stage 1  buildBlockFlow   — position-independent measurement
 *   Stage 2  paginateFlow     — assign blocks to pages
 *   Stage 3  applyFloatLayout — float positions + exclusion reflow
 *
 * Returns a fully positioned DocumentLayout. Does NOT touch the CharacterMap.
 * This function is the single source of truth for orchestration; both
 * LayoutCoordinator and tests call it instead of duplicating the logic.
 */
export function runPipeline(
  doc: Node,
  options: PageLayoutOptions,
): DocumentLayout {
  // Destructured once — avoids repeated property access inside the hot loop.
  const { fontModifiers, measureCache, previousLayout,pageConfig, measurer } = options;
  const version = (options.previousVersion ?? 0) + 1;
  // Phase 0: runId is aliased to version. They serve the same "per-run
  // identity" purpose today. Future PRs may split them if render-staleness
  // tracking (version) and cache-invalidation tracking (runId) need to
  // diverge. Keeping them the same means existing callers that observe
  // `version` bumps see identical behavior.
  const runId = version;
  const baseConfig = options.fontConfig ?? defaultFontConfig;
  // Always inject a family — font strings in defaultFontConfig and extensions
  // intentionally omit the family so it comes from a single source here.
  const fontConfig = applyPageFont(baseConfig, pageConfig.fontFamily ?? DEFAULT_FONT_FAMILY);

  const { pageWidth, pageHeight, margins } = pageConfig;
  const contentWidth = pageWidth - margins.left - margins.right;
  const maxBlocks = options.maxBlocks;

  // ── Phase 0: chrome aggregation ──────────────────────────────────────────
  // In Phase 0 the aggregator is inert — no contributors are registered yet,
  // so we use the stable EMPTY_RESOLVED_CHROME reference. Phase 1b wires real
  // chrome contributors (headers, footers) through the extension lane and
  // replaces this line with a call to `aggregateChrome(extensions, ...)`.
  const resolved = EMPTY_RESOLVED_CHROME;

  // ── Per-page metrics lookup ──────────────────────────────────────────────
  // Single-entry cache keyed by pageNumber. paginateFlow advances pages
  // sequentially, so the cache hits on ~99% of calls — only missing on the
  // first call per new page. Stateless from the caller's perspective: looks
  // like a pure function `(pageNumber) => PageMetrics`.
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

  // ── Resumption support: O(N) incremental chunked layout ───────────────────
  // When resumption is provided, restore the cursor state from the previous
  // chunk rather than re-iterating already-processed blocks. The items array
  // is cached in the resumption object so collectLayoutItems() is only called
  // on the first chunk.
  const r = options.resumption;
  const items = r ? r.items : collectLayoutItems(doc, fontConfig);
  const startIndex = r ? r.nextItemIndex : 0;

  // Restore page cursor from previous chunk, or start fresh.
  const pages: LayoutPage[] = r ? r.completedPages : [];
  let currentPage: LayoutPage = r ? r.currentPage : { pageNumber: 1, blocks: [] };
  let y = r ? r.currentY : metricsFor(1).contentTop;
  let prevSpaceAfter = r ? r.prevSpaceAfter : 0;
  const chunkVersion = r ? r.version : version;

  // ── Stage 1: measure ─────────────────────────────────────────────────────
  const flowConfig: FlowConfig = { margins, contentWidth };
  const flowResult = buildBlockFlow(
    items, startIndex, flowConfig, fontConfig,
    measurer, fontModifiers, measureCache, maxBlocks,
  );

  // ── Stage 2: paginate ─────────────────────────────────────────────────────
  const pr = paginateFlow(
    flowResult.flows, pageConfig, resolved, metricsFor, runId,
    previousLayout, measureCache,
    pages, currentPage, y, prevSpaceAfter,
    pageConfig.pageless,
  );

  // ── Helper: compute per-page metrics array for a given page list ─────────
  // Used by both the partial and final return paths. Mirrors what paginateFlow
  // threaded through metricsFor(), but with a fresh 1-entry cache so we don't
  // pollute the metricsFor cache at the end of the run.
  const buildMetricsArray = (pageList: LayoutPage[]): PageMetrics[] =>
    pageList.map((p) => computePageMetrics(pageConfig, resolved, p.pageNumber));

  // ── Streaming layout cutoff ───────────────────────────────────────────────
  if (flowResult.reachedCutoff && !pr.earlyTerminated) {
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
    const partialPass1: DocumentLayout = {
      pages: partialPages,
      pageConfig,
      version: chunkVersion,
      isPartial: true,
      resumption,
      totalContentHeight: pageConfig.pageless
        ? pr.y + margins.bottom
        : partialPages.length * pageHeight,
      metrics: buildMetricsArray(partialPages),
      runId,
      convergence: "stable",
      iterationCount: 1,
    };
    // ── Stage 3: float layout (partial chunk) ────────────────────────────────
    return applyFloatLayout(partialPass1, margins, pageWidth, contentWidth, measurer, fontConfig, fontModifiers);
  }

  const allPages = pr.earlyTerminated ? pr.pages : [...pr.pages, pr.currentPage];

  // ── Stage 3: float layout ─────────────────────────────────────────────────
  const pass1Result: DocumentLayout = {
    pages: allPages,
    pageConfig,
    version: chunkVersion,
    totalContentHeight: 0,
    metrics: buildMetricsArray(allPages),
    runId,
    convergence: "stable",
    iterationCount: 1,
  };
  const floated = applyFloatLayout(pass1Result, margins, pageWidth, contentWidth, measurer, fontConfig, fontModifiers);

  // ── Stage 4: fragment index ───────────────────────────────────────────────
  // buildFragments computes fragmentCount/fragmentIndex from the final page
  // list, superseding the manual stamping loop that previously lived here.
  const { fragments, fragmentsByPage } = buildFragments(floated.pages);

  // ── Compute totalContentHeight ────────────────────────────────────────────
  const totalContentHeight = pageConfig.pageless
    ? pr.y + margins.bottom
    : allPages.length * pageHeight;

  return { ...floated, fragments, fragmentsByPage, totalContentHeight };
}

/**
 * Stage 2 of the layout pipeline: assign measured FlowBlocks to pages.
 *
 * Pure geometry — no measuring, no cache reads (except for Phase 1b shiftBlock).
 * Returns all completed pages plus the cursor state needed for streaming resumption
 * or the next chunk in incremental layout.
 *
 * Per-page metrics: every vertical-position read inside this function routes
 * through `metricsFor(pageNumber)` rather than the old `margins.top` /
 * `contentHeight` constants. This is what lets differentFirstPage headers and
 * footnote bands produce different reservations per page. In Phase 0 with zero
 * chrome contributors, `metricsFor` returns identical values for every page,
 * so the behavior is unchanged from the pre-refactor formula.
 *
 * @param flows         FlowBlocks from buildBlockFlow().
 * @param pageConfig    The PageConfig for this run (used for margins.left, etc.).
 * @param resolved      The chrome aggregator output (EMPTY_RESOLVED_CHROME in Phase 0).
 * @param metricsFor    Per-page metrics lookup. Callers are expected to memoize
 *                      at their level; paginateFlow treats this as a pure function.
 * @param runId         Monotonic id of THIS layout run. Written into MeasureCacheEntry.placedRunId
 *                      for Phase 1b two-guard cache invariants.
 * @param previousLayout Previous run's layout — enables Phase 1b early termination.
 * @param measureCache  Weak cache — updated with placement data after each block.
 * @param initPages     Completed pages from the previous chunk (empty on first chunk).
 * @param initPage      The page currently being built (fresh {pageNumber:1} on first chunk).
 * @param initY         Y cursor at start (metricsFor(1).contentTop on first chunk).
 * @param initPrevSpaceAfter Spacing state from the previous block (0 on first chunk).
 */
export function paginateFlow(
  flows: FlowBlock[],
  pageConfig: PageConfig,
  resolved: ResolvedChrome,
  metricsFor: (pageNumber: number) => PageMetrics,
  runId: number,
  previousLayout: DocumentLayout | undefined,
  measureCache: WeakMap<Node, MeasureCacheEntry> | undefined,
  initPages: LayoutPage[],
  initPage: LayoutPage,
  initY: number,
  initPrevSpaceAfter: number,
  pageless?: boolean,
): {
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
} {
  // `resolved` is consumed indirectly via `metricsFor` — the aggregator
  // already baked contributions into the per-page metrics. Kept as a
  // parameter for future expansion (e.g., passing payloads through to
  // layout-time hooks) and to keep the signature aligned with runPipeline.
  void resolved;

  const { margins } = pageConfig;
  const pages = initPages;
  let currentPage = initPage;
  let y = initY;
  let prevSpaceAfter = initPrevSpaceAfter;

  // Phase 1b: only valid after we've seen at least one cache miss (= the edit point).
  let seenCacheMiss = false;
  let earlyTerminated = false;

  for (const flow of flows) {
    // ── Hard page break (skipped in pageless mode) ───────────────────────────
    if (flow.isPageBreak && !pageless) {
      pages.push(currentPage);
      currentPage = newPage(pages.length + 1);
      y = metricsFor(currentPage.pageNumber).contentTop;
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

        let linesFit = 0;
        let heightFit = 0;
        for (const line of remainingLines) {
          if (heightFit + line.lineHeight > pageAvailable) break;
          linesFit++;
          heightFit += line.lineHeight;
        }

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
      // Phase 1b two-guard additions: runId identifies THIS run, contentTop
      // snapshots the specific page's reserved-top value. Both are read by
      // the next run's early-termination guard to detect chrome configuration
      // changes that would make the cached targetY stale.
      cachedEntry.placedRunId = runId;
      cachedEntry.placedContentTop = metricsFor(currentPage.pageNumber).contentTop;
    }

    // ── Phase 1b: early termination ───────────────────────────────────────────
    //
    // Safe to take the shortcut only when ALL of the following match between
    // the previous run and this one:
    //   1. targetY is the same (block landed at the same vertical position)
    //   2. pageNumber is the same (block landed on the same page)
    //   3. preCachedRunId === previousLayout.runId (the cache entry is from
    //      the run we'd be copying from, not an older run)
    //   4. preCachedContentTop === current page's contentTop (the page's
    //      reserved-top hasn't shifted due to chrome configuration changes)
    //
    // Conditions 3 and 4 are the Phase 0 additions for the multi-surface
    // refactor. With zero chrome contributors (Phase 0 default), condition
    // 4 is always true (contentTop = margins.top on every run) and condition
    // 3 is true whenever the cache entry was written by the immediately
    // previous run, which is the normal case. So the shortcut rate is
    // unchanged from the pre-refactor behavior in Phase 0.
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
          pages.push(currentPage);

          for (let pi = curPageIdx + 1; pi < prevPages.length; pi++) {
            const prevPage = prevPages[pi]!;
            pages.push({
              pageNumber: prevPage.pageNumber,
              blocks: prevPage.blocks.map((b) => shiftBlock(b, delta, measureCache)),
            });
          }

          earlyTerminated = true;
          break;
        }
      }
    }
  }

  return { pages, currentPage, y, prevSpaceAfter, earlyTerminated };
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
        blockType: "page_break",
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
      measurer, fontConfig, fontModifiers, measureCache,
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
 * Stage 3 of the layout pipeline: compute float positions, populate the
 * ExclusionManager, and re-flow any blocks that overlap an exclusion zone.
 *
 * Pure geometry over paginated blocks — no measuring except targeted reflow of
 * blocks that intersect an exclusion zone. Called for both complete layouts and
 * partial (streaming) layouts so floats in the initial chunk appear immediately.
 *
 * @param pass1Result  Paginated layout from paginateFlow() (Stages 1+2).
 * @param margins      Page margins.
 * @param pageWidth    Full page width (used to compute content area for floats).
 * @param contentWidth Content width (pageWidth - margins.left - margins.right).
 * @param measurer     TextMeasurer — used only for targeted block reflow.
 * @param fontConfig   Font config forwarded to layoutBlock() during reflow.
 * @param fontModifiers Font modifiers forwarded to layoutBlock() during reflow.
 */
export function applyFloatLayout(
  pass1Result: DocumentLayout,
  margins: PageConfig["margins"],
  pageWidth: number,
  contentWidth: number,
  measurer: TextMeasurer,
  fontConfig: FontConfig,
  fontModifiers: Map<string, FontModifier> | undefined,
): DocumentLayout {
  const { pages } = pass1Result;

  // Only run when the document actually contains floating images.
  // When no floats exist, skip entirely — zero overhead for the common case.
  const floatAnchors = collectFloatAnchors(pages);
  if (floatAnchors.length === 0) {
    return pass1Result;
  }

  // Per-page metrics lookup. Normally `pass1Result.metrics` is populated by
  // runPipeline with one entry per page, and we index into it by `pageNumber - 1`.
  // Fallback: if `metrics` is absent (e.g. a test or caller that constructs
  // DocumentLayout directly without running the pipeline), compute fresh from
  // EMPTY_RESOLVED_CHROME — this matches the pre-refactor hand-computed formula.
  const metricsForPage = (pageNumber: number): PageMetrics => {
    const idx = pageNumber - 1;
    const m = pass1Result.metrics?.[idx];
    if (m && m.pageNumber === pageNumber) return m;
    return computePageMetrics(pass1Result.pageConfig, EMPTY_RESOLVED_CHROME, pageNumber);
  };

  // Snapshot Pass 1 page/block positions before any mutation.
  // Phase 1b copies blocks from previousLayout; it must copy from these clean
  // positions rather than the float-adjusted ones. See DocumentLayout._pass1Pages.
  const pass1Pages: LayoutPage[] = pages.map((p) => ({
    pageNumber: p.pageNumber,
    blocks: [...p.blocks],
  }));

  // Pass 2: compute float positions and populate the ExclusionManager.
  const exclusionMgr = new ExclusionManager();
  const floats: FloatLayout[] = [];
  const FLOAT_MARGIN = 8; // px gap around each float

  for (const anchor of floatAnchors) {
    const node = anchor.node;
    const attrs = node.attrs as {
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

    const contentX = margins.left;
    const contentRight = pageWidth - margins.right;
    const contentWidth = contentRight - contentX;

    // Clamp nodeWidth so it never exceeds the available content width.
    // For break (top-bottom) mode the image stretches to fill the full content
    // width — the stored attrs.width is ignored for layout purposes.
    const clampedNodeWidth = mode === "top-bottom" ? contentWidth : Math.min(nodeWidth, contentWidth);

    let floatX: number;
    if (mode === "square-right") {
      // offsetX shifts from the default right-side position. Adding it means
      // dragging right increases offsetX and moves the image right (natural).
      floatX = contentRight - clampedNodeWidth + offsetX;
    } else if (mode === "top-bottom") {
      // Break mode: image starts at the content left edge (full-width).
      floatX = contentX;
    } else {
      // square-left, behind, front — default to left side
      floatX = contentX + offsetX;
    }
    // Clamp so the float never escapes the page content area regardless of how
    // floatOffset was set (drag, paste, serialised state, etc.).
    floatX = Math.max(contentX, Math.min(floatX, contentRight - clampedNodeWidth));

    // Fix 1: downward scan — push this float below any already-placed float on
    // the same page that it would physically overlap. This implements the CSS
    // VizAssert "find smallest Y where float fits" rule: a float cannot occupy
    // horizontal space already taken by a previously placed float at that Y.
    // 'behind'/'front' floats are exempt — they render above/below text and
    // never create exclusion zones, so stacking rules don't apply.
    //
    // Per-page: contentBottom reads via metricsForPage so differentFirstPage
    // headers and future footnote bands produce the correct clamp bound for
    // this anchor's specific page.
    const floatPageBottom = metricsForPage(anchor.anchorPage).contentBottom;

    // Helper: run the downward-scan stacking loop for a given page + candidateY.
    const resolveStacking = (onPage: number, startY: number): number => {
      let cy = startY;
      if (mode === "behind" || mode === "front") return cy;
      let changed = true;
      while (changed) {
        changed = false;
        for (const placed of floats) {
          if (placed.page !== onPage) continue;
          if (placed.mode === "behind" || placed.mode === "front") continue;
          const hOverlap = floatX < placed.x + placed.width && floatX + clampedNodeWidth > placed.x;
          const vOverlap = cy < placed.y + placed.height && cy + nodeHeight > placed.y;
          if (hOverlap && vOverlap) {
            cy = placed.y + placed.height;
            changed = true;
          }
        }
      }
      return cy;
    };

    let candidateY = resolveStacking(anchor.anchorPage, anchor.anchorBlockY + offsetY);

    // If stacking pushed the float past the page bottom, overflow it to the
    // next page and re-run stacking there so it doesn't overlap any floats
    // already placed on that page.
    let floatPage = anchor.anchorPage;
    if (mode !== "behind" && mode !== "front" && candidateY + nodeHeight > floatPageBottom) {
      floatPage = anchor.anchorPage + 1;
      // When overflowing to the next page, reset to THAT page's contentTop
      // (not the current page's) — this matters once chrome contributors
      // produce different reservations per page.
      candidateY = resolveStacking(floatPage, metricsForPage(floatPage).contentTop);
    }

    floats.push({
      docPos: anchor.docPos,
      page: floatPage,
      x: floatX,
      y: candidateY,
      width: clampedNodeWidth,
      height: nodeHeight,
      mode,
      node,
      anchorBlockY: anchor.anchorBlockY,
      anchorPage: anchor.anchorPage,
    });

    // 'behind' and 'front' float over text with no exclusion — text flows
    // through them. Only wrapping modes create exclusion zones.
    if (mode === "behind" || mode === "front") continue;

    // Determine which side text is excluded from.
    const side: "left" | "right" | "full" =
      mode === "square-left" ? "left" :
      mode === "square-right" ? "right" :
      "full"; // top-bottom

    // For top-bottom (break) mode the exclusion must span the full content width
    // so no text can flow beside the image. For left/right wrap only the image
    // footprint (+ margin) is excluded.
    const exclLeft  = side === "full" ? contentX     : floatX - FLOAT_MARGIN;
    const exclRight = side === "full" ? contentRight : floatX + clampedNodeWidth + FLOAT_MARGIN;

    exclusionMgr.addRect({
      page: floatPage,
      x: exclLeft,
      right: exclRight,
      y: candidateY - FLOAT_MARGIN,
      bottom: candidateY + nodeHeight + FLOAT_MARGIN,
      side,
      docPos: anchor.docPos,
    });
  }

  // Pass 3: re-layout blocks whose Y range overlaps an exclusion zone, then
  // cascade any height change to every subsequent block on the same page.
  //
  // `pageBottom` is fetched per-page inside the loop (not hoisted) because
  // different pages may reserve different footer band heights once chrome
  // contributors land. In Phase 0 with zero contributors, every page has
  // the same contentBottom so there's no functional difference.
  for (const page of pages) {
    if (!exclusionMgr.hasExclusionsOnPage(page.pageNumber)) continue;

    const pageBottom = metricsForPage(page.pageNumber).contentBottom;

    const pageNum = page.pageNumber;
    // Accumulated height delta from all re-layouts so far on this page.
    // Applied to subsequent blocks so they don't overlap the taller reflowed blocks.
    let yDelta = 0;
    // Non-overlapping blocks pushed past the page bottom by yDelta accumulation.
    // Collected here and prepended to the next page after the inner loop.
    const overflowToNext: LayoutBlock[] = [];

    for (let bi = 0; bi < page.blocks.length; bi++) {
      let block = page.blocks[bi]!;

      // Shift this block's Y by the accumulated delta from previous re-layouts.
      if (yDelta !== 0) {
        block = { ...block, y: block.y + yDelta };
        page.blocks[bi] = block;
      }

      // Skip leaf blocks (no lines to reflow or clamp).
      if (block.lines.length === 0) continue;

      const hasOverlap = exclusionMgr.getConstraint(
        pageNum,
        block.y,
        block.height || 1,
        margins.left,
        contentWidth,
      ) !== null;

      if (hasOverlap) {
        // Build a ConstraintProvider bound to this block's absolute position.
        const blockContentX = block.x;
        const blockAvailWidth = block.availableWidth;

        const constraintProvider: ConstraintProvider = (absoluteLineY: number) => {
          return exclusionMgr.getConstraint(
            pageNum,
            absoluteLineY,
            1,
            blockContentX,
            blockAvailWidth,
          );
        };

        // Re-measure the block with the constraint provider.
        // layoutBlock always lays out the FULL paragraph node. When this block
        // was split across pages in Pass 1, the reflowed result contains all
        // lines — far more than can fit on this page — causing content to
        // overflow into the bottom margin. Clamp lines to the page boundary.
        const reflowed = layoutBlock(block.node, {
          nodePos: block.nodePos,
          x: block.x,
          y: block.y,
          availableWidth: block.availableWidth,
          page: pageNum,
          measurer,
          fontConfig,
          ...(fontModifiers ? { fontModifiers } : {}),
          constraintProvider,
        });

        const finalBlock = clampBlockToPage(reflowed, pageBottom);

        // Accumulate the height difference so subsequent blocks shift accordingly.
        yDelta += finalBlock.height - block.height;
        page.blocks[bi] = finalBlock;
      } else if (block.y + block.height > pageBottom) {
        // Non-overlapping block pushed past the page bottom by yDelta.
        // Split it so lines that fit stay on this page; the rest move to the next.
        const { kept, overflow } = splitBlockAtBoundary(block, pageBottom);
        if (kept) {
          page.blocks[bi] = kept;
        } else {
          page.blocks.splice(bi, 1);
          bi--;
        }
        overflowToNext.push(overflow);
      }
    }

    // Prepend overflow blocks to the next page, repositioned at the top of its
    // content area. Existing next-page blocks shift down to make room.
    if (overflowToNext.length > 0) {
      const nextPageNum = pageNum + 1;
      let nextPage = pages.find((p) => p.pageNumber === nextPageNum);
      if (!nextPage) {
        nextPage = { pageNumber: nextPageNum, blocks: [] };
        const insertAt = pages.findIndex((p) => p.pageNumber > nextPageNum);
        if (insertAt === -1) pages.push(nextPage);
        else pages.splice(insertAt, 0, nextPage);
      }

      // Stack overflow blocks at the top of the next page's content area.
      // Use the NEXT page's contentTop (not the current page's) so chrome
      // reservations on the next page are respected.
      const nextPageContentTop = metricsForPage(nextPage.pageNumber).contentTop;
      let nextY = nextPageContentTop;
      const reposBlocks: LayoutBlock[] = overflowToNext.map((b) => {
        const rb = { ...b, y: nextY };
        nextY += b.height;
        return rb;
      });
      const totalHeight = nextY - nextPageContentTop;

      // Push existing next-page blocks down to accommodate the inserted blocks.
      for (let j = 0; j < nextPage.blocks.length; j++) {
        nextPage.blocks[j] = { ...nextPage.blocks[j]!, y: nextPage.blocks[j]!.y + totalHeight };
      }
      nextPage.blocks.unshift(...reposBlocks);
    }
  }

  // Pass 3b: Overflow cascade — propagate block overflow to pages that were
  // skipped by Pass 3 because they have no float exclusions.
  //
  // Pass 3 runs only on pages that have exclusion zones. When it moves blocks
  // from page N to page N+1 (overflowToNext), it pushes page N+1's existing
  // blocks DOWN. If those pushed blocks now exceed page N+1's bottom, they stay
  // there — Pass 3 never visits page N+1 because it has no exclusions.
  //
  // This pass iterates every page in forward order and moves any text block
  // whose bottom exceeds pageBottom to the next page, cascading as far as
  // needed. It is safe to re-run on pages already handled by Pass 3 because
  // those pages have no remaining overflowing blocks after Pass 3.
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi]!;
    const overflowBlocks: LayoutBlock[] = [];
    // Per-page pageBottom (was hoisted in the pre-refactor code). With zero
    // chrome contributors (Phase 0) every page has the same value, so
    // behavior is unchanged; Phase 1b+ uses this per-page.
    const pagePageBottom = metricsForPage(page.pageNumber).contentBottom;

    for (let bi = 0; bi < page.blocks.length; bi++) {
      const block = page.blocks[bi]!;
      // Leaf blocks (images, HRs) keep their position even when they overflow —
      // same policy as Pass 3. Text blocks are split at the page boundary.
      if (block.lines.length === 0) continue;
      if (block.y + block.height > pagePageBottom) {
        const { kept, overflow } = splitBlockAtBoundary(block, pagePageBottom);
        if (kept) {
          page.blocks[bi] = kept;
        } else {
          page.blocks.splice(bi, 1);
          bi--;
        }
        overflowBlocks.push(overflow);
      }
    }

    if (overflowBlocks.length === 0) continue;

    const nextPageNum = page.pageNumber + 1;
    let nextPage = pages.find((p) => p.pageNumber === nextPageNum);
    if (!nextPage) {
      nextPage = { pageNumber: nextPageNum, blocks: [] };
      const insertAt = pages.findIndex((p) => p.pageNumber > nextPageNum);
      if (insertAt === -1) pages.push(nextPage);
      else pages.splice(insertAt, 0, nextPage);
    }

    const nextPageContentTop = metricsForPage(nextPage.pageNumber).contentTop;
    let nextY = nextPageContentTop;
    const reposBlocks: LayoutBlock[] = overflowBlocks.map((b) => {
      const rb = { ...b, y: nextY };
      nextY += b.height;
      return rb;
    });
    const totalHeight = nextY - nextPageContentTop;

    for (let j = 0; j < nextPage.blocks.length; j++) {
      nextPage.blocks[j] = { ...nextPage.blocks[j]!, y: nextPage.blocks[j]!.y + totalHeight };
    }
    nextPage.blocks.unshift(...reposBlocks);
    // Do NOT increment pi — we need to re-examine this same page index in case
    // the newly inserted nextPage is at pages[pi+1] and itself overflows.
  }

  // Pass 4: Reconcile float Y values after Pass 3 may have shifted anchor blocks.
  //
  // Pass 3 applies a `yDelta` to every block that follows a reflowed block,
  // updating block.y in-place. But the FloatLayout entries were computed in
  // Pass 2 from the original Pass 1 block positions. If a block *before* a
  // float's anchor paragraph was reflowed (grew taller due to text wrapping),
  // the anchor block shifts by yDelta while the float remains at the old Y —
  // causing the float to visually drift above its anchor.
  //
  // Fix: walk the final block list, find each float anchor span, record the
  // block's new Y, then remap every FloatLayout to that corrected position.
  // This corrects the rendered position; the exclusion zones (used by Pass 3,
  // now complete) are not retroactively changed.
  if (floats.length > 0) {
    const finalAnchorY = new Map<number, { y: number; page: number }>();
    for (const page of pages) {
      for (const block of page.blocks) {
        for (const line of block.lines) {
          for (const span of line.spans) {
            if (span.kind !== "object" || span.width !== 0) continue;
            const wm = span.node.attrs["wrappingMode"] as string | undefined;
            if (!wm || wm === "inline") continue;
            finalAnchorY.set(span.docPos, { y: block.y, page: page.pageNumber });
          }
        }
      }
    }

    for (let fi = 0; fi < floats.length; fi++) {
      const f = floats[fi]!;
      const final = finalAnchorY.get(f.docPos);
      if (!final) continue;
      // Shift by exactly how much the anchor block moved in Pass 3 (yDelta).
      // Using (final.y - f.anchorBlockY) rather than (final.y + offsetY) is
      // critical: the latter would reset f.y to the un-stacked position,
      // undoing any downward displacement that Fix 1's stacking applied.
      const yDelta = final.y - f.anchorBlockY;
      const newY = f.y + yDelta;
      // Only update the float's page to match the anchor when the float was NOT
      // overflow-placed onto a different page by Pass 2. If anchorPage !== page,
      // the float deliberately lives on page N+1 to avoid exceeding page N's
      // bottom — resetting it to final.page would move it back and hide it.
      const newPage = f.anchorPage === f.page ? final.page : f.page;
      if (newY !== f.y || newPage !== f.page) {
        floats[fi] = { ...f, y: newY, page: newPage };
      }
    }
  }

  return { ...pass1Result, floats, _pass1Pages: pass1Pages };
}

/**
 * Truncates a block's lines so that `block.y + block.height <= pageBottom`.
 * Returns the same block reference when no clamping is needed.
 * Forces at least one line when the block starts below the page bottom so the
 * block is never completely empty (prevents cursor / hit-test holes).
 */
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

function clampBlockToPage(block: LayoutBlock, pageBottom: number): LayoutBlock {
  const available = pageBottom - block.y;
  if (block.height <= available) return block;

  let h = 0;
  let lineCount = 0;
  for (const line of block.lines) {
    if (h + line.lineHeight > available) break;
    h += line.lineHeight;
    lineCount++;
  }
  // Force at least one line only when the block starts above the page bottom
  // and there is at least a sliver of space. Blocks that start at or below
  // pageBottom (available ≤ 0) become empty (they're fully off-page).
  if (lineCount === 0 && available > 0 && block.lines.length > 0) {
    lineCount = 1;
    h = block.lines[0]!.lineHeight;
  }
  return {
    ...block,
    lines: block.lines.slice(0, lineCount),
    height: h,
    continuesOnNextPage: true as const,
  };
}

/**
 * Split a text block at the page boundary, returning both the part that fits
 * on the current page and the overflow part for the next page.
 *
 * Used by Pass 3 and Pass 3b when a yDelta shift pushes a block past pageBottom.
 * Unlike clampBlockToPage (which discards overflow lines), this preserves ALL
 * content by returning the overflow as a continuation block.
 *
 * Returns `kept: null` when no lines fit at all (block.y >= pageBottom or
 * first line doesn't fit) — in that case the entire block is the overflow.
 */
function splitBlockAtBoundary(
  block: LayoutBlock,
  pageBottom: number,
  keptFragmentIndex?: number,
  overflowFragmentIndex?: number,
): { kept: LayoutBlock | null; overflow: LayoutBlock } {
  const available = pageBottom - block.y;
  let linesFit = 0;
  let heightFit = 0;
  for (const line of block.lines) {
    if (heightFit + line.lineHeight > available) break;
    linesFit++;
    heightFit += line.lineHeight;
  }

  if (linesFit === 0) {
    // No lines fit on the current page — move entire block to next page unchanged.
    // This is not a continuation (no content was placed on the current page), so
    // preserve the original block's flags (same as the old whole-block-move behavior).
    return { kept: null, overflow: block };
  }

  const kept: LayoutBlock = {
    ...block,
    height: heightFit,
    lines: block.lines.slice(0, linesFit),
    spaceAfter: 0,
    continuesOnNextPage: true as const,
    ...(keptFragmentIndex !== undefined ? {
      fragmentIndex: keptFragmentIndex,
      sourceNodePos: block.sourceNodePos ?? block.nodePos,
    } : {}),
  };

  // Helper: spread block without list marker props (continuation parts don't show markers).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { listMarker: _lm, listMarkerX: _lmx, ...blockWithoutMarker } = block;

  const overflow: LayoutBlock = {
    ...blockWithoutMarker,
    // y will be repositioned by the caller when it stacks overflow blocks
    height: block.height - heightFit,
    lines: block.lines.slice(linesFit),
    spaceBefore: 0,
    isContinuation: true as const,
    ...(overflowFragmentIndex !== undefined ? {
      fragmentIndex: overflowFragmentIndex,
      sourceNodePos: block.sourceNodePos ?? block.nodePos,
    } : {}),
  };

  return { kept, overflow };
}

/** Float anchor: a zero-width object span referencing a floating image node. */
interface FloatAnchor {
  docPos: number;
  node: Node;
  anchorBlockY: number;
  anchorPage: number;
}

/**
 * Walks all laid-out blocks and collects float anchors — zero-width object
 * spans whose node has wrappingMode !== 'inline' and !== undefined.
 */
function collectFloatAnchors(pages: LayoutPage[]): FloatAnchor[] {
  const anchors: FloatAnchor[] = [];

  for (const page of pages) {
    for (const block of page.blocks) {
      for (const line of block.lines) {
        for (const span of line.spans) {
          if (span.kind !== "object") continue;
          if (span.width !== 0) continue; // only zero-width float anchors
          const wrappingMode = span.node.attrs["wrappingMode"] as string | undefined;
          if (!wrappingMode || wrappingMode === "inline") continue;
          anchors.push({
            docPos: span.docPos,
            node: span.node,
            anchorBlockY: block.y,
            anchorPage: page.pageNumber,
          });
        }
      }
    }
  }

  return anchors;
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
    if (node.type.name === "page_break") {
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
