import { Node } from "prosemirror-model";
import type { FontResolutionId, LayoutFontResolver } from "../fonts/layoutResolver";
import type { FontResolution } from "../fonts/types";
import type { FontModifier } from "../extensions/types";
import type { TextMeasurerLike } from "./TextMeasurer";
import {
  FontConfig,
  defaultFontConfig,
  DEFAULT_FONT_FAMILY,
  BlockStyle,
  applyPageFont,
} from "./FontConfig";
import { layoutBlock, LayoutBlock, type LayoutBlockKind, type LaidRegion } from "./BlockLayout";
import type { CompositeLayout, CompositeUnit, InlineRegistry } from "./BlockRegistry";
import { isSpacerLine, type LayoutLine } from "./LineBreaker";
import type { MarkerLine } from "./BlockLayout";
import type { LaidMarker, MarkerFace } from "./markers";
import {
  anchoredOf,
  floats,
  type AnchoredObjectPlacement,
  type WrapMode,
} from "./AnchoredObjects";
import {
  samePageMetrics,
  buildPageStarts,
  createPageGeometry,
  EMPTY_RESOLVED_CHROME,
  type PageGeometry,
  type PageMetrics,
  type ResolvedChrome,
  type PageChromeContribution,
  type PageChromeMeasureInput,
} from "./PageMetrics";
import {
  collectLayoutItems,
  itemSpacing,
  laidMarkerOf,
  measureWithMarker,
  pageStartPast,
  resolveItem,
  type LayoutItem,
  type MarkerPlacement,
  type PageStart,
} from "./layoutItems";
import { fitLinesInCapacity } from "./splitLines";
import {
  assignGlobalY,
  collapseMargins,
  lineFitsAt,
  flowCursorAfter,
  pageLocalYForGlobalY,
  targetPageNumber,
  type FlowCursor,
} from "./FlowPlacement";
export { collapseMargins } from "./FlowPlacement";
import { resolveAnchoredObjects } from "./AnchoredObjectSolver";
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
   * Every face this layout measured against, by the id its spans carry.
   * Absent when the editor has no font provider — nothing was resolved, so
   * there is nothing to claim. A consumer reproducing this geometry reads
   * these rather than deriving its own answer from the family names.
   *
   * Cumulative for the coordinator's lifetime so ids on cached spans stay
   * resolvable; it therefore holds faces the document no longer uses. Read
   * the spans, not this table, to describe the document as it stands.
   */
  fontResolutions?: ReadonlyMap<FontResolutionId, FontResolution>;
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
   * True when the layout was stopped early via `maxBlocks`. Blocks beyond the
   * cutoff have not been measured, and a float among them can still change the
   * last pages. Editor schedules a background pass to complete the layout.
   */
  isPartial?: boolean;
  /**
   * Saved cursor state for incremental chunked layout. Present when
   * isPartial:true. Pass back via PageLayoutOptions.resumption to continue where
   * this run stopped.
   */
  resumption?: LayoutResumption;
  /**
   * Anchored objects (non-inline images) placed by Stage 3.
   * Each placement has page-local coordinates for the renderer and the
   * structural anchor info needed for hit-testing and selection.
   */
  anchoredObjects?: AnchoredObjectPlacement[];
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

  /**
   * Global flow Y where each page's content begins — the prefix sum over
   * `metrics`, aligned with it 1:1. Carried on the layout so hit-testing and
   * pointer geometry read a page's origin instead of summing the pages before
   * it on every event.
   */
  pageStarts?: number[];

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
  chromePayloads?: Record<string, unknown>;
  /**
   * @internal
   * What this layout laid out, in order, boundaries included. The next run
   * compares it with its own to find the tail it may reuse. Absent on partial
   * (streaming) layouts.
   */
  items?: readonly LayoutItem[];
}

/**
 * Saved cursor state from a partial layout pass.
 * Returned with isPartial:true; passed back as PageLayoutOptions.resumption to
 * go on from there. A float that crosses the cutoff, or a chrome change, makes
 * the next run lay some of it out again, so a flow pass must not mutate it.
 */
export interface LayoutResumption {
  /** The flat item list — cached to avoid re-walking the doc. */
  items: LayoutItem[];
  /** Index of the first item that was NOT yet processed. */
  nextItemIndex: number;
  /** Geometry that placed the saved prefix. A mismatch forces a replay. */
  metrics: readonly PageMetrics[];
  /** Pages before the one being built. */
  completedPages: LayoutPage[];
  /** The page currently being built (may have partial blocks). */
  currentPage: LayoutPage;
  /** Continuous-flow cursor, kept separately from the paginated page cursor. */
  flowCursor?: FlowCursor;
  /** Y cursor position on currentPage. */
  currentY: number;
  /** spaceAfter of the last placed block, for margin collapsing. */
  prevSpaceAfter: number;
  /** The floats placed so far, those in composite regions aside. */
  floats: readonly AnchoredObjectPlacement[];
  /** Version of the pages so far. */
  version: number;
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
   * The nodePos at which these lines were last measured. The positions in them
   * are absolute and must be adjusted when the block shifts in the document.
   */
  nodePos: number;
  /** Mirrors `LayoutBlock.kind` so consumers can route without re-measuring. */
  kind: LayoutBlockKind;
  height: number;
  lines: LayoutLine[];
  /** A composite unit's regions, laid out. */
  regions?: LaidRegion[];
  /** A composite unit's own data. */
  unitData?: unknown;
  spaceBefore: number;
  spaceAfter: number;
  blockType: string;
  align: BlockStyle["align"];
  /** The marker the block was measured with, and where; a different one is a cache miss. */
  marker?: MarkerPlacement;
  /** The first-line room its marker resolved to; every re-layout reuses it. */
  markerLine?: MarkerLine;
  /** The face its marker was measured in. */
  markerFace?: MarkerFace;
  /**
   * Where this block was last placed: page-local y before overflow, and page.
   * A run that puts it there again may reuse the previous layout's tail, if the
   * items after it are the same too. Undefined until a layout has placed it.
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
  /** The first-line room its marker resolved to; every re-layout reuses it. */
  markerLine?: MarkerLine;
  nodePos: number;
  /**
   * Mirrors `LayoutBlock.kind` so the pagination loop and exclusion reflow can
   * route on the discriminator instead of probing `lines.length`. Page-break
   * markers are tagged `"leaf"` (no inline content of their own).
   */
  kind: LayoutBlockKind;
  /** Measured lines — position-independent (lineHeight only, no absolute Y). */
  lines: LayoutLine[];
  /** A composite unit's regions (y relative to the unit's top). */
  regions?: LaidRegion[];
  /** A composite unit's own data. */
  unitData?: unknown;
  /** True for the last unit of its composite. */
  lastUnit?: true;
  height: number;
  /** Block style spacing (styleKey-aware, e.g. list_item overrides paragraph). */
  spaceBefore: number;
  spaceAfter: number;
  availableWidth: number;
  blockType: string;
  align: BlockStyle["align"];
  marker?: LaidMarker;
  indentLeft: number;
  /** True if any line span is a zero-width anchored-object anchor. */
  hasAnchoredObject: boolean;
  /** djb2 hash of nodePos + textContent + availableWidth for incremental re-layout. */
  inputHash: number;
  /** Set on a boundary that moves the flow: the page the next block starts on. */
  pageStart?: PageStart;
  /** True when the block measurement was a cache hit. */
  wasCacheHit: boolean;
  partKind?: "block" | "fragment";
  /** Continuous document-flow Y before page projection. */
  globalY?: number;
  /** Initial continuous Y before anchored-object solver pushes. */
  originalGlobalY?: number;
  /** True when Stage 3 intentionally moved this flow's globalY. */
  solverPushedThisFlow?: boolean;
  /** Global y Stage 3 last laid this flow's lines out at, around the floats there. Absent when it did not. */
  wrapLaidAtY?: number;
  /** The lines this flow was measured with, kept once Stage 3 lays it out around floats. */
  measuredLines?: LayoutLine[];
  // Where the last run placed this block, read before this run's measurement.
  preCachedTargetY?: number;
  preCachedPage?: number;
  /** Cached placedRunId snapshot for early-termination guard. */
  preCachedRunId?: number;
  /** Cached placedContentTop snapshot for early-termination guard. */
  preCachedContentTop?: number;
}


/**
 * Clamp `placement.page` to the actual page count so downstream consumers
 * (PDF export, hit-testing, CharacterMap lookup) never reference a page that
 * doesn't exist. Under extreme inputs (huge image height + dense float
 * packing + yOffset extremes), the anchored-object solver can decide
 * `placement.page` based on geometry before pagination finalizes its page
 * count — if no flow content lands on the geometry-derived page, the page
 * list truncates and the placement keeps the higher index. The clamp keeps
 * `placement.y` untouched: the float was already painting off the bottom of
 * its target page; the visual is no worse, but every consumer that loops
 * over pages can now trust `placement.page <= layout.pages.length`.
 *
 * Applied only to the final layout: a partial one's page count is not settled.
 *
 * Returns the original array reference when no clamping was needed so the
 * common case stays allocation-free.
 *
 * @internal — used by `runPipeline`'s finalization. Not part of the
 * package's public API surface (`@scrivr/core` does not re-export it via
 * the barrel); exported here only so the internal test file can drive it
 * directly without re-creating a phantom-page scenario from end-to-end.
 */
export function clampPlacementsToPages(
  placements: AnchoredObjectPlacement[],
  pageCount: number,
): AnchoredObjectPlacement[] {
  if (pageCount === 0) return placements;
  let needsClamp = false;
  for (const p of placements) {
    if (p.page > pageCount) {
      needsClamp = true;
      break;
    }
  }
  if (!needsClamp) return placements;
  return placements.map((p) =>
    p.page > pageCount ? { ...p, page: pageCount } : p,
  );
}

/**
 * Images laid out inside composite regions, in page coordinates. A unit carries
 * its images unit-relative, so they are read off the units where pagination
 * put them.
 */
function regionFloatPlacements(
  pages: readonly LayoutPage[],
  geometry: PageGeometry,
): AnchoredObjectPlacement[] {
  const placements: AnchoredObjectPlacement[] = [];
  for (const page of pages) {
    const toGlobal = (localY: number) =>
      geometry.startOf(page.pageNumber) + localY - geometry.metricsFor(page.pageNumber).contentTop;
    // A composite nested in a region (a table in a cell) carries its own
    // regions' images, relative to its own top.
    const visit = (blocks: readonly LayoutBlock[], originY: number): void => {
      for (const block of blocks) {
        const unitTop = originY + block.y;
        for (const region of block.regions ?? []) {
          visit(region.blocks, unitTop);
          for (const f of region.floats ?? []) {
            const y = unitTop + f.y;
            placements.push({
              docPos: f.docPos,
              page: page.pageNumber,
              x: f.x,
              y,
              width: f.width,
              height: f.height,
              wrapMode: f.wrapMode,
              zIndex: f.zIndex,
              node: f.node,
              anchorGlobalY: toGlobal(unitTop + f.anchorY),
              anchorPage: page.pageNumber,
              globalY: toGlobal(y),
              regionPos: region.pos,
              ...(f.clamped ? { clamped: true } : {}),
              ...(f.stackOffset ? { stackOffset: f.stackOffset } : {}),
            });
          }
        }
      }
    };
    visit(page.blocks, 0);
  }
  return placements;
}

/** The end of the previous layout that this run's items end with too. */
interface ReusableTail {
  layout: DocumentLayout;
  /** From this document position on, the items are the previous layout's. */
  fromPos: number;
  /** How far the items moved in the document since. */
  shift: number;
}

/**
 * The previous layout's tail this run's items end with, if any. Counting cache
 * misses cannot find it: a deleted or a moved block is not one. Style is
 * compared because it sets only spacing, which is not measured; a changed
 * marker or width is a cache miss.
 */
function findReusableTail(items: readonly LayoutItem[], layout: DocumentLayout): ReusableTail | undefined {
  const previous = layout.items ?? [];
  let tail: ReusableTail | undefined;
  for (let back = 1; back <= Math.min(items.length, previous.length); back++) {
    const item = items[items.length - back]!;
    const before = previous[previous.length - back]!;
    const shift = item.nodePos - before.nodePos;
    if (item.node !== before.node || item.styleKey !== before.styleKey || (tail && tail.shift !== shift)) break;
    tail = { layout, fromPos: item.nodePos, shift };
  }
  return tail;
}

function pageRectsDigest(rects: readonly AnchoredObjectPlacement[] | undefined): string {
  if (!rects || rects.length === 0) return "";
  return rects
    .map((r) => `${r.page}:${r.x}:${r.x + r.width}:${r.y}:${r.y + r.height}:${r.wrapMode}:${r.docPos}:${anchoredOf(r.node)?.margin}`)
    .sort()
    .join("|");
}

/**
 * What every measuring stage needs and none of them decides.
 *
 * A bundle rather than a parameter list, so the next dependency costs a field
 * instead of an argument in three signatures.
 */
export interface MeasureContext {
  measurer: TextMeasurerLike;
  fontConfig: FontConfig;
  fontModifiers?: Map<string, FontModifier>;
  inlineRegistry?: InlineRegistry;
  measureCache?: WeakMap<Node, MeasureCacheEntry>;
  /** Answers what face a span is measured in. Absent when no provider. */
  fonts?: LayoutFontResolver;
}

export interface PageLayoutOptions {
  pageConfig: PageConfig;
  measurer: TextMeasurerLike;
  fontConfig?: FontConfig;
  /**
   * Pass the previous version so callers can increment it.
   * Defaults to 1 on first layout.
   */
  previousVersion?: number;
  /** Optional font modifier map from the ExtensionManager. Enables extensions to declare font effects. */
  fontModifiers?: Map<string, FontModifier>;
  /**
   * Answers what face each span is measured in. Supplied by an editor that has
   * a font provider; absent otherwise, and then nothing resolves.
   */
  fonts?: LayoutFontResolver;
  /**
   * Block measurement cache keyed by Node reference.
   * When provided, unchanged blocks (same ProseMirror Node object) skip the
   * layoutBlock call entirely — O(1) cache hit instead of O(chars) re-measure.
   * The Editor owns this WeakMap and passes it on every runPipeline call.
   */
  measureCache?: WeakMap<Node, MeasureCacheEntry>;
  /**
   * The layout of the immediately preceding run. Its unchanged tail is reused
   * instead of being placed again; the result is the same without it.
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
   * Resume a chunked layout pass from a previous partial result. A chunk lays
   * out only new blocks, unless a float crosses the cutoff (it starts again from
   * an earlier page) or chrome changed the page geometry (from the document's
   * start). The budget grows by what is laid out again, so every chunk advances
   * by a whole one.
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
 * Drives the layout pipeline in order:
 *   Stage 1  buildBlockFlow                 — position-independent measurement
 *   Stage 2  assignGlobalY                  — continuous flow coordinates
 *   Stage 3  resolveAnchoredObjects          — anchored-object placement/pushes
 *   Stage 4  paginateFlow                   — assign blocks to pages
 *
 * Returns a fully positioned DocumentLayout. Does NOT touch the CharacterMap.
 * This function is the single source of truth for orchestration; both
 * LayoutCoordinator and tests call it instead of duplicating the logic.
 */
// Recursion guard — throws if runPipeline is called while already on the stack.
// Chrome contributors must use runMiniPipeline() instead.
let runPipelineDepth = 0;

/** Test-only: set the recursion depth counter to simulate re-entry. */
export function __setRunPipelineDepthForTest(n: number): void {
  runPipelineDepth = n;
}

export function runPipeline(
  doc: Node,
  options: PageLayoutOptions,
): DocumentLayout {
  // Recursion guard — use runMiniPipeline() from chrome contributor hooks.
  if (runPipelineDepth > 0) {
    throw new Error(
      "[runPipeline] recursive call detected. Chrome contributors must call " +
      "runMiniPipeline() from their measure() hook, not runPipeline(). " +
      "runPipeline invokes aggregateChrome which would re-enter every " +
      "contributor and infinite-loop.",
    );
  }
  runPipelineDepth++;
  try {
    return runPipelineBody(doc, options);
  } finally {
    runPipelineDepth--;
  }
}

/**
 * Flow pipeline result. Pages, metrics, and anchored-object placements are
 * populated; fragments are applied after the chrome-aggregator loop converges.
 * Chrome contributors re-run this per iteration via the aggregator.
 */
export interface FlowPipelineResult {
  /** Pass-1 DocumentLayout with pages, metrics, runId. No floats, no fragments. */
  layout: DocumentLayout;
  /** True when streaming cutoff stopped pagination mid-document. */
  isPartial: boolean;
  /** Geometry + font context used by the flow pipeline. */
  margins: PageConfig["margins"];
  pageWidth: number;
  contentWidth: number;
  fontConfig: FontConfig;
  fontModifiers: Map<string, FontModifier> | undefined;
  measurer: TextMeasurerLike;
  /** Y cursor at end of pagination — used for pageless totalContentHeight. */
  y: number;
  /** Anchored objects resolved before pagination. */
  anchoredObjects: AnchoredObjectPlacement[];
}

/** Where a run starts laying out, and what is already laid out before it. */
interface FlowStart {
  itemIndex: number;
  /** Pages finished before it. */
  pages: LayoutPage[];
  page: LayoutPage;
  y: number;
  prevSpaceAfter: number;
  flowCursor: FlowCursor;
}

function startOfPage(pageNumber: number, itemIndex: number, pages: LayoutPage[], geometry: PageGeometry): FlowStart {
  return {
    itemIndex,
    pages,
    page: newPage(pageNumber),
    y: geometry.metricsFor(pageNumber).contentTop,
    prevSpaceAfter: 0,
    flowCursor: { y: geometry.startOf(pageNumber), page: pageNumber },
  };
}

/** Where the snapshot stopped. */
function afterSnapshot(snapshot: LayoutResumption, flowCursor: FlowCursor): FlowStart {
  return {
    itemIndex: snapshot.nextItemIndex,
    pages: [...snapshot.completedPages],
    page: { ...snapshot.currentPage, blocks: [...snapshot.currentPage.blocks] },
    y: snapshot.currentY,
    prevSpaceAfter: snapshot.prevSpaceAfter,
    flowCursor,
  };
}

/**
 * The last page the snapshot reached that starts with a block of its own. A
 * float re-lays a paragraph that goes on to its page from that paragraph's
 * start; none before this page goes on past it.
 */
function lastPageStartingABlock(snapshot: LayoutResumption, geometry: PageGeometry): FlowStart {
  for (const page of [snapshot.currentPage, ...[...snapshot.completedPages].reverse()]) {
    const first = page.blocks[0];
    if (!first || first.isContinuation) continue;
    const itemIndex = snapshot.items.findIndex((item) => item.nodePos === first.nodePos);
    if (itemIndex < 0) continue;
    return startOfPage(page.pageNumber, itemIndex, snapshot.completedPages.slice(0, page.pageNumber - 1), geometry);
  }
  return startOfPage(1, 0, [], geometry);
}

const wrapsText = (float: AnchoredObjectPlacement): boolean => float.wrapMode === "square" || float.wrapMode === "top-bottom";

/** Where a float, with its margin, ends in the flow. */
const wrapEndOf = (float: AnchoredObjectPlacement): number =>
  float.globalY + float.height + (anchoredOf(float.node)?.margin ?? 0);

/** Whether a float on one side of the snapshot's cutoff reaches over it, to be wrapped on the other. */
function floatCrossesCutoff(
  snapshot: LayoutResumption,
  cutoffY: number,
  placed: readonly AnchoredObjectPlacement[],
): boolean {
  return snapshot.floats.some((float) => wrapsText(float) && wrapEndOf(float) > cutoffY)
    || placed.some((float) => wrapsText(float) && float.globalY < cutoffY);
}

/** A run that lays out again what the snapshot had still advances by a whole chunk. Boundaries are free. */
function blockBudget(start: FlowStart, snapshot: LayoutResumption | undefined, maxBlocks: number | undefined): number | undefined {
  if (maxBlocks === undefined || !snapshot) return maxBlocks;
  return maxBlocks + snapshot.items.slice(start.itemIndex, snapshot.nextItemIndex).filter((item) => !item.boundary).length;
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
  geometry: PageGeometry = createPageGeometry(options.pageConfig, resolved),
): FlowPipelineResult {
  const { fontModifiers, measureCache, previousLayout, pageConfig, measurer } = options;
  const baseConfig = options.fontConfig ?? defaultFontConfig;
  const fontConfig = applyPageFont(baseConfig, pageConfig.fontFamily ?? DEFAULT_FONT_FAMILY);

  const { pageWidth, pageHeight, margins } = pageConfig;
  const contentWidth = pageWidth - margins.left - margins.right;

  // Every page-position question in the pipeline reads through this, so none of
  // them re-derive a page start by summing the pages before it.
  const metricsFor = geometry.metricsFor;

  // Resumption. The snapshot's items, version and progress are always usable.
  // Its cursors are usable only while the geometry that placed them still holds.
  const snapshot = options.resumption;
  const items = snapshot ? snapshot.items : collectLayoutItems(doc);
  const resumed = snapshot?.flowCursor !== undefined
    && snapshot.metrics.every((m) => samePageMetrics(m, metricsFor(m.pageNumber)))
    ? afterSnapshot(snapshot, snapshot.flowCursor)
    : undefined;

  // Stage 1: measure.
  const flowConfig: FlowConfig = { margins, contentWidth };
  const measureCtx: MeasureContext = {
    measurer,
    fontConfig,
    ...(fontModifiers ? { fontModifiers } : {}),
    ...(measureCache ? { measureCache } : {}),
    ...(options.inlineRegistry ? { inlineRegistry: options.inlineRegistry } : {}),
    ...(options.fonts ? { fonts: options.fonts } : {}),
  };
  // Stage 2: assign continuous flow coordinates and resolve anchored objects.
  // The flow cursor and the paginated cursor are distinct: pagination may
  // suppress margins at page boundaries. Reconstructing one from the other
  // makes a chunk boundary change subsequent positions.
  const layFrom = (from: FlowStart) => {
    const measured = buildBlockFlow(items, from.itemIndex, flowConfig, measureCtx, blockBudget(from, snapshot, options.maxBlocks));
    const placed = assignGlobalY(measured.flows, from.flowCursor, pageConfig, geometry);
    return { flowResult: measured, anchoredFlow: resolveAnchoredObjects(placed, pageConfig, geometry, measureCtx) };
  };
  let start = resumed ?? startOfPage(1, 0, [], geometry);
  let laid = layFrom(start);
  // Without pages every restart would be from the start of the document.
  if (resumed && snapshot && !pageConfig.pageless && floatCrossesCutoff(snapshot, resumed.flowCursor.y, laid.anchoredFlow.placements)) {
    start = lastPageStartingABlock(snapshot, geometry);
    laid = layFrom(start);
  }
  const { flowResult, anchoredFlow } = laid;
  const appends = start === resumed;
  // Tiles skip repainting while the version stands. A chunk goes on from a page
  // that may be painted, if only blank, so it takes a version of its own:
  // otherwise the charmap moves to the new geometry over old pixels, and the
  // caret is drawn against text that is no longer there.
  const chunkVersion = snapshot ? snapshot.version + 1 : runId;

  // The floats this run did not place are the snapshot's, on the pages it left
  // alone.
  const carriedPlacements = snapshot
    ? snapshot.floats.filter((float) => appends || float.page < start.page.pageNumber)
    : [];
  const mergedPlacements = carriedPlacements.length > 0
    ? [...carriedPlacements, ...anchoredFlow.placements]
    : anchoredFlow.placements;
  // In-cell images are read off the rows after pagination, so only body
  // placements decide whether the cached tail still holds.
  const previousBodyPlacements = (previousLayout?.anchoredObjects ?? []).filter((p) => p.regionPos === undefined);
  // A partial layout has no tail, only a cutoff: copying from it would silently
  // truncate the document at the last streamed chunk. And past this run's own
  // cutoff nothing was measured, so nothing says what is there is unchanged.
  const canReuseTail =
    previousLayout && !previousLayout.isPartial && !flowResult.reachedCutoff &&
    previousLayout.metrics?.every((metrics) => samePageMetrics(metrics, metricsFor(metrics.pageNumber))) &&
    pageRectsDigest(previousBodyPlacements) === pageRectsDigest(mergedPlacements);

  const pr = paginateFlow(
    anchoredFlow.flows, pageConfig, resolved, geometry, runId,
    {
      tail: canReuseTail ? findReusableTail(items, previousLayout) : undefined,
      measureCache,
      pageless: pageConfig.pageless,
      init: { pages: start.pages, page: start.page, y: start.y, prevSpaceAfter: start.prevSpaceAfter },
    },
  );

  const isPartial = flowResult.reachedCutoff;
  const context = {
    margins, pageWidth, contentWidth, fontConfig, fontModifiers, measurer,
  };

  if (isPartial) {
    // Read off the anchored flows, not the pre-anchor ones: the solver may
    // have pushed the last flow down, and the next chunk continues from where
    // it actually landed.
    const lastFlow = anchoredFlow.flows.at(-1);
    const flowCursor = lastFlow
      // `globalY` is optional on the type; assignGlobalY above always sets it.
      ? flowCursorAfter(lastFlow, lastFlow.globalY ?? start.flowCursor.y, pageConfig, geometry)
      : snapshot?.flowCursor;
    const resumption: LayoutResumption = {
      items,
      ...(flowCursor ? { flowCursor } : {}),
      metrics: pr.metrics,
      nextItemIndex: flowResult.cutoffIndex,
      completedPages: pr.pages,
      currentPage: { ...pr.currentPage, blocks: [...pr.currentPage.blocks] },
      currentY: pr.y,
      prevSpaceAfter: pr.prevSpaceAfter,
      floats: mergedPlacements,
      version: chunkVersion,
    };
    const partialPages = [...pr.pages, pr.currentPage];
    const partialPlacements = [...mergedPlacements, ...regionFloatPlacements(partialPages, geometry)];
    // Not clamped: the page count is not settled until the last chunk.
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
      pageStarts: buildPageStarts(pageConfig, pr.metrics),
      runId,
      convergence: "stable",
      iterationCount: 1,
      anchoredObjects: partialPlacements,
    };
    return { layout, isPartial: true, ...context, y: pr.y, anchoredObjects: partialPlacements };
  }

  const allPages = pr.earlyTerminated ? pr.pages : [...pr.pages, pr.currentPage];
  const clampedFinal = clampPlacementsToPages(
    [...mergedPlacements, ...regionFloatPlacements(allPages, geometry)],
    allPages.length,
  );
  const layout: DocumentLayout = {
    pages: allPages,
    pageConfig,
    version: chunkVersion,
    totalContentHeight: 0,
    metrics: pr.metrics,
    pageStarts: buildPageStarts(pageConfig, pr.metrics),
    items,
    runId,
    convergence: "stable",
    iterationCount: 1,
    anchoredObjects: clampedFinal,
  };
  return { layout, isPartial: false, ...context, y: pr.y, anchoredObjects: clampedFinal };
}

function runPipelineBody(
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
    ...(options.fonts ? { fonts: options.fonts } : {}),
    ...(options.fontModifiers ? { fontModifiers: options.fontModifiers } : {}),
    ...(options.inlineRegistry ? { inlineRegistry: options.inlineRegistry } : {}),
  };

  const contributions = options.pageChromeContributions ?? [];
  const prevRunPayloads = previousLayout?.chromePayloads ?? {};
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
  // The resolver accumulated an answer per face while measuring; publishing it
  // here is what lets a consumer reproduce this geometry from the faces it was
  // actually built from rather than from the family names it asked for.
  const layoutWithChrome: DocumentLayout = {
    ...fp.layout,
    convergence: chromeResult.convergence,
    iterationCount: chromeResult.iterationCount,
    chromePayloads: chromeResult.chromePayloads,
    ...(options.fonts ? { fontResolutions: new Map(options.fonts.table()) } : {}),
  };

  if (fp.isPartial) return layoutWithChrome;

  // Stage 4: fragment index + totalContentHeight.
  const { fragments, fragmentsByPage } = buildFragments(layoutWithChrome.pages);
  const totalContentHeight = pageConfig.pageless
    ? fp.y + margins.bottom
    : layoutWithChrome.pages.length * pageHeight;
  return { ...layoutWithChrome, fragments, fragmentsByPage, totalContentHeight };
}

/** Options bag for paginateFlow — cross-cutting context + resumption cursor. */
export interface PaginateFlowOptions {
  /** Absent: no tail is reused. */
  tail?: ReusableTail | undefined;
  measureCache?: WeakMap<Node, MeasureCacheEntry> | undefined;
  pageless?: boolean | undefined;
  /** Where pagination goes on from: an empty page 1 for a fresh run. */
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
  /** Y cursor at the end: the bottom of the last block placed or copied. */
  y: number;
  /** Spacing state at end — only valid when earlyTerminated === false. */
  prevSpaceAfter: number;
  /** True when the rest of the pages were copied from the previous layout's tail. */
  earlyTerminated: boolean;
  /**
   * Per-page metrics accumulated during pagination. Aligned with the pages
   * the caller delivers: `earlyTerminated ? pages : [...pages, currentPage]`.
   */
  metrics: PageMetrics[];
}

/** Stage 2: assign measured FlowBlocks to pages. All positions read through `geometry`. */
export function paginateFlow(
  flows: FlowBlock[],
  pageConfig: PageConfig,
  resolved: ResolvedChrome,
  geometry: PageGeometry,
  runId: number,
  opts: PaginateFlowOptions,
): PaginateFlowResult {
  // `resolved` is what `geometry` was built from; reserved for future cache
  // checks keyed off resolved.metricsVersion. Read access today is a no-op.
  void resolved;

  const metricsFor = geometry.metricsFor;

  const { tail, measureCache, pageless, init } = opts;
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

  // A run that measured nothing anew runs for some other reason, and places
  // everything again.
  let seenCacheMiss = false;
  // An item whose marker or width changed is the same item but a miss, so the
  // tail is not reused before the last miss.
  let remainingCacheMisses = flows.reduce(
    (count, flow) => count + (flow.wasCacheHit ? 0 : 1),
    0,
  );
  let earlyTerminated = false;

  for (const flow of flows) {
    // Once per flow, before any branch can continue past it, on the predicate
    // the total was counted by.
    if (!flow.wasCacheHit) remainingCacheMisses -= 1;

    // ── Hard page break (skipped in pageless mode) ───────────────────────────
    if (flow.pageStart && !pageless) {
      const target = targetPageNumber(currentPage.pageNumber, flow.pageStart);
      while (currentPage.pageNumber < target) {
        pages.push(currentPage);
        currentPage = newPage(pages.length + 1);
        metrics.push(metricsFor(currentPage.pageNumber));
      }
      y = metricsFor(currentPage.pageNumber).contentTop;
      prevSpaceAfter = 0;
      continue;
    }

    const { node, nodePos } = flow;

    if (!flow.wasCacheHit) seenCacheMiss = true;

    if (!pageless && flow.globalY !== undefined) {
      while (
        flow.globalY >=
        geometry.bottomOf(currentPage.pageNumber)
      ) {
        pages.push(currentPage);
        currentPage = newPage(pages.length + 1);
        y = metricsFor(currentPage.pageNumber).contentTop;
        metrics.push(metricsFor(currentPage.pageNumber));
        prevSpaceAfter = 0;
      }
    }

    // ── Margin collapsing ────────────────────────────────────────────────────
    const isFirstOnPage = currentPage.blocks.length === 0;
    const gap = isFirstOnPage
      ? 0
      : collapseMargins(prevSpaceAfter, flow.spaceBefore);

    const naturalY = y + gap;
    const pageLocalGlobalY =
      !pageless && flow.globalY !== undefined
        ? pageLocalYForGlobalY(geometry, currentPage.pageNumber, flow.globalY)
        : naturalY;
    const firstOnPageNatural = isFirstOnPage && !flow.solverPushedThisFlow;
    const targetY = firstOnPageNatural ? naturalY : Math.max(naturalY, pageLocalGlobalY);
    const blockX = margins.left + flow.indentLeft;
    const blockWidth = flow.availableWidth;

    // Build a positioned LayoutBlock from the FlowBlock measurements. A
    // composite unit carries its regions (y relative to the unit's top, x
    // absolute), so "kind === composite → regions present" holds.
    const buildBlock = (x: number, bY: number): LayoutBlock => ({
      kind: flow.kind,
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
      ...(flow.kind === "composite" ? { regions: flow.regions ?? [], unitData: flow.unitData } : {}),
      ...(flow.lastUnit ? { lastUnit: true } : {}),
    });

    const block = buildBlock(blockX, targetY);

    Object.assign(block, markerFields(flow));

    // ── Per-page geometry snapshot ───────────────────────────────────────────
    // Computed once per outer-loop iteration. `currentMetrics` is stable for
    // the duration of this block's placement — it only changes when we advance
    // to a new page (leaf reflow or split-loop advance), at which point we
    // re-fetch with the new page number.
    const currentMetrics = metricsFor(currentPage.pageNumber);

    // ── Page overflow check (disabled in pageless mode) ───────────────────────
    const blockBottom = targetY + block.height;
    const pageBottom = currentMetrics.contentBottom;
    // Text blocks can always be split. A leaf or composite already at the page
    // top stays, however tall: moving it would only leave an empty page.
    const isAtomicBlock = flow.kind === "leaf" || flow.kind === "composite";
    const isAtPageTop = targetY === currentMetrics.contentTop;
    const overflows = !pageless && blockBottom > pageBottom && (!isAtomicBlock || !isAtPageTop);

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
      y = targetY + block.height;
      prevSpaceAfter = flow.spaceAfter;
    } else if (isAtomicBlock) {
      // ── Leaf or composite: move the whole block to the next page ───────────
      if ((globalThis as Record<string,unknown>).__LAYOUT_DEBUG__) {
        console.log(`  → ATOMIC moved to page ${pages.length + 2}`);
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
      Object.assign(reflow, markerFields(flow));

      currentPage.blocks.push(reflow);
      y = newPageContentTop + reflow.height;
      prevSpaceAfter = flow.spaceAfter;
    } else {
      // ── Text block: split lines across page boundaries ─────────────────────
      if ((globalThis as Record<string,unknown>).__LAYOUT_DEBUG__) {
        console.log(`  → SPLIT PATH entered (${flow.lines.length} lines total)`);
      }
      let remainingLines = flow.lines;
      let hasPlacedAnyPart = false;
      let markerPlaced = false;
      let currentPartStartY = targetY;
      let fragmentIdx = 0;
      while (remainingLines.length > 0) {
        const partStartY = currentPartStartY;
        // Per-page metrics snapshot for THIS iteration of the split loop.
        // Re-fetched on every pass because the page may have advanced via
        // the "advance to next" branch below.
        const splitMetrics = metricsFor(currentPage.pageNumber);
        const pageAvailable = splitMetrics.contentBottom - partStartY;

        const fitResult = fitLinesInCapacity(remainingLines, pageAvailable);
        let linesFit = fitResult.fitted.length;

        if ((globalThis as Record<string,unknown>).__LAYOUT_DEBUG__) {
          console.log(
            `    split iter: page=${currentPage.pageNumber} partStartY=${partStartY.toFixed(1)}` +
            ` pageAvailable=${pageAvailable.toFixed(1)} linesFit=${linesFit}` +
            ` remaining=${remainingLines.length} hasPlacedAnyPart=${hasPlacedAnyPart}` +
            ` firstLineH=${remainingLines[0]!.lineHeight.toFixed(1)}`
          );
        }

        if (linesFit === 0) {
          if (
            hasPlacedAnyPart ||
            partStartY === splitMetrics.contentTop ||
            lineFitsAt(splitMetrics.contentBottom, partStartY, remainingLines[0]?.lineHeight ?? 0)
          ) {
            // Force one line: top-of-page guard or sub-pixel shortfall.
            if ((globalThis as Record<string,unknown>).__LAYOUT_DEBUG__) {
              console.log(`    → linesFit=0 FORCE 1 line (top-of-page / sub-pixel guard)`);
            }
            linesFit = 1;
          } else {
            // The gap is kept, as Word keeps it: no room after it means the next page.
            if ((globalThis as Record<string,unknown>).__LAYOUT_DEBUG__) {
              console.log(`    → linesFit=0 ADVANCE to page ${pages.length + 2}`);
            }
            pages.push(currentPage);
            currentPage = newPage(pages.length + 1);
            metrics.push(metricsFor(currentPage.pageNumber));
            prevSpaceAfter = 0;
            currentPartStartY = metricsFor(currentPage.pageNumber).contentTop;
            continue;
          }
        }

        const isLastPart = linesFit >= remainingLines.length;
        const isCont = hasPlacedAnyPart;
        const partLines = remainingLines.slice(0, linesFit);
        const partHeight = partLines.reduce((sum, line) => sum + line.lineHeight, 0);

        const partBlock: LayoutBlock = {
          // Split path only runs for flows with rendered lines, so every part
          // is a text-kind continuation of its source block.
          kind: "text",
          node,
          nodePos,
          x: blockX,
          y: partStartY,
          width: blockWidth,
          height: partHeight,
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

        // The marker goes on the first part with a line it can stand on: a
        // part holding only a full-width image's gap passes it on.
        if (!markerPlaced && partLines.some((line) => !isSpacerLine(line))) {
          Object.assign(partBlock, markerFields(flow));
          markerPlaced = true;
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
          y = partStartY + partHeight;
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

    // This block landed where it did last run and everything after it is
    // unchanged, so the rest of the last layout holds.
    const canUsePreviousLayoutTail = !flow.solverPushedThisFlow && flow.wrapLaidAtY === undefined;
    if (
      tail &&
      canUsePreviousLayoutTail &&
      seenCacheMiss &&
      remainingCacheMisses === 0 &&
      nodePos >= tail.fromPos &&
      flow.wasCacheHit &&
      flow.preCachedTargetY !== undefined &&
      flow.preCachedPage !== undefined &&
      flow.preCachedRunId !== undefined &&
      flow.preCachedContentTop !== undefined &&
      targetY === flow.preCachedTargetY &&
      currentPage.pageNumber === flow.preCachedPage &&
      tail.layout.runId !== undefined &&
      flow.preCachedRunId === tail.layout.runId &&
      flow.preCachedContentTop === currentMetrics.contentTop
    ) {
      const prevPages = tail.layout.pages;
      const curPageIdx = currentPage.pageNumber - 1;

      if (curPageIdx < prevPages.length) {
        const prevCurPage = prevPages[curPageIdx]!;
        // The cache keeps one placement per node, so a node the document holds
        // twice can answer for its other place: the block itself has to match.
        const triggerIdx = prevCurPage.blocks.findIndex(
          (b) => b.nodePos === nodePos - tail.shift && b.y === currentPage.blocks.at(-1)?.y,
        );

        if (triggerIdx >= 0) {
          for (let bi = triggerIdx + 1; bi < prevCurPage.blocks.length; bi++) {
            currentPage.blocks.push(shiftBlock(prevCurPage.blocks[bi]!, tail.shift));
          }
          // currentPage pushed into pages — its metrics entry is already the
          // trailing one, now aligned 1:1 with pages.
          pages.push(currentPage);

          for (let pi = curPageIdx + 1; pi < prevPages.length; pi++) {
            const prevPage = prevPages[pi]!;
            pages.push({
              pageNumber: prevPage.pageNumber,
              blocks: prevPage.blocks.map((b) => shiftBlock(b, tail.shift)),
            });
            metrics.push(metricsFor(prevPage.pageNumber));
          }

          const last = pages.at(-1)?.blocks.at(-1);
          if (last) y = last.y + last.height;
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
 * @param startIndex First item to process.
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

function blockHasAnchoredObject(lines: LayoutLine[]): boolean {
  for (const line of lines) {
    for (const span of line.spans) {
      if (span.kind !== "object" || span.width !== 0) continue;
      if (floats(span.node)) return true;
    }
  }
  return false;
}


/**
 * Whether a cached measurement still describes a block: the same width, and
 * the same marker at the same indent — a marker draws on its block and can
 * move its first line. A changed marker is a miss, so a layout that reuses the
 * tail of the previous one never shows an old one.
 */
function isCacheHitFor(entry: MeasureCacheEntry, blockWidth: number, marker: MarkerPlacement | undefined): boolean {
  const cached = entry.marker;
  return entry.availableWidth === blockWidth
    && cached?.marker.painter === marker?.marker.painter
    && cached?.marker.data === marker?.marker.data
    && cached?.hanging === marker?.hanging
    && cached?.indentLeft === marker?.indentLeft;
}

export function buildBlockFlow(
  items: LayoutItem[],
  startIndex: number,
  config: FlowConfig,
  ctx: MeasureContext,
  maxBlocks?: number,
): { flows: FlowBlock[]; reachedCutoff: boolean; cutoffIndex: number } {
  const { fontConfig, measurer, fontModifiers, measureCache, inlineRegistry } = ctx;
  const flows: FlowBlock[] = [];
  let processedBlocks = 0;

  for (let itemIdx = startIndex; itemIdx < items.length; itemIdx++) {
    const item = items[itemIdx]!;

    if (item.boundary) {
      // A continuous section boundary does not move the flow, so it is not a
      // flow of its own: the next block collapses its margin against the last.
      const pageStart = pageStartPast(item.boundary);
      if (pageStart === null) continue;
      flows.push({
        node: item.node,
        nodePos: item.nodePos,
        kind: "leaf",
        lines: [],
        height: 0,
        spaceBefore: 0,
        spaceAfter: 0,
        availableWidth: 0,
        blockType: item.node.type.name,
        align: "left",
        indentLeft: 0,
        hasAnchoredObject: false,
        inputHash: 0,
        pageStart,
        wasCacheHit: false,
      });
      continue;
    }

    // ── Streaming cutoff ─────────────────────────────────────────────────────
    if (maxBlocks !== undefined && processedBlocks >= maxBlocks) {
      return { flows, reachedCutoff: true, cutoffIndex: itemIdx };
    }

    const { node, nodePos } = item;
    const resolved = resolveItem(item, { x: config.margins.left, width: config.contentWidth }, fontConfig);
    const { indentLeft, marker, x: blockX, width: blockWidth } = resolved;

    // Read before resolveBlockEntry may update it.
    const preCached = measureCache?.get(node);
    const isHit = preCached !== undefined && isCacheHitFor(preCached, blockWidth, marker);

    // Measure — position-independent (targetY=0, page=1 are not stored in entry).
    const entry = resolveBlockEntry(
      node, nodePos, blockX, 0, blockWidth, 1, ctx, item.unit, marker,
    );
    const spacing = itemSpacing(resolved, entry);

    flows.push({
      node,
      nodePos,
      kind: entry.kind,
      lines: entry.lines,
      ...(entry.regions ? { regions: entry.regions, unitData: entry.unitData } : {}),
      ...(item.lastUnit ? { lastUnit: true } : {}),
      height: entry.height,
      spaceBefore: spacing.spaceBefore,
      spaceAfter: spacing.spaceAfter,
      availableWidth: blockWidth,
      blockType: entry.blockType,
      align: entry.align,
      ...(marker ? { marker: laidMarkerOf(marker, blockX, entry.markerFace) } : {}),
      ...(entry.markerLine ? { markerLine: entry.markerLine } : {}),
      indentLeft,
      hasAnchoredObject: blockHasAnchoredObject(entry.lines),
      inputHash: computeInputHash(nodePos, node, blockWidth),
      wasCacheHit: isHit,
      ...(preCached?.placedTargetY    !== undefined ? { preCachedTargetY:    preCached.placedTargetY    } : {}),
      ...(preCached?.placedPage        !== undefined ? { preCachedPage:       preCached.placedPage       } : {}),
      ...(preCached?.placedRunId       !== undefined ? { preCachedRunId:      preCached.placedRunId      } : {}),
      ...(preCached?.placedContentTop  !== undefined ? { preCachedContentTop: preCached.placedContentTop } : {}),
    });

    processedBlocks++;
  }

  return { flows, reachedCutoff: false, cutoffIndex: items.length };
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function newPage(pageNumber: number): LayoutPage {
  return { pageNumber, blocks: [] };
}

/** Lines whose block moved by `delta` in the document, at their new positions. */
function shiftLines(lines: readonly LayoutLine[], delta: number): LayoutLine[] {
  return lines.map((line) => ({
    ...line,
    spans: line.spans.map((span) => ({ ...span, docPos: span.docPos + delta })),
    ...(line.terminalBreakDocPos !== undefined ? { terminalBreakDocPos: line.terminalBreakDocPos + delta } : {}),
  }));
}

/**
 * A block of the reused tail, moved to its new document position. The measure
 * cache is left alone: measuring already moved its entry, and moving it again
 * would drift.
 */
function shiftBlock(block: LayoutBlock, delta: number): LayoutBlock {
  if (delta === 0) return block;

  return {
    ...block,
    nodePos: block.nodePos + delta,
    ...(block.sourceNodePos !== undefined ? { sourceNodePos: block.sourceNodePos + delta } : {}),
    lines: shiftLines(block.lines, delta),
  };
}

/** A flow's marker, as the block that carries its first line takes it. */
function markerFields(flow: FlowBlock): Pick<LayoutBlock, "marker"> {
  return flow.marker ? { marker: flow.marker } : {};
}

/**
 * Returns a `MeasureCacheEntry` for the given node, either from the cache or
 * by calling `layoutBlock` once and writing the result back.
 *
 * Centralises all cache read/write logic so the main layout loop stays clean.
 *
 * LayoutLine x-coordinates are relative to the line origin — position-independent.
 * However, the document positions in a line are absolute. Because ProseMirror's
 * structural sharing keeps the same Node reference for unchanged blocks even when
 * text is inserted/deleted before them, a cached entry's positions can become
 * stale. We fix this by storing the nodePos at measure-time and moving the lines'
 * positions by the delta on every cache hit.
 */
function resolveBlockEntry(
  node: Node,
  nodePos: number,
  blockX: number,
  targetY: number,
  blockWidth: number,
  pageNumber: number,
  ctx: MeasureContext,
  unit?: { composite: CompositeLayout; unit: CompositeUnit },
  marker?: MarkerPlacement,
): MeasureCacheEntry {
  const { measurer, fontConfig, fontModifiers, measureCache, inlineRegistry, fonts } = ctx;
  // Composite units bypass the measure cache: their regions carry child-block
  // span docPos values that the cache-hit delta-adjustment path does not
  // rewrite, so re-measuring fresh each run keeps region hit-testing correct.
  if (unit) {
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
      ...(fonts ? { fonts } : {}),
      unit,
    });
    return {
      availableWidth: blockWidth,
      nodePos,
      kind: measured.kind,
      height: measured.height,
      lines: measured.lines,
      ...(measured.regions ? { regions: measured.regions, unitData: measured.unitData } : {}),
      spaceBefore: measured.spaceBefore,
      spaceAfter: measured.spaceAfter,
      blockType: measured.blockType,
      align: measured.align,
    };
  }

  const cached = measureCache?.get(node);
  if (cached && isCacheHitFor(cached, blockWidth, marker)) {
    const delta = nodePos - cached.nodePos;
    if (!delta) return cached;

    const adjustedLines = shiftLines(cached.lines, delta);
    const updated: MeasureCacheEntry = { ...cached, nodePos, lines: adjustedLines };
    measureCache!.set(node, updated);
    return updated;
  }

  // Cache miss — measure and populate. map is intentionally omitted:
  // CharacterMap population is deferred to Editor.ensurePagePopulated().
  const { block: measured, markerLine } = measureWithMarker(node, {
    nodePos,
    x: blockX,
    y: targetY,
    availableWidth: blockWidth,
    page: pageNumber,
    measurer,
    fontConfig,
    ...(fontModifiers ? { fontModifiers } : {}),
    ...(inlineRegistry ? { inlineRegistry } : {}),
    ...(fonts ? { fonts } : {}),
  }, marker);

  const entry: MeasureCacheEntry = {
    availableWidth: blockWidth,
    nodePos,
    kind: measured.kind,
    height: measured.height,
    lines: measured.lines,
    spaceBefore: measured.spaceBefore,
    spaceAfter: measured.spaceAfter,
    blockType: measured.blockType,
    align: measured.align,
    ...(marker ? { marker } : {}),
    ...(markerLine ? { markerLine } : {}),
    ...(measured.marker?.face ? { markerFace: measured.marker.face } : {}),
  };
  measureCache?.set(node, entry);
  return entry;
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
