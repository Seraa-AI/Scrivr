import { Node } from "prosemirror-model";
import type { FontModifier } from "../extensions/types";
import { TextMeasurer, type TextMeasurerLike } from "./TextMeasurer";
import {
  FontConfig,
  defaultFontConfig,
  DEFAULT_FONT_FAMILY,
  getBlockStyle,
  BlockStyle,
  applyPageFont,
} from "./FontConfig";
import { layoutBlock, LayoutBlock, type LayoutBlockKind, type CellSubBlock } from "./BlockLayout";
import type { InlineRegistry } from "./BlockRegistry";
import { LineBreaker, type InputSpan, type LayoutLine, type LineSpaceProvider } from "./LineBreaker";
import { ExclusionManager } from "./ExclusionManager";
import {
  ANCHORED_OBJECT_MARGIN,
  normalizeImageAttrs,
  resolveImageX,
  type AnchoredObjectPlacement,
  type WrapMode,
  type NormalizedImageAttrs,
} from "./AnchoredObjects";
import {
  computePageMetrics,
  EMPTY_RESOLVED_CHROME,
  pageStartGlobalForMetrics,
  type PageMetrics,
  type ResolvedChrome,
  type PageChromeContribution,
  type PageChromeMeasureInput,
} from "./PageMetrics";
import { fitLinesInCapacity } from "./splitLines";
import { runChromeLoop } from "./aggregateChrome";
import { parseFont } from "./StyleResolver";

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
  /** Mirrors `LayoutBlock.kind` so consumers can route without re-measuring. */
  kind: LayoutBlockKind;
  height: number;
  lines: LayoutLine[];
  /** Cell sub-blocks for `kind: "tableRow"` entries. */
  cells?: CellSubBlock[];
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
  /**
   * Mirrors `LayoutBlock.kind` so the pagination loop and exclusion reflow can
   * route on the discriminator instead of probing `lines.length`. Page-break
   * markers are tagged `"leaf"` (no inline content of their own).
   */
  kind: LayoutBlockKind;
  /** Measured lines — position-independent (lineHeight only, no absolute Y). */
  lines: LayoutLine[];
  /** Cell sub-blocks for `kind: "tableRow"` flows (y relative to the row top). */
  cells?: CellSubBlock[];
  /** True for a table's last row — drives table bottom-border ownership. */
  isLastRow?: boolean;
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
  /** True if any line span is a zero-width anchored-object anchor. */
  hasAnchoredObject: boolean;
  /** djb2 hash of nodePos + textContent + availableWidth for incremental re-layout. */
  inputHash: number;
  /** True when this entry represents a hard page break node. */
  isPageBreak?: true;
  /** True when the block measurement was a cache hit. */
  wasCacheHit: boolean;
  partKind?: "block" | "fragment";
  /** Continuous document-flow Y before page projection. */
  globalY?: number;
  /** Initial continuous Y before anchored-object solver pushes. */
  originalGlobalY?: number;
  /** True when Stage 3 intentionally moved this flow's globalY. */
  solverPushedThisFlow?: boolean;
  /** True when this flow's Y range intersected a Stage 3 square wrap zone. */
  overlapsWrapZone?: boolean;
  /** Page whose anchored-object exclusion constraints were applied to this flow. */
  wrapZonePage?: number;
  // Phase 1b: cache snapshot taken before this run's measurement.
  preCachedTargetY?: number;
  preCachedPage?: number;
  /** Cached placedRunId snapshot for early-termination guard. */
  preCachedRunId?: number;
  /** Cached placedContentTop snapshot for early-termination guard. */
  preCachedContentTop?: number;
  prevNodePos?: number;
}

/**
 * Global Y of the start of the first page strictly below `y`. A content bottom
 * exactly on a page boundary belongs to the page above (it rendered there), so
 * the break advances one page past it — matching `paginateFlow`, which always
 * advances exactly one page per forced break.
 */
function nextPageStartAfter(
  pageConfig: PageConfig,
  metricsFor: (pageNumber: number) => PageMetrics,
  y: number,
): number {
  let contentPage = pageForGlobalY(pageConfig, metricsFor, y);
  if (contentPage > 1 && pageStartGlobalForMetrics(pageConfig, metricsFor, contentPage) === y) {
    contentPage -= 1;
  }
  return pageStartGlobalForMetrics(pageConfig, metricsFor, contentPage + 1);
}

/**
 * Advance a flow's continuous start through to its true end `globalY`, modelling
 * the gaps `paginateFlow` introduces at page bottoms so Stage 2's coordinates
 * match Stage 4's. A line is atomic: one that would cross the page bottom moves
 * whole to the next page, leaving an unused gap that a naive `start + height`
 * ignores. Without this, an anchored object whose anchor sits after a paragraph
 * that splits across a page boundary is placed on an earlier page than the
 * paragraph's tail — and overlaps it.
 *
 * Uses the same `fitLinesInCapacity` primitive as `paginateFlow` so the
 * line-fit decision can't diverge. Returns the (possibly page-advanced) start
 * and the gap-aware end.
 */
function advanceFlowGlobalY(
  flow: FlowBlock,
  naturalStart: number,
  pageConfig: PageConfig,
  metricsFor: (pageNumber: number) => PageMetrics,
): { startGlobalY: number; endGlobalY: number } {
  if (flow.isPageBreak && !pageConfig.pageless) {
    const start = nextPageStartAfter(pageConfig, metricsFor, naturalStart);
    return { startGlobalY: start, endGlobalY: start + flow.height };
  }
  if (pageConfig.pageless) {
    return { startGlobalY: naturalStart, endGlobalY: naturalStart + flow.height };
  }

  const pageOf = (g: number): number => pageForGlobalY(pageConfig, metricsFor, g);
  const pageStart = (p: number): number => pageStartGlobalForMetrics(pageConfig, metricsFor, p);
  const pageBottom = (p: number): number => pageStart(p) + metricsFor(p).contentHeight;

  // Atomic blocks (image / hr / tableRow) never split: if the block overflows
  // its page and fits on a fresh one, it moves whole (the gap). `paginateFlow`
  // keeps a too-tall block or a first-on-page block where it is.
  const isAtomic = flow.kind === "leaf" || flow.kind === "tableRow";
  if (isAtomic || flow.lines.length === 0) {
    let start = naturalStart;
    const page = pageOf(start);
    const atTop = start === pageStart(page);
    const tooTall = flow.height > metricsFor(page).contentHeight;
    if (!atTop && !tooTall && start + flow.height > pageBottom(page)) {
      start = pageStart(page + 1);
    }
    return { startGlobalY: start, endGlobalY: start + flow.height };
  }

  // Text blocks: place lines page by page; the remainder jumps to the next page
  // top whenever a line would cross the bottom.
  let remaining = flow.lines;
  let cursor = naturalStart;
  while (remaining.length > 0) {
    const page = pageOf(cursor);
    const top = pageStart(page);
    const available = pageBottom(page) - cursor;
    let { fitted, rest, fittedHeight } = fitLinesInCapacity(remaining, available);
    if (fitted.length === 0) {
      if (cursor === top) {
        // A line taller than the page — force one to avoid an infinite loop
        // (mirrors paginateFlow's top-of-page guard).
        fitted = remaining.slice(0, 1);
        rest = remaining.slice(1);
        fittedHeight = remaining[0]!.lineHeight;
      } else {
        cursor = pageStart(page + 1);
        continue;
      }
    }
    cursor += fittedHeight;
    remaining = rest;
    if (remaining.length > 0) cursor = pageStart(page + 1);
  }
  return { startGlobalY: naturalStart, endGlobalY: cursor };
}

export function assignGlobalY(
  flows: FlowBlock[],
  initialY: number,
  pageConfig: PageConfig,
  metricsFor: (pageNumber: number) => PageMetrics,
): FlowBlock[] {
  let y = initialY;
  let prevSpaceAfter = 0;

  return flows.map((flow, index) => {
    const gap = index === 0 ? 0 : collapseMargins(prevSpaceAfter, flow.spaceBefore);
    const { startGlobalY, endGlobalY } = advanceFlowGlobalY(
      flow, y + gap, pageConfig, metricsFor,
    );
    y = endGlobalY;
    prevSpaceAfter = flow.isPageBreak ? 0 : flow.spaceAfter;
    return { ...flow, globalY: startGlobalY, originalGlobalY: startGlobalY };
  });
}

function restampGlobalYFrom(
  flows: FlowBlock[],
  startIndex: number,
  pageConfig: PageConfig,
  metricsFor: (pageNumber: number) => PageMetrics,
): FlowBlock[] {
  const next = [...flows];
  for (let i = Math.max(1, startIndex); i < next.length; i++) {
    const prev = next[i - 1]!;
    const flow = next[i]!;
    const prevEnd = advanceFlowGlobalY(
      prev, prev.globalY ?? 0, pageConfig, metricsFor,
    ).endGlobalY;
    const gap = prev.isPageBreak ? 0 : collapseMargins(prev.spaceAfter, flow.spaceBefore);
    const { startGlobalY } = advanceFlowGlobalY(
      flow, prevEnd + gap, pageConfig, metricsFor,
    );
    next[i] = { ...flow, globalY: startGlobalY };
  }
  return next;
}

interface AnchorRef {
  docPos: number;
  node: Node;
  attrs: NormalizedImageAttrs;
}

function getAnchoredObjectAnchors(flow: FlowBlock): AnchorRef[] {
  const anchors: AnchorRef[] = [];
  for (const line of flow.lines) {
    for (const span of line.spans) {
      if (span.kind !== "object" || span.width !== 0) continue;
      const attrs = normalizeImageAttrs(span.node);
      if (attrs.wrapMode === "inline") continue;
      anchors.push({ docPos: span.docPos, node: span.node, attrs });
    }
  }
  return anchors;
}

function pageForGlobalY(pageConfig: PageConfig, metricsFor: (pageNumber: number) => PageMetrics, globalY: number): number {
  if (pageConfig.pageless) return 1;
  let pageNumber = 1;
  while (globalY >= pageStartGlobalForMetrics(pageConfig, metricsFor, pageNumber) + metricsFor(pageNumber).contentHeight) {
    pageNumber++;
  }
  return pageNumber;
}

function pageLocalYForGlobalY(
  pageConfig: PageConfig,
  metricsFor: (pageNumber: number) => PageMetrics,
  pageNumber: number,
  globalY: number,
): number {
  const pageStart = pageStartGlobalForMetrics(pageConfig, metricsFor, pageNumber);
  return metricsFor(pageNumber).contentTop + (globalY - pageStart);
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
 * Applied only to the **final** (non-partial) layout. Partial layouts feed
 * the next streaming chunk and must keep raw page indices so a placement
 * that lands on page 4 today survives a chunk-2 layout pass that grows the
 * page list back to 4 pages — clamping a partial would lose that.
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

function pageRectsDigest(rects: readonly AnchoredObjectPlacement[] | undefined): string {
  if (!rects || rects.length === 0) return "";
  return rects
    .map((r) => `${r.page}:${r.x}:${r.x + r.width}:${r.y}:${r.y + r.height}:${r.wrapMode}:${r.docPos}`)
    .sort()
    .join("|");
}

interface PageBarrierProvider {
  pageForGlobalY(globalY: number): number;
  pageStartGlobal(pageNumber: number): number;
  contentBottomLocal(pageNumber: number): number;
  contentHeight(pageNumber: number): number;
  localYForGlobalY(pageNumber: number, globalY: number): number;
}

function createPageBarrierProvider(
  pageConfig: PageConfig,
  metricsFor: (pageNumber: number) => PageMetrics,
): PageBarrierProvider {
  const pageStartCache = new Map<number, number>();
  pageStartCache.set(1, metricsFor(1).contentTop);

  const pageStartFor = (pageNumber: number): number => {
    if (pageConfig.pageless) return metricsFor(1).contentTop;
    const cached = pageStartCache.get(pageNumber);
    if (cached !== undefined) return cached;

    let nearestPage = 1;
    for (const page of pageStartCache.keys()) {
      if (page < pageNumber && page > nearestPage) nearestPage = page;
    }

    let y = pageStartCache.get(nearestPage)!;
    for (let page = nearestPage; page < pageNumber; page++) {
      y += metricsFor(page).contentHeight;
      pageStartCache.set(page + 1, y);
    }
    return y;
  };

  return {
    pageForGlobalY(globalY: number): number {
      if (pageConfig.pageless) return 1;
      let pageNumber = 1;
      while (globalY >= pageStartFor(pageNumber) + metricsFor(pageNumber).contentHeight) {
        pageNumber++;
      }
      return pageNumber;
    },
    pageStartGlobal: pageStartFor,
    contentBottomLocal(pageNumber: number): number {
      return metricsFor(pageNumber).contentBottom;
    },
    contentHeight(pageNumber: number): number {
      return metricsFor(pageNumber).contentHeight;
    },
    localYForGlobalY(pageNumber: number, globalY: number): number {
      return metricsFor(pageNumber).contentTop + (globalY - pageStartFor(pageNumber));
    },
  };
}

function resolveAnchoredObjects(
  inputFlows: FlowBlock[],
  pageConfig: PageConfig,
  metricsFor: (pageNumber: number) => PageMetrics,
  measurer: TextMeasurerLike,
  fontConfig: FontConfig,
  fontModifiers: Map<string, FontModifier> | undefined,
  inlineRegistry?: InlineRegistry,
): { flows: FlowBlock[]; placements: AnchoredObjectPlacement[] } {
  let flows = inputFlows;
  const placements: AnchoredObjectPlacement[] = [];
  const contentX = pageConfig.margins.left;
  const contentRight = pageConfig.pageWidth - pageConfig.margins.right;
  const contentWidth = contentRight - contentX;
  const barriers = createPageBarrierProvider(pageConfig, metricsFor);
  // Phase 4: one ExclusionManager per page, accumulating every square rect.
  // Sequential anchors share the same manager so a flow that overlaps two
  // images on the same page reflows against the union of both rects rather
  // than one at a time (which lost the prior rect's segments).
  const exclusionsByPage = new Map<number, ExclusionManager>();

  for (let i = 0; i < flows.length; i++) {
    const flow = flows[i]!;
    const anchors = getAnchoredObjectAnchors(flow);
    if (anchors.length === 0) continue;

    for (const anchor of anchors) {
      const attrs = anchor.attrs;
      const width = Math.min(attrs.width, contentWidth);
      const height = attrs.height;
      const wrapMode = attrs.wrapMode;
      const yOffset = attrs.yOffset;

      // anchorGlobalY: the anchor flow's globalY (post anchor-push / stacking).
      // paintedGlobalY: where the image actually paints (= anchor + yOffset, clamped).
      // Anchor-push and stacking operate on flow geometry (anchor); paint, exclusion,
      // and the clamp operate on the painted position. Phase 1 V1 invariant:
      // image.page === anchor.page (clamp pulls a runaway yOffset back onto the page).
      let anchorGlobalY = flows[i]!.globalY ?? 0;
      let pageNumber = barriers.pageForGlobalY(anchorGlobalY);
      let anchorLocalY = barriers.localYForGlobalY(pageNumber, anchorGlobalY);

      // Anchor-push: any wrapping mode whose visual extent overflows its
      // anchor's page is pushed to the next page (provided the next page
      // can fit it). This applies uniformly to square / top-bottom /
      // behind / front. yOffset is intentionally not factored in — the
      // anchor flow's natural fit decides the page; yOffset only shifts
      // within the resulting page (and clamps if it would escape).
      if (
        wrapMode !== "inline" &&
        !pageConfig.pageless &&
        anchorLocalY + height > barriers.contentBottomLocal(pageNumber) &&
        height <= barriers.contentHeight(pageNumber + 1)
      ) {
        const pushedGlobalY = barriers.pageStartGlobal(pageNumber + 1);
        flows = [
          ...flows.slice(0, i),
          { ...flows[i]!, globalY: pushedGlobalY, solverPushedThisFlow: true },
          ...flows.slice(i + 1),
        ];
        flows = restampGlobalYFrom(flows, i + 1, pageConfig, metricsFor);
        anchorGlobalY = pushedGlobalY;
        pageNumber = barriers.pageForGlobalY(anchorGlobalY);
        anchorLocalY = barriers.localYForGlobalY(pageNumber, anchorGlobalY);
      }

      // Resolve horizontal X — single expression for every non-inline mode.
      const x = resolveImageX(
        { width, xAlign: attrs.xAlign, x: attrs.x },
        contentX,
        contentWidth,
        pageConfig.pageWidth,
      );

      // Square stacking: detect overlap by *painted* rect (anchor + yOffset)
      // for both the new and prior placements. Stacking shifts the anchor
      // flow by the same delta as the painted target, preserving yOffset.
      if (wrapMode === "square") {
        const newPaintedGlobalY = anchorGlobalY + yOffset;
        let stackedPaintedGlobalY = newPaintedGlobalY;
        for (const placed of placements) {
          if (placed.wrapMode !== "square" || placed.page !== pageNumber) continue;
          const hOverlap = x < placed.x + placed.width && x + width > placed.x;
          const vOverlap =
            newPaintedGlobalY < placed.globalY + placed.height &&
            newPaintedGlobalY + height > placed.globalY;
          if (hOverlap && vOverlap) {
            const placedBottomGlobalY = placed.globalY + placed.height + ANCHORED_OBJECT_MARGIN;
            stackedPaintedGlobalY = Math.max(stackedPaintedGlobalY, placedBottomGlobalY);
          }
        }
        if (stackedPaintedGlobalY > newPaintedGlobalY) {
          const delta = stackedPaintedGlobalY - newPaintedGlobalY;
          const stackedAnchorGlobalY = anchorGlobalY + delta;
          flows = [
            ...flows.slice(0, i),
            { ...flows[i]!, globalY: stackedAnchorGlobalY, solverPushedThisFlow: true },
            ...flows.slice(i + 1),
          ];
          flows = restampGlobalYFrom(flows, i + 1, pageConfig, metricsFor);
          anchorGlobalY = stackedAnchorGlobalY;
          pageNumber = barriers.pageForGlobalY(anchorGlobalY);
          anchorLocalY = barriers.localYForGlobalY(pageNumber, anchorGlobalY);
        }
        // Re-check page fit after stacking (anchor-flow geometry, like above).
        if (
          !pageConfig.pageless &&
          anchorLocalY + height > barriers.contentBottomLocal(pageNumber) &&
          height <= barriers.contentHeight(pageNumber + 1)
        ) {
          const pushedGlobalY = barriers.pageStartGlobal(pageNumber + 1);
          flows = [
            ...flows.slice(0, i),
            { ...flows[i]!, globalY: pushedGlobalY, solverPushedThisFlow: true },
            ...flows.slice(i + 1),
          ];
          flows = restampGlobalYFrom(flows, i + 1, pageConfig, metricsFor);
          anchorGlobalY = pushedGlobalY;
          pageNumber = barriers.pageForGlobalY(anchorGlobalY);
          anchorLocalY = barriers.localYForGlobalY(pageNumber, anchorGlobalY);
        }
      }

      // Apply yOffset and clamp into the anchor's page so the image stays on
      // the same page as its anchor. `clamped` is surfaced on the placement
      // for Phase 2's drag overlay (visual stickiness at the boundary).
      const desiredGlobalY = anchorGlobalY + yOffset;
      let paintedGlobalY = desiredGlobalY;
      let clamped = false;
      if (!pageConfig.pageless) {
        const pageStart = barriers.pageStartGlobal(pageNumber);
        const pageEnd = pageStart + Math.max(0, barriers.contentHeight(pageNumber) - height);
        if (paintedGlobalY < pageStart) {
          paintedGlobalY = pageStart;
          clamped = paintedGlobalY !== desiredGlobalY;
        } else if (paintedGlobalY > pageEnd) {
          paintedGlobalY = pageEnd;
          clamped = paintedGlobalY !== desiredGlobalY;
        }
      }
      const paintedLocalY = barriers.localYForGlobalY(pageNumber, paintedGlobalY);

      placements.push({
        docPos: anchor.docPos,
        page: pageNumber,
        x,
        y: paintedLocalY,
        width,
        height,
        wrapMode,
        zIndex: attrs.zIndex,
        node: anchor.node,
        anchorGlobalY,
        anchorPage: pageNumber,
        globalY: paintedGlobalY,
        ...(clamped ? { clamped: true } : {}),
      });

      // Square: emit a wrap zone constraint at the *painted* rectangle so
      // text wraps the image's actual position, not its anchor flow row.
      // Subsequent paragraphs that fall within the zone get their lines narrowed.
      // The rect is added to the page's shared ExclusionManager so the next
      // square anchor on this page reflows flows against the *union* of all
      // rects added so far — multi-image overlap on the same flow compounds
      // segments rather than overwriting each other.
      if (wrapMode === "square") {
        let exclusions = exclusionsByPage.get(pageNumber);
        if (!exclusions) {
          exclusions = new ExclusionManager();
          exclusionsByPage.set(pageNumber, exclusions);
        }
        const margin = attrs.margin;
        const pageStart = barriers.pageStartGlobal(pageNumber);
        const pageEnd = pageStart + barriers.contentHeight(pageNumber);
        const zoneTop = Math.max(pageStart, paintedGlobalY - margin);
        const zoneBottom = Math.min(pageEnd, paintedGlobalY + height + margin);
        exclusions.addRect({
          page: pageNumber,
          x: x - margin,
          right: x + width + margin,
          y: zoneTop,
          bottom: zoneBottom,
          side: "left",
          docPos: anchor.docPos,
        });
        flows = reflowFlowsAgainstExclusions(
          flows,
          exclusions,
          {
            pageNumber,
            zoneTop,
            zoneBottom,
            contentX,
            contentWidth,
          },
          pageConfig,
          metricsFor,
          measurer,
          fontConfig,
          fontModifiers,
          inlineRegistry,
        );
        continue;
      }

      // Top-bottom: reserve vertical flow through the same exclusion path as
      // square wrap. A full-width rect makes LineBreaker skip lines in this
      // Y band, so there is no separate synthetic FlowBlock for the image.
      if (wrapMode === "top-bottom") {
        let exclusions = exclusionsByPage.get(pageNumber);
        if (!exclusions) {
          exclusions = new ExclusionManager();
          exclusionsByPage.set(pageNumber, exclusions);
        }
        const margin = attrs.margin;
        const pageStart = barriers.pageStartGlobal(pageNumber);
        const pageEnd = pageStart + barriers.contentHeight(pageNumber);
        const zoneTop = Math.max(pageStart, paintedGlobalY - margin);
        const zoneBottom = Math.min(pageEnd, paintedGlobalY + height + margin);
        exclusions.addFullWidthRect({
          page: pageNumber,
          y: zoneTop,
          bottom: zoneBottom,
          contentX,
          contentWidth,
          docPos: anchor.docPos,
        });
        flows = reflowFlowsAgainstExclusions(
          flows,
          exclusions,
          {
            pageNumber,
            zoneTop,
            zoneBottom,
            contentX,
            contentWidth,
          },
          pageConfig,
          metricsFor,
          measurer,
          fontConfig,
          fontModifiers,
          inlineRegistry,
        );
      }
    }
  }

  return { flows, placements };
}

/**
 * Reflow every flow whose Y range intersects the latest exclusion zone.
 *
 * This deliberately does not start at the anchor flow index. `yOffset` makes
 * the painted rectangle independent from anchor order, so an image anchored
 * in paragraph B can exclude text in paragraph A. The Y-range checks below
 * are the only gate: docPos owns the object, geometry drives wrapping.
 */
function reflowFlowsAgainstExclusions(
  inputFlows: FlowBlock[],
  exclusions: ExclusionManager,
  zone: {
    pageNumber: number;
    zoneTop: number;
    zoneBottom: number;
    contentX: number;
    contentWidth: number;
  },
  pageConfig: PageConfig,
  metricsFor: (pageNumber: number) => PageMetrics,
  measurer: TextMeasurerLike,
  fontConfig: FontConfig,
  fontModifiers: Map<string, FontModifier> | undefined,
  inlineRegistry?: InlineRegistry,
): FlowBlock[] {
  let flows = inputFlows;
  const zoneTop = zone.zoneTop;
  const zoneBottom = zone.zoneBottom;

  for (let idx = 0; idx < flows.length; idx++) {
    const flow = flows[idx]!;
    const flowY = flow.globalY ?? 0;
    if (flowY >= zoneBottom) break;
    // Skip atomic flows (image/HR/pageBreak/tableRow) — exclusion reflow only
    // narrows text flow lines; atomic blocks can never be re-broken around a
    // wrap zone.
    if (flow.kind === "leaf" || flow.kind === "tableRow" || flowY + flow.height <= zoneTop) continue;

    const wrappedFlow: FlowBlock = {
      ...flow,
      overlapsWrapZone: true,
      wrapZonePage: zone.pageNumber,
    };

    const blockContentX = zone.contentX + flow.indentLeft;
    const lineSpaceProvider: LineSpaceProvider = (absoluteLineY: number, lineHeight = 1) => {
      const space = exclusions.getAvailableSegments(
        zone.pageNumber,
        absoluteLineY,
        lineHeight,
        blockContentX,
        flow.availableWidth,
      );
      // ExclusionManager returns segments in the same coordinate space as
      // contentX (here: absolute page-local). LineSpaceProvider's contract
      // requires block-content-relative coords, so translate.
      const segments = space.segments.map((s) => ({
        x: s.x - blockContentX,
        width: s.width,
      }));
      // Square wrap with a single full-width-ish image can punch all segments
      // out without side="full". Fall back to zoneBottom so the line breaker
      // advances past the image instead of dropping words.
      if (segments.length === 0 && space.skipToY === undefined) {
        return { segments, skipToY: zoneBottom };
      }
      return space.skipToY !== undefined
        ? { segments, skipToY: space.skipToY }
        : { segments };
    };

    const reflowed = layoutBlock(flow.node, {
      nodePos: flow.nodePos,
      x: blockContentX,
      y: flowY,
      availableWidth: flow.availableWidth,
      page: zone.pageNumber,
      measurer,
      fontConfig,
      ...(fontModifiers ? { fontModifiers } : {}),
      lineSpaceProvider,
      ...(inlineRegistry ? { inlineRegistry } : {}),
    });

    const nextFlow: FlowBlock = {
      ...wrappedFlow,
      lines: reflowed.lines,
      height: reflowed.height,
      blockType: reflowed.blockType,
      align: reflowed.align,
      availableWidth: reflowed.availableWidth,
    };

    if (nextFlow.height !== flow.height || nextFlow.lines !== flow.lines) {
      flows = [
        ...flows.slice(0, idx),
        nextFlow,
        ...flows.slice(idx + 1),
      ];
      flows = restampGlobalYFrom(flows, idx + 1, pageConfig, metricsFor);
    } else if (!flow.overlapsWrapZone) {
      flows = [
        ...flows.slice(0, idx),
        wrappedFlow,
        ...flows.slice(idx + 1),
      ];
    }
  }

  return flows;
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

  // Stage 2: assign continuous flow coordinates and resolve anchored objects.
  // For resumed chunks, seed globalY at the resumption cursor's continuous
  // position (= start of currentPage in continuous global-Y space + the page-
  // local Y the prior chunk left off at). Without this, anchors in a later
  // chunk would resolve as if the chunk's flows started near the document's
  // top — wrong page assignment, wrong wrap decisions.
  const seedGlobalY = r
    ? pageStartGlobalForMetrics(pageConfig, metricsFor, currentPage.pageNumber)
      + (initY - metricsFor(currentPage.pageNumber).contentTop)
    : metricsFor(1).contentTop;
  const flowsWithGlobalY = assignGlobalY(flowResult.flows, seedGlobalY, pageConfig, metricsFor);
  const anchoredFlow = resolveAnchoredObjects(
    flowsWithGlobalY,
    pageConfig,
    metricsFor,
    measurer,
    fontConfig,
    fontModifiers,
    options.inlineRegistry,
  );

  // Merge anchored placements from prior streamed chunks with the current
  // chunk's placements. Without this, resumed layouts overwrite the
  // accumulated anchoredObjects list — placements from earlier chunks
  // disappear from rendering, hit testing, and PDF export.
  const carriedPlacements = r
    ? (previousLayout?.anchoredObjects ?? []).filter(
        (p) => !anchoredFlow.placements.some((q) => q.docPos === p.docPos),
      )
    : [];
  const mergedPlacements = carriedPlacements.length > 0
    ? [...carriedPlacements, ...anchoredFlow.placements]
    : anchoredFlow.placements;
  const previousLayoutForPagination =
    pageRectsDigest(previousLayout?.anchoredObjects) === pageRectsDigest(mergedPlacements)
      ? previousLayout
      : undefined;

  const pr = paginateFlow(
    anchoredFlow.flows, pageConfig, resolved, metricsFor, runId,
    {
      previousLayout: previousLayoutForPagination,
      measureCache,
      measurer,
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
    // Intentionally NOT clamped: the partial layout's anchoredObjects gets
    // carried forward to the next chunk as `previousLayout?.anchoredObjects`,
    // and earlier chunks are never re-solved. Clamping a partial would
    // permanently lose a placement's original page — e.g. a placement on
    // page 4 clamped to partial-page count 2 cannot be restored when the
    // next chunk grows the layout back to 4 pages. View consumers reading
    // a partial layout may briefly see placement.page > pages.length during
    // streaming; that window is bounded by the next chunk arriving, and the
    // final non-partial layout below is clamped.
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
      anchoredObjects: mergedPlacements,
    };
    return { layout, isPartial: true, ...context, y: pr.y, anchoredObjects: mergedPlacements };
  }

  const allPages = pr.earlyTerminated ? pr.pages : [...pr.pages, pr.currentPage];
  const clampedFinal = clampPlacementsToPages(mergedPlacements, allPages.length);
  const layout: DocumentLayout = {
    pages: allPages,
    pageConfig,
    version: chunkVersion,
    totalContentHeight: 0,
    metrics: pr.metrics,
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
  const layoutWithChrome: DocumentLayout = {
    ...fp.layout,
    convergence: chromeResult.convergence,
    iterationCount: chromeResult.iterationCount,
    chromePayloads: chromeResult.chromePayloads,
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
  previousLayout?: DocumentLayout | undefined;
  measureCache?: WeakMap<Node, MeasureCacheEntry> | undefined;
  measurer?: TextMeasurerLike | undefined;
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

  const { previousLayout, measureCache, measurer = new TextMeasurer(), pageless, init } = opts;
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

    if (!pageless && flow.globalY !== undefined) {
      while (
        flow.globalY >=
        pageStartGlobalForMetrics(pageConfig, metricsFor, currentPage.pageNumber) +
          metricsFor(currentPage.pageNumber).contentHeight
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
        ? pageLocalYForGlobalY(pageConfig, metricsFor, currentPage.pageNumber, flow.globalY)
        : naturalY;
    const firstOnPageNatural = isFirstOnPage && !flow.solverPushedThisFlow;
    const targetY = firstOnPageNatural ? naturalY : Math.max(naturalY, pageLocalGlobalY);
    const blockX = margins.left + flow.indentLeft;
    const blockWidth = flow.availableWidth;

    // Build a positioned LayoutBlock from the FlowBlock measurements.
    // `tableRow` blocks carry their cell sub-blocks (y relative to the row top,
    // x absolute) so the invariant "kind === tableRow → cells present" holds.
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
      ...(flow.kind === "tableRow" ? { cells: flow.cells ?? [] } : {}),
      ...(flow.isLastRow ? { isLastRow: true } : {}),
    });

    const block = normalizeWrappedBlockForPage(
      buildBlock(blockX, targetY),
      flow,
      currentPage.pageNumber,
      measurer,
    );

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
    const blockBottom = targetY + block.height;
    const pageBottom = currentMetrics.contentBottom;
    const contentHeight = currentMetrics.contentHeight;
    // Text blocks can always be split; leaf and tableRow blocks need the
    // !isFirstOnPage guard to avoid infinite empty-page loops when the block
    // exceeds contentHeight (the "pathological row policy" — clip on next page).
    const isAtomicBlock = flow.kind === "leaf" || flow.kind === "tableRow";
    const overflows = !pageless && blockBottom > pageBottom && (!isFirstOnPage || !isAtomicBlock);

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
      // ── Leaf block (image, HR): move whole block to next page ──────────────
      const tooTallForAnyPage = flow.height > contentHeight;
      if (tooTallForAnyPage) {
        if ((globalThis as Record<string,unknown>).__LAYOUT_DEBUG__) {
          console.log(`  → LEAF too-tall: forced onto current page ${currentPage.pageNumber}`);
        }
        currentPage.blocks.push(block);
        y = targetY + block.height;
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

        const reflow = normalizeWrappedBlockForPage(
          buildBlock(blockX, newPageContentTop),
          flow,
          currentPage.pageNumber,
          measurer,
        );
        if (flow.listMarker !== undefined) {
          reflow.listMarker = flow.listMarker;
          reflow.listMarkerX = flow.listMarkerX!;
          reflow.blockType = "list_item";
        }

        currentPage.blocks.push(reflow);
        y = newPageContentTop + reflow.height;
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
        const rawPartLines = remainingLines.slice(0, linesFit);
        const partLines = shouldNormalizeWrappedLines(flow, currentPage.pageNumber, isCont)
          ? rebreakWrappedLinesWithoutExclusions(rawPartLines, blockWidth, measurer)
          : rawPartLines;
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

    // Early termination: copy downstream pages from previous run when
    // targetY, page, runId, and contentTop all match the cached placement.
    const canUsePreviousLayoutTail = !flow.solverPushedThisFlow && !flow.overlapsWrapZone;
    if (
      previousLayout &&
      canUsePreviousLayoutTail &&
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
      const prevPages = previousLayout.pages;
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

function blockHasAnchoredObject(lines: LayoutLine[]): boolean {
  for (const line of lines) {
    for (const span of line.spans) {
      if (span.kind !== "object" || span.width !== 0) continue;
      // Read through normalizeImageAttrs so both the canonical `wrapMode`
      // attr and the legacy `wrappingMode` shorthand are honoured. Reading
      // legacy alone misses nodes set via the new ImageMenu (which writes
      // `wrapMode: "square", wrappingMode: "inline"`).
      if (normalizeImageAttrs(span.node).wrapMode !== "inline") return true;
    }
  }
  return false;
}

function isAnchorOnlyFlowEntry(entry: Pick<MeasureCacheEntry, "kind" | "height" | "lines">): boolean {
  // Anchor-only flow is a text-kind paragraph whose only content is hidden
  // anchor sentinels — leaf blocks can never qualify, even when their height
  // happens to be zero.
  if (entry.kind !== "text" || entry.height !== 0) return false;
  return entry.lines.every((line) =>
    line.lineHeight === 0 &&
    line.cursorHeight === 0 &&
    line.spans.length > 0 &&
    line.spans.every((span) => span.kind === "object" && span.width === 0 && span.height === 0),
  );
}

export function buildBlockFlow(
  items: LayoutItem[],
  startIndex: number,
  config: FlowConfig,
  fontConfig: FontConfig,
  measurer: TextMeasurerLike,
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
        kind: "leaf",
        lines: [],
        height: 0,
        spaceBefore: 0,
        spaceAfter: 0,
        availableWidth: 0,
        blockType: "pageBreak",
        align: "left",
        indentLeft: 0,
        hasAnchoredObject: false,
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
      measurer, fontConfig, fontModifiers, measureCache, inlineRegistry, item.tableColumns,
    );
    const anchorOnlyFlow = isAnchorOnlyFlowEntry(entry);

    flows.push({
      node,
      nodePos,
      kind: entry.kind,
      lines: entry.lines,
      ...(entry.cells ? { cells: entry.cells } : {}),
      ...(item.isLastRow ? { isLastRow: true } : {}),
      height: entry.height,
      spaceBefore: anchorOnlyFlow ? 0 : blockStyle.spaceBefore,
      spaceAfter: anchorOnlyFlow ? 0 : blockStyle.spaceAfter,
      availableWidth: blockWidth,
      blockType: entry.blockType,
      align: entry.align,
      ...(listMarker !== undefined ? {
        listMarker,
        listMarkerX: blockX - MARKER_RIGHT_GAP,
      } : {}),
      indentLeft,
      hasAnchoredObject: blockHasAnchoredObject(entry.lines),
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

function rebreakWrappedLinesWithoutExclusions(
  lines: LayoutLine[],
  availableWidth: number,
  measurer: TextMeasurerLike,
): LayoutLine[] {
  const spans: InputSpan[] = [];

  for (const line of lines) {
    if (line.spans.length === 0 && line.cursorHeight === 0) continue;
    for (const span of line.spans) {
      if (span.kind === "text") {
        spans.push({
          kind: "text",
          text: span.text,
          font: span.font,
          docPos: span.docPos,
          ...(span.marks !== undefined ? { marks: span.marks } : {}),
        });
      } else {
        spans.push({
          kind: "object",
          node: span.node,
          width: span.width,
          height: span.height,
          docPos: span.docPos,
          verticalAlign: span.verticalAlign,
        });
      }
    }
    if (line.terminalBreakDocPos !== undefined) {
      spans.push({ kind: "break", docPos: line.terminalBreakDocPos });
    }
  }

  if (spans.length === 0) return [];
  const firstText = spans.find((span) => span.kind === "text");
  const parsed = parseFont(firstText?.font ?? `14px ${DEFAULT_FONT_FAMILY}`);
  return new LineBreaker(measurer).breakIntoLines(spans, availableWidth, {
    defaultFontFamily: parsed.family,
    defaultFontSize: parseFloat(parsed.size),
  });
}

function shouldNormalizeWrappedLines(
  flow: Pick<FlowBlock, "overlapsWrapZone" | "wrapZonePage">,
  pageNumber: number,
  isContinuation: boolean,
): boolean {
  if (!flow.overlapsWrapZone) return false;
  return isContinuation || flow.wrapZonePage !== pageNumber;
}

function normalizeWrappedBlockForPage(
  block: LayoutBlock,
  flow: Pick<FlowBlock, "overlapsWrapZone" | "wrapZonePage">,
  pageNumber: number,
  measurer: TextMeasurerLike,
): LayoutBlock {
  if (!shouldNormalizeWrappedLines(flow, pageNumber, false)) return block;

  const lines = rebreakWrappedLinesWithoutExclusions(block.lines, block.availableWidth, measurer);
  return {
    ...block,
    lines,
    height: lines.reduce((sum, line) => sum + line.lineHeight, 0),
  };
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
  /** Column widths (from the parent table's `grid`) — set on table row items. */
  tableColumns?: number[];
  /** True for a table's last row — drives table bottom-border ownership. */
  isLastRow?: boolean;
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

    if (node.type.name === "table") {
      // Tables expand into one item per row. Each row lays out as an atomic
      // (leaf-like) block in v1 — whole row moves to the next page on
      // overflow, no line-splitting across cells. Phase 4 replaces the
      // stub row layout with sandboxed per-cell layout.
      const gridAttr = node.attrs["grid"];
      const tableColumns = Array.isArray(gridAttr)
        ? gridAttr.filter((w): w is number => typeof w === "number" && Number.isFinite(w))
        : [];
      const lastRowIndex = node.childCount - 1;
      node.forEach((rowNode, rowOffset, rowIndex) => {
        const rowNodePos = offset + 1 + rowOffset;
        items.push({
          node: rowNode,
          nodePos: rowNodePos,
          indentLeft: 0,
          tableColumns,
          isLastRow: rowIndex === lastRowIndex,
        });
      });
      return;
    }

    const blockIndent = (node.attrs["indent"] as number) ?? 0;
    items.push({ node, nodePos: offset, indentLeft: blockIndent * LIST_INDENT });
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
  measurer: TextMeasurerLike,
  fontConfig: FontConfig,
  fontModifiers: Map<string, FontModifier> | undefined,
  measureCache: WeakMap<Node, MeasureCacheEntry> | undefined,
  inlineRegistry?: InlineRegistry,
  tableColumns?: number[],
): MeasureCacheEntry {
  // Table rows bypass the measure cache: their `cells` carry child-block span
  // docPos values that the cache-hit delta-adjustment path does not rewrite, so
  // re-measuring fresh each run keeps cell hit-testing correct. Tables are small
  // relative to body text, so this is cheap.
  if (node.type.name === "tableRow") {
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
      ...(tableColumns ? { tableColumns } : {}),
    });
    return {
      availableWidth: blockWidth,
      nodePos,
      kind: measured.kind,
      height: measured.height,
      lines: measured.lines,
      ...(measured.cells ? { cells: measured.cells } : {}),
      spaceBefore: measured.spaceBefore,
      spaceAfter: measured.spaceAfter,
      blockType: measured.blockType,
      align: measured.align,
    };
  }

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
    kind: measured.kind,
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
