import { Fragment, Node } from "prosemirror-model";
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
  /** True when this entry represents a hard page break node. */
  isPageBreak?: true;
  /** True when the block measurement was a cache hit. */
  wasCacheHit: boolean;
  partKind?: "block" | "fragment" | "anchored-object";
  anchoredObjectDocPos?: number;
  anchoredObjectNode?: Node;
  anchoredObjectMode?: string;
  /** Continuous document-flow Y before page projection. */
  globalY?: number;
  /** Initial continuous Y before anchored-object solver pushes. */
  originalGlobalY?: number;
  // Phase 1b: cache snapshot taken before this run's measurement.
  preCachedTargetY?: number;
  preCachedPage?: number;
  /** Cached placedRunId snapshot for early-termination guard. */
  preCachedRunId?: number;
  /** Cached placedContentTop snapshot for early-termination guard. */
  preCachedContentTop?: number;
  prevNodePos?: number;
}

export function assignGlobalY(flows: FlowBlock[], initialY: number): FlowBlock[] {
  let y = initialY;
  let prevSpaceAfter = 0;

  return flows.map((flow, index) => {
    const gap = index === 0 ? 0 : collapseMargins(prevSpaceAfter, flow.spaceBefore);
    const globalY = y + gap;
    y = globalY + flow.height;
    prevSpaceAfter = flow.spaceAfter;
    return { ...flow, globalY, originalGlobalY: globalY };
  });
}

function restampGlobalYFrom(flows: FlowBlock[], startIndex: number): FlowBlock[] {
  const next = [...flows];
  for (let i = Math.max(1, startIndex); i < next.length; i++) {
    const prev = next[i - 1]!;
    const flow = next[i]!;
    const prevGlobalY = prev.globalY ?? 0;
    const gap = collapseMargins(prev.spaceAfter, flow.spaceBefore);
    const globalY = prevGlobalY + prev.height + gap;
    next[i] = { ...flow, globalY };
  }
  return next;
}

interface AnchorRef {
  docPos: number;
  node: Node;
  attrs: NormalizedImageAttrs;
}

function getAnchoredObjectAnchors(flow: FlowBlock): AnchorRef[] {
  if (
    flow.partKind === "anchored-object" &&
    flow.anchoredObjectMode === "top-bottom" &&
    flow.anchoredObjectNode &&
    flow.anchoredObjectDocPos !== undefined
  ) {
    return [
      {
        docPos: flow.anchoredObjectDocPos,
        node: flow.anchoredObjectNode,
        attrs: normalizeImageAttrs(flow.anchoredObjectNode),
      },
    ];
  }
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

function topBottomImageInfo(node: Node, nodePos: number): {
  image: Node;
  imageDocPos: number;
  imageIndex: number;
  before: Node[];
  after: Node[];
} | null {
  let found: {
    image: Node;
    imageDocPos: number;
    imageIndex: number;
    before: Node[];
    after: Node[];
  } | null = null;
  const before: Node[] = [];
  const after: Node[] = [];

  node.forEach((child, offset, index) => {
    if (found) {
      after.push(child);
      return;
    }
    if (child.type.name === "image" && normalizeImageAttrs(child).wrapMode === "top-bottom") {
      found = {
        image: child,
        imageDocPos: nodePos + 1 + offset,
        imageIndex: index,
        before,
        after,
      };
      return;
    }
    before.push(child);
  });

  return found;
}

function pageStartGlobal(pageConfig: PageConfig, metricsFor: (pageNumber: number) => PageMetrics, pageNumber: number): number {
  if (pageConfig.pageless) return metricsFor(1).contentTop;
  let y = metricsFor(1).contentTop;
  for (let p = 1; p < pageNumber; p++) {
    y += metricsFor(p).contentHeight;
  }
  return y;
}

function pageForGlobalY(pageConfig: PageConfig, metricsFor: (pageNumber: number) => PageMetrics, globalY: number): number {
  if (pageConfig.pageless) return 1;
  let pageNumber = 1;
  while (globalY >= pageStartGlobal(pageConfig, metricsFor, pageNumber) + metricsFor(pageNumber).contentHeight) {
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
  return metricsFor(pageNumber).contentTop + (globalY - pageStartGlobal(pageConfig, metricsFor, pageNumber));
}

function resolveAnchoredObjects(
  inputFlows: FlowBlock[],
  pageConfig: PageConfig,
  metricsFor: (pageNumber: number) => PageMetrics,
  measurer: TextMeasurer,
  fontConfig: FontConfig,
  fontModifiers: Map<string, FontModifier> | undefined,
  inlineRegistry?: InlineRegistry,
): { flows: FlowBlock[]; placements: AnchoredObjectPlacement[] } {
  let flows = inputFlows;
  const placements: AnchoredObjectPlacement[] = [];
  const contentX = pageConfig.margins.left;
  const contentRight = pageConfig.pageWidth - pageConfig.margins.right;
  const contentWidth = contentRight - contentX;

  for (let i = 0; i < flows.length; i++) {
    const flow = flows[i]!;
    const anchors = getAnchoredObjectAnchors(flow);
    if (anchors.length === 0) continue;

    for (const anchor of anchors) {
      const attrs = anchor.attrs;
      const width = Math.min(attrs.width, contentWidth);
      const height = attrs.height;
      const wrapMode = attrs.wrapMode;
      let globalY = flows[i]!.globalY ?? 0;
      let pageNumber = pageForGlobalY(pageConfig, metricsFor, globalY);
      let localY = pageLocalYForGlobalY(pageConfig, metricsFor, pageNumber, globalY);

      // Anchor-push: any wrapping mode whose visual extent overflows its
      // anchor's page is pushed to the next page (provided the next page
      // can fit it). This applies uniformly to square / top-bottom /
      // behind / front.
      if (
        wrapMode !== "inline" &&
        !pageConfig.pageless &&
        localY + height > metricsFor(pageNumber).contentBottom &&
        height <= metricsFor(pageNumber + 1).contentHeight
      ) {
        const pushedGlobalY = pageStartGlobal(pageConfig, metricsFor, pageNumber + 1);
        flows = [
          ...flows.slice(0, i),
          { ...flows[i]!, globalY: pushedGlobalY },
          ...flows.slice(i + 1),
        ];
        flows = restampGlobalYFrom(flows, i + 1);
        globalY = pushedGlobalY;
        pageNumber = pageForGlobalY(pageConfig, metricsFor, globalY);
        localY = pageLocalYForGlobalY(pageConfig, metricsFor, pageNumber, globalY);
      }

      // Resolve horizontal X — single expression for every non-inline mode.
      const x = resolveImageX({ width, xAlign: attrs.xAlign, x: attrs.x }, contentX, contentWidth);

      // Square stacking: when two square images on the same page have wrap
      // zones that horizontally and vertically overlap, push the second
      // below the first. Tracked by image rect (not by xAlign) so a
      // user-positioned center image and a user-positioned right image at
      // overlapping Y still resolve cleanly.
      if (wrapMode === "square") {
        let stackedGlobalY = globalY;
        for (const placed of placements) {
          if (placed.wrapMode !== "square" || placed.page !== pageNumber) continue;
          const hOverlap = x < placed.x + placed.width && x + width > placed.x;
          const vOverlap = localY < placed.y + placed.height && localY + height > placed.y;
          if (hOverlap && vOverlap) {
            const placedGlobalY = placed.anchorGlobalY + placed.height + ANCHORED_OBJECT_MARGIN;
            stackedGlobalY = Math.max(stackedGlobalY, placedGlobalY);
          }
        }
        if (stackedGlobalY > globalY) {
          flows = [
            ...flows.slice(0, i),
            { ...flows[i]!, globalY: stackedGlobalY },
            ...flows.slice(i + 1),
          ];
          flows = restampGlobalYFrom(flows, i + 1);
          globalY = stackedGlobalY;
          pageNumber = pageForGlobalY(pageConfig, metricsFor, globalY);
          localY = pageLocalYForGlobalY(pageConfig, metricsFor, pageNumber, globalY);
        }
        // Re-check page fit after stacking.
        if (
          !pageConfig.pageless &&
          localY + height > metricsFor(pageNumber).contentBottom &&
          height <= metricsFor(pageNumber + 1).contentHeight
        ) {
          const pushedGlobalY = pageStartGlobal(pageConfig, metricsFor, pageNumber + 1);
          flows = [
            ...flows.slice(0, i),
            { ...flows[i]!, globalY: pushedGlobalY },
            ...flows.slice(i + 1),
          ];
          flows = restampGlobalYFrom(flows, i + 1);
          globalY = pushedGlobalY;
          pageNumber = pageForGlobalY(pageConfig, metricsFor, globalY);
          localY = pageLocalYForGlobalY(pageConfig, metricsFor, pageNumber, globalY);
        }
      }

      placements.push({
        docPos: anchor.docPos,
        page: pageNumber,
        x,
        y: localY,
        width,
        height,
        wrapMode,
        node: anchor.node,
        anchorGlobalY: globalY,
        anchorPage: pageNumber,
      });

      // Square: emit a wrap zone constraint for sibling lines whose Y
      // overlaps the painted rectangle. The anchor paragraph stays in
      // flow at its natural text height (no flow contribution); subsequent
      // paragraphs that fall within the zone get their lines narrowed.
      if (wrapMode === "square") {
        flows = reflowFlowsAgainstSquareObject(
          flows,
          i,
          {
            wrapText: attrs.wrapText,
            pageNumber,
            globalY,
            localY,
            x,
            width,
            height,
            margin: attrs.margin,
            contentX,
            contentWidth,
          },
          measurer,
          fontConfig,
          fontModifiers,
          inlineRegistry,
        );
        continue;
      }

      // Top-bottom: emit a flow clearance pushing following blocks past
      // the image's bottom.
      if (wrapMode === "top-bottom") {
        const clearanceY = globalY + height + attrs.margin;
        for (let j = i + 1; j < flows.length; j++) {
          const candidate = flows[j]!;
          if ((candidate.globalY ?? 0) >= clearanceY) break;
          flows = [
            ...flows.slice(0, j),
            { ...candidate, globalY: clearanceY },
            ...flows.slice(j + 1),
          ];
          flows = restampGlobalYFrom(flows, j + 1);
        }
        continue;
      }

      // behind / front — flow block already accounted for via Stage 1's
      // anchored-object-block split; no wrap zone, no clearance.
    }
  }

  return { flows, placements };
}

function reflowFlowsAgainstSquareObject(
  inputFlows: FlowBlock[],
  startIndex: number,
  zone: {
    /** Per-image wrap-side override; `largest` (default) picks the wider side. */
    wrapText: import("./AnchoredObjects").WrapText;
    pageNumber: number;
    globalY: number;
    localY: number;
    /** Painted X of the image (page-local). */
    x: number;
    width: number;
    height: number;
    margin: number;
    contentX: number;
    contentWidth: number;
  },
  measurer: TextMeasurer,
  fontConfig: FontConfig,
  fontModifiers: Map<string, FontModifier> | undefined,
  inlineRegistry?: InlineRegistry,
): FlowBlock[] {
  let flows = inputFlows;
  const margin = zone.margin;
  const zoneLeft = zone.x - margin;
  const zoneRight = zone.x + zone.width + margin;
  const zoneTop = zone.globalY - margin;
  const zoneBottom = zone.globalY + zone.height + margin;
  const contentRight = zone.contentX + zone.contentWidth;

  // Available widths on each side of the image's wrap zone, within the
  // content area. Either may be 0 when the image is flush against an edge.
  const leftAvail = Math.max(0, zoneLeft - zone.contentX);
  const rightAvail = Math.max(0, contentRight - zoneRight);

  // Resolve which side text wraps on. `largest` picks the wider side at
  // line-resolution time; `left` / `right` force a specific side.
  const sideForLine = (
    requiredWidth: number,
  ): { x: number; width: number } | "skip" | null => {
    // Apply per-image override or compute from geometry.
    if (zone.wrapText === "left") {
      if (leftAvail <= 0 || requiredWidth > leftAvail) return "skip";
      return { x: 0, width: leftAvail };
    }
    if (zone.wrapText === "right") {
      if (rightAvail <= 0 || requiredWidth > rightAvail) return "skip";
      return { x: zoneRight - zone.contentX, width: rightAvail };
    }
    // "largest" (default) — pick wider side that fits; deterministic
    // tie-break: when widths are equal, prefer right.
    const leftFits = leftAvail >= requiredWidth;
    const rightFits = rightAvail >= requiredWidth;
    if (!leftFits && !rightFits) return "skip";
    if (leftFits && !rightFits) return { x: 0, width: leftAvail };
    if (!leftFits && rightFits) return { x: zoneRight - zone.contentX, width: rightAvail };
    return rightAvail >= leftAvail
      ? { x: zoneRight - zone.contentX, width: rightAvail }
      : { x: 0, width: leftAvail };
  };

  for (let idx = startIndex; idx < flows.length; idx++) {
    const flow = flows[idx]!;
    const flowY = flow.globalY ?? 0;
    if (flowY >= zoneBottom) break;
    if (flow.lines.length === 0 || flowY + flow.height <= zoneTop) continue;

    const constraintProvider: ConstraintProvider = (absoluteLineY: number, lineHeight = 1) => {
      if (absoluteLineY + lineHeight <= zoneTop || absoluteLineY >= zoneBottom) {
        return null;
      }
      // requiredWidth = 1 here as a probe; LineBreaker handles per-line
      // word-fit checks with its own measurement.
      const side = sideForLine(1);
      if (side === null) return null;
      if (side === "skip") {
        // Force the line below the wrap zone.
        return { x: 0, width: 0, skipToY: zoneBottom };
      }
      return { x: side.x, width: side.width };
    };

    const reflowed = layoutBlock(flow.node, {
      nodePos: flow.nodePos,
      x: zone.contentX + flow.indentLeft,
      y: flowY,
      availableWidth: flow.availableWidth,
      page: zone.pageNumber,
      measurer,
      fontConfig,
      ...(fontModifiers ? { fontModifiers } : {}),
      constraintProvider,
      ...(inlineRegistry ? { inlineRegistry } : {}),
    });

    const nextFlow: FlowBlock = {
      ...flow,
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
      flows = restampGlobalYFrom(flows, idx + 1);
    }
  }

  return flows;
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

const GLOBAL_Y_PAGE_START_TOLERANCE = 24;

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
  measurer: TextMeasurer;
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
  const flowsWithGlobalY = assignGlobalY(flowResult.flows, metricsFor(1).contentTop);
  const anchoredFlow = resolveAnchoredObjects(
    flowsWithGlobalY,
    pageConfig,
    metricsFor,
    measurer,
    fontConfig,
    fontModifiers,
    options.inlineRegistry,
  );

  const pr = paginateFlow(
    anchoredFlow.flows, pageConfig, resolved, metricsFor, runId,
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
      anchoredObjects: anchoredFlow.placements,
    };
    return { layout, isPartial: true, ...context, y: pr.y, anchoredObjects: anchoredFlow.placements };
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
    anchoredObjects: anchoredFlow.placements,
  };
  return { layout, isPartial: false, ...context, y: pr.y, anchoredObjects: anchoredFlow.placements };
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

    if (!pageless && flow.globalY !== undefined) {
      while (
        flow.globalY >=
        pageStartGlobal(pageConfig, metricsFor, currentPage.pageNumber) +
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
    const firstOnPageNatural =
      isFirstOnPage &&
      Math.abs(pageLocalGlobalY - metricsFor(currentPage.pageNumber).contentTop) <= GLOBAL_Y_PAGE_START_TOLERANCE;
    const targetY = firstOnPageNatural ? naturalY : Math.max(naturalY, pageLocalGlobalY);
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
    const topBottom = topBottomImageInfo(node, nodePos);

    if (topBottom) {
      const makeFragmentNode = (children: Node[]): Node | null =>
        children.length > 0
          ? node.type.create(node.attrs, Fragment.fromArray(children), node.marks)
          : null;
      const pushTextFragment = (
        fragmentNode: Node | null,
        fragmentNodePos: number,
        spaceBefore: number,
        spaceAfter: number,
      ) => {
        if (!fragmentNode) return;
        const entry = resolveBlockEntry(
          fragmentNode, fragmentNodePos, blockX, 0, blockWidth, 1,
          measurer, fontConfig, fontModifiers, undefined, inlineRegistry,
        );
        flows.push({
          node: fragmentNode,
          nodePos: fragmentNodePos,
          lines: entry.lines,
          height: entry.height,
          spaceBefore,
          spaceAfter,
          availableWidth: blockWidth,
          blockType: entry.blockType,
          align: entry.align,
          ...(listMarker !== undefined ? {
            listMarker,
            listMarkerX: blockX - MARKER_RIGHT_GAP,
          } : {}),
          indentLeft,
          hasFloatAnchor: false,
          inputHash: computeInputHash(fragmentNodePos, fragmentNode, blockWidth),
          wasCacheHit: false,
          partKind: "fragment",
        });
      };

      const beforeNode = makeFragmentNode(topBottom.before);
      const afterNode = makeFragmentNode(topBottom.after);
      const imageHeight = typeof topBottom.image.attrs["height"] === "number"
        ? topBottom.image.attrs["height"] as number
        : 200;

      pushTextFragment(beforeNode, nodePos, blockStyle.spaceBefore, 0);
      flows.push({
        node: topBottom.image,
        nodePos: topBottom.imageDocPos,
        lines: [],
        height: imageHeight,
        spaceBefore: beforeNode ? 0 : blockStyle.spaceBefore,
        spaceAfter: afterNode ? ANCHORED_OBJECT_MARGIN : blockStyle.spaceAfter,
        availableWidth: blockWidth,
        blockType: "image",
        align: "left",
        ...(listMarker !== undefined ? {
          listMarker,
          listMarkerX: blockX - MARKER_RIGHT_GAP,
        } : {}),
        indentLeft,
        hasFloatAnchor: true,
        inputHash: computeInputHash(topBottom.imageDocPos, topBottom.image, blockWidth),
        wasCacheHit: false,
        partKind: "anchored-object",
        anchoredObjectDocPos: topBottom.imageDocPos,
        anchoredObjectNode: topBottom.image,
        anchoredObjectMode: "top-bottom",
      });
      const afterNodePos = topBottom.imageDocPos + topBottom.image.nodeSize - 1;
      pushTextFragment(afterNode, afterNodePos, 0, blockStyle.spaceAfter);

      processedBlocks++;
      continue;
    }

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

