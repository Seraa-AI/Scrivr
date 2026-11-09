/**
 * Stage 3 of the layout pipeline: anchored-object placement.
 *
 * Places every anchored float from its anchor flow, carves its wrap zone,
 * reflows the text and tables around it, and settles the two until no anchor
 * moves.
 */
import type { Node } from "prosemirror-model";
import { layoutBlock } from "./BlockLayout";
import type { LineSpaceProvider } from "./LineBreaker";
import { ExclusionManager, type ExclusionRect } from "./ExclusionManager";
import {
  ANCHORED_OBJECT_MARGIN,
  normalizeImageAttrs,
  resolveImageX,
  type AnchoredObjectPlacement,
  type NormalizedImageAttrs,
} from "./AnchoredObjects";
import type { PageGeometry } from "./PageMetrics";
import { advanceFlowGlobalY, collapseMargins, landingAfter, pageLocalYForGlobalY } from "./FlowPlacement";
import type { FlowBlock, MeasureContext, PageConfig } from "./PageLayout";

/** Where flow `index` starts when only its predecessor decides. */
function naturalStartOf(
  flows: readonly FlowBlock[],
  index: number,
  pageConfig: PageConfig,
  geometry: PageGeometry,
): number {
  const flow = flows[index];
  const prev = flows[index - 1];
  if (!flow) return 0;
  if (!prev) return flow.originalGlobalY ?? flow.globalY ?? 0;
  const prevEnd = advanceFlowGlobalY(prev, prev.globalY ?? 0, pageConfig, geometry).endGlobalY;
  const gap = prev.isPageBreak ? 0 : collapseMargins(prev.spaceAfter, flow.spaceBefore);
  return landingAfter(flow, prevEnd, gap, pageConfig, geometry);
}

/** Where flow `index` must start, given where it would start on its own. */
type StartOf = (index: number, naturalStart: number) => number;

/**
 * Re-derive flow starts from `startIndex` on, in place, each from its
 * predecessor; `startOf` re-applies what the floats need of an anchor flow.
 * Stops at the first flow that does not move: everything after it, a
 * deliberate push included, still follows from it. Returns the indices that
 * moved as `[from, to)`, empty when nothing did.
 */
function restampGlobalYFrom(
  flows: FlowBlock[],
  startIndex: number,
  pageConfig: PageConfig,
  geometry: PageGeometry,
  startOf: StartOf,
): { from: number; to: number } {
  let to = startIndex;
  for (let i = startIndex; i < flows.length; i++) {
    const flow = flows[i];
    if (!flow) break;
    const natural = naturalStartOf(flows, i, pageConfig, geometry);
    const start = startOf(i, natural);
    const pushed = start !== natural;
    if (start === flow.globalY) break;
    flows[i] = { ...flow, globalY: start, solverPushedThisFlow: pushed };
    to = i + 1;
  }
  return { from: startIndex, to };
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

interface PageBarrierProvider {
  pageForGlobalY(globalY: number): number;
  pageStartGlobal(pageNumber: number): number;
  contentBottomLocal(pageNumber: number): number;
  contentHeight(pageNumber: number): number;
  localYForGlobalY(pageNumber: number, globalY: number): number;
}

function createPageBarrierProvider(geometry: PageGeometry): PageBarrierProvider {
  return {
    pageForGlobalY: (globalY) => geometry.pageAt(globalY),
    pageStartGlobal: (pageNumber) => geometry.startOf(pageNumber),
    contentBottomLocal: (pageNumber) => geometry.metricsFor(pageNumber).contentBottom,
    contentHeight: (pageNumber) => geometry.metricsFor(pageNumber).contentHeight,
    localYForGlobalY: (pageNumber, globalY) =>
      pageLocalYForGlobalY(geometry, pageNumber, globalY),
  };
}

/**
 * How many placements one settle gives a wrapping float whose own wrap keeps
 * moving its anchor, if no placement repeats, before it is locked.
 * Convergence takes one extra placement; this catches a runaway.
 */
const MAX_PLACEMENTS_BEFORE_LOCK = 4;

/**
 * A backstop on passes in one settle. Locking normally ends a settle long
 * before; a settle that reaches it has just reflowed its dirty pages, so text
 * agrees with every rect, and stops there.
 */
const MAX_SETTLE_PASSES = 64;

/** A vertical span in continuous-flow coordinates. */
interface Band {
  top: number;
  bottom: number;
}

/** Where a float lands, and where its anchor flow has to start for it. */
interface FloatPlace {
  placement: AnchoredObjectPlacement;
  anchorStart: number;
}

/** A float the solver has placed, and how to place it again. */
interface PlacedFloat {
  anchorFlowIndex: number;
  docPos: number;
  /** Square and top-bottom floats carve a wrap zone; behind and front do not. */
  wraps: boolean;
  placement: AnchoredObjectPlacement;
  /** Set when the float's own wrap kept moving its anchor, so it has no fixed point. */
  locked: boolean;
  /**
   * Where the float goes, and where its anchor flow must start, given where
   * that flow would start on its own. A locked float stays where it is and
   * holds its anchor on its page; it moves only when its anchor reaches a
   * later page.
   */
  place(anchorFlowStart: number): FloatPlace;
  zoneOf(placement: AnchoredObjectPlacement): Band;
  exclusionOf(placement: AnchoredObjectPlacement): ExclusionRect;
}

/** The solver's floats, as the reflow needs them. */
interface FloatSet {
  readonly placed: readonly PlacedFloat[];
  /** Where flow `index` must start for the floats anchored in it. */
  startOf: StartOf;
  /** Where `float` goes with the flows as they are in `current`. */
  placementIn(float: PlacedFloat, current: readonly FlowBlock[]): AnchoredObjectPlacement;
}

/** A page's exclusions, read-only: only carving a float adds to them. */
type ExclusionsReader = Pick<ExclusionManager, "getAvailableSegments" | "getNextFreeY" | "hasExclusionsOnPage">;

export function resolveAnchoredObjects(
  inputFlows: FlowBlock[],
  pageConfig: PageConfig,
  geometry: PageGeometry,
  ctx: MeasureContext,
): { flows: FlowBlock[]; placements: AnchoredObjectPlacement[] } {
  const flows = [...inputFlows];
  const placed: PlacedFloat[] = [];
  const contentX = pageConfig.margins.left;
  const contentRight = pageConfig.pageWidth - pageConfig.margins.right;
  const contentWidth = contentRight - contentX;
  const barriers = createPageBarrierProvider(geometry);
  // One ExclusionManager per page holds every float's rect on it, so a flow
  // beside two floats reflows against both.
  const exclusionsByPage = new Map<number, ExclusionManager>();
  const exclusionsOn = (page: number): ExclusionsReader => exclusionsByPage.get(page) ?? new ExclusionManager();
  const carve = (float: PlacedFloat): void => {
    const page = float.placement.page;
    let exclusions = exclusionsByPage.get(page);
    if (!exclusions) {
      exclusions = new ExclusionManager();
      exclusionsByPage.set(page, exclusions);
    }
    exclusions.addRect(float.exclusionOf(float.placement));
  };
  const uncarve = (float: PlacedFloat): void => {
    exclusionsByPage.get(float.placement.page)?.removeRectsFor(float.docPos);
  };
  const floatsByFlow = new Map<number, PlacedFloat[]>();

  const floatSet: FloatSet = {
    placed,
    startOf: (index, naturalStart) => {
      let start = naturalStart;
      for (const float of floatsByFlow.get(index) ?? []) start = float.place(start).anchorStart;
      return start;
    },
    placementIn: (float, current) => {
      if (current[float.anchorFlowIndex]?.globalY === float.placement.anchorGlobalY) return float.placement;
      return float.place(naturalStartOf(current, float.anchorFlowIndex, pageConfig, geometry)).placement;
    },
  };

  const reflow = (page: number, band: Band | undefined): { from: number; to: number } =>
    reflowFlowsAgainstExclusions(
      flows,
      exclusionsOn,
      { pageNumber: page, band, contentX, contentWidth },
      floatSet,
      pageConfig,
      geometry,
      ctx,
    );
  const restampFrom = (index: number): { from: number; to: number } =>
    restampGlobalYFrom(flows, index, pageConfig, geometry, floatSet.startOf);

  // A wrap zone reflows every block it overlaps, including blocks *above*
  // its own anchor, and can move a table above it. Either moves every anchor
  // after that point, so a placement recorded before the reflow describes a
  // position its anchor no longer has.
  //
  // The reflow is what settles the anchors, so the two have to converge
  // rather than run in order. Each pass reflows the pages the last pass
  // changed — a moved float's old and new band, and the pages its moves
  // carried flows onto — then places again every float whose anchor flow
  // moved, or that stacks on a page where a float moved.
  //
  // A float whose own wrap keeps moving its anchor has no layout where text,
  // float and anchor all agree, and is locked as Word does: when one of its
  // placements repeats (an oscillation, as LibreOffice's SwOszControl
  // detects it) or after MAX_PLACEMENTS_BEFORE_LOCK placements that never
  // settle.
  const settleFrom = (first: PlacedFloat, carried: { from: number; to: number }): void => {
    const dirty = new Map<number, Band | undefined>();
    const markBand = (page: number, band: Band): void => {
      const known = dirty.get(page);
      dirty.set(page, known
        ? { top: Math.min(known.top, band.top), bottom: Math.max(known.bottom, band.bottom) }
        : band);
    };
    // A page that holds a float's rect and had flows carried onto it needs a
    // scan; the page just reflowed already scanned to its bottom.
    const markMoved = (moved: { from: number; to: number }, scanned = 0): void => {
      for (let i = moved.from; i < moved.to; i++) {
        const page = geometry.pageAt(flows[i]?.globalY ?? 0);
        if (page > scanned && exclusionsOn(page).hasExclusionsOnPage(page) && !dirty.has(page)) {
          dirty.set(page, undefined);
        }
      }
    };

    carve(first);
    markBand(first.placement.page, first.zoneOf(first.placement));
    markMoved(carried);

    const history = new Map<PlacedFloat, AnchoredObjectPlacement[]>();

    for (let pass = 0; ; pass++) {
      let firstMoved = flows.length;
      while (dirty.size > 0) {
        const page = Math.min(...dirty.keys());
        const band = dirty.get(page);
        dirty.delete(page);
        const moved = reflow(page, band);
        if (moved.to > moved.from) {
          firstMoved = Math.min(firstMoved, moved.from);
          markMoved(moved, page);
        }
      }
      if (pass >= MAX_SETTLE_PASSES) return;

      const pagesWithMovedFloats = new Set<number>();
      for (const float of placed) {
        const index = float.anchorFlowIndex;
        if (index < firstMoved && !pagesWithMovedFloats.has(float.placement.page)) continue;
        if (!flows[index]) continue;
        // Re-applies the floats' anchor push to this flow and carries what
        // follows along.
        const moved = restampFrom(index);
        if (moved.to > moved.from) {
          firstMoved = Math.min(firstMoved, moved.from);
          markMoved(moved);
        }
        const previous = float.placement;
        const next = float.place(flows[index]?.globalY ?? 0).placement;
        if (samePlacement(next, previous)) continue;
        // place() moves a locked float only onto a later page.
        float.locked = false;

        if (float.wraps) {
          const seen = history.get(float) ?? [previous];
          if (seen.some((p) => samePlacement(p, next)) || seen.length > MAX_PLACEMENTS_BEFORE_LOCK) {
            // Lock at the state it is returning to: its fixed point, if it
            // was converging.
            float.locked = true;
          }
          history.set(float, [...seen, next]);
        }

        if (float.wraps) uncarve(float);
        float.placement = next;
        pagesWithMovedFloats.add(previous.page);
        pagesWithMovedFloats.add(next.page);
        if (!float.wraps) continue;
        carve(float);
        markBand(previous.page, float.zoneOf(previous));
        markBand(next.page, float.zoneOf(next));
      }
      if (dirty.size === 0) return;
    }
  };

  for (let i = 0; i < flows.length; i++) {
    const flow = flows[i];
    if (!flow) continue;
    for (const anchor of getAnchoredObjectAnchors(flow)) {
      const start = floatSet.startOf(i, naturalStartOf(flows, i, pageConfig, geometry));
      const float = createPlacedFloat(anchor, i, placed.length, start);
      placed.push(float);
      floatsByFlow.set(i, [...(floatsByFlow.get(i) ?? []), float]);
      // Applies the new float's anchor push to its flow and what follows.
      const carried = restampFrom(i);
      if (float.wraps) settleFrom(float, carried);
    }
  }

  return { flows, placements: placed.map((float) => float.placement) };

  function createPlacedFloat(
    anchor: AnchorRef,
    anchorFlowIndex: number,
    order: number,
    anchorFlowStart: number,
  ): PlacedFloat {
    const attrs = anchor.attrs;
    const width = Math.min(attrs.width, contentWidth);
    const { height, wrapMode, yOffset, margin } = attrs;
    const wraps = wrapMode === "square" || wrapMode === "top-bottom";
    const x = resolveImageX(
      { width, xAlign: attrs.xAlign, x: attrs.x },
      contentX,
      contentWidth,
      pageConfig.pageWidth,
    );

    // Anchor-push: a float that reserves flow space and does not fit below its
    // anchor on the page sends the anchor flow to the next page (when that
    // page can hold it). yOffset is not factored in — the anchor's own fit
    // decides the page; yOffset only shifts within it, clamped. `behind` and
    // `front` reserve no space, so they never push.
    const nextPageIfTooTall = (top: number): number | undefined => {
      if (!wraps || pageConfig.pageless) return undefined;
      const page = barriers.pageForGlobalY(top);
      const local = barriers.localYForGlobalY(page, top);
      return local + height > barriers.contentBottomLocal(page) &&
        height <= barriers.contentHeight(page + 1)
        ? barriers.pageStartGlobal(page + 1)
        : undefined;
    };

    // The clamp keeps the image on its anchor's page.
    const clampToPage = (painted: number, page: number): number => {
      if (pageConfig.pageless) return painted;
      const pageStart = barriers.pageStartGlobal(page);
      const pageEnd = pageStart + Math.max(0, barriers.contentHeight(page) - height);
      return Math.min(Math.max(painted, pageStart), pageEnd);
    };

    // Square stacking: a square float that would overlap one
    // placed before it on the page moves down below it;
    // its anchor paragraph stays where it is.
    const stackBelowOthers = (painted: number, page: number): number => {
      if (wrapMode !== "square") return painted;
      const obstacles = placed
        .slice(0, order)
        .map((other) => other.placement)
        .filter((p) => p.wrapMode === "square")
        .sort((a, b) => a.globalY - b.globalY);
      let top = painted;
      for (const p of obstacles) {
        if (paintedOverlap(p, { page, x, width, globalY: top, height })) {
          top = Math.max(top, p.globalY + p.height + ANCHORED_OBJECT_MARGIN);
        }
      }
      return top;
    };

    const placeFresh = (anchorFlowStart: number): FloatPlace => {
      let anchorStart = nextPageIfTooTall(anchorFlowStart) ?? anchorFlowStart;
      let page = barriers.pageForGlobalY(anchorStart);
      let atOffset = clampToPage(anchorStart + yOffset, page);
      let painted = stackBelowOthers(atOffset, page);
      // Stacking can push the image off its page; then the anchor moves on,
      // when the next page can hold the image.
      if (painted !== atOffset && clampToPage(painted, page) !== painted) {
        const pushed = wraps && !pageConfig.pageless && height <= barriers.contentHeight(page + 1)
          ? barriers.pageStartGlobal(page + 1)
          : undefined;
        if (pushed !== undefined) {
          anchorStart = pushed;
          page = barriers.pageForGlobalY(anchorStart);
          atOffset = clampToPage(anchorStart + yOffset, page);
          painted = stackBelowOthers(atOffset, page);
        }
        painted = clampToPage(painted, page);
      }
      const clamped = atOffset !== anchorStart + yOffset;
      const stackOffset = painted - atOffset;
      return {
        anchorStart,
        placement: {
          docPos: anchor.docPos,
          page,
          x,
          y: barriers.localYForGlobalY(page, painted),
          width,
          height,
          wrapMode,
          zIndex: attrs.zIndex,
          node: anchor.node,
          anchorGlobalY: anchorStart,
          anchorPage: page,
          globalY: painted,
          ...(clamped ? { clamped: true } : {}),
          ...(stackOffset > 0 ? { stackOffset } : {}),
        },
      };
    };

    const place = (anchorFlowStart: number): FloatPlace => {
      const fresh = placeFresh(anchorFlowStart);
      if (!self.locked || fresh.placement.page > self.placement.page) return fresh;
      const page = self.placement.page;
      const held = barriers.pageForGlobalY(anchorFlowStart) < page ? barriers.pageStartGlobal(page) : anchorFlowStart;
      return { placement: self.placement, anchorStart: held };
    };

    // The zone may not reach above the anchor on the strength of its margin
    // alone. Blocks above the anchor are what fix the anchor's own position,
    // so letting the margin band narrow them makes the anchor depend on a
    // float that depends on the anchor: the block grows, the anchor drops, the
    // zone follows it off the block, the block shrinks back. That has no fixed
    // point. The image rectangle itself still reflows whatever it covers.
    const zoneOf = (at: AnchoredObjectPlacement): Band => {
      const pageStart = barriers.pageStartGlobal(at.page);
      const pageEnd = pageStart + barriers.contentHeight(at.page);
      return {
        top: Math.max(pageStart, at.globalY - margin, Math.min(at.globalY, at.anchorGlobalY)),
        bottom: Math.min(pageEnd, at.globalY + height + margin),
      };
    };

    // Square carves a side zone at the image's painted rectangle; top-bottom
    // reserves the whole band.
    const exclusionOf = (at: AnchoredObjectPlacement): ExclusionRect => {
      const zone = zoneOf(at);
      return wrapMode === "square"
        ? { page: at.page, x: x - margin, right: x + width + margin, y: zone.top, bottom: zone.bottom, side: "left", docPos: anchor.docPos }
        : { page: at.page, x: contentX, right: contentRight, y: zone.top, bottom: zone.bottom, side: "full", docPos: anchor.docPos };
    };

    const self: PlacedFloat = {
      anchorFlowIndex,
      docPos: anchor.docPos,
      wraps,
      locked: false,
      placement: placeFresh(anchorFlowStart).placement,
      place,
      zoneOf,
      exclusionOf,
    };
    return self;
  }
}

/** Two painted image rects on the same page that intersect. */
function paintedOverlap(
  a: Pick<AnchoredObjectPlacement, "page" | "x" | "width" | "globalY" | "height">,
  b: Pick<AnchoredObjectPlacement, "page" | "x" | "width" | "globalY" | "height">,
): boolean {
  return a.page === b.page &&
    a.x < b.x + b.width && b.x < a.x + a.width &&
    a.globalY < b.globalY + b.height && b.globalY < a.globalY + a.height;
}

function samePlacement(a: AnchoredObjectPlacement, b: AnchoredObjectPlacement): boolean {
  return a.page === b.page && a.globalY === b.globalY && a.anchorGlobalY === b.anchorGlobalY;
}

/**
 * Reflow one page against all of its exclusions.
 *
 * Re-lays every text flow on the page that lies in `band` (where a float's
 * zone arrived or left), and every one whose wrap no longer matches where it
 * sits: it touches an exclusion and was not laid out at this y, or it was
 * wrapped on this page before at another y. A table that meets a float moves
 * below it. Growing a block or moving a table restamps what follows, so the
 * scan runs to the page bottom.
 *
 * This deliberately does not start at the anchor flow index. `yOffset` makes
 * the painted rectangle independent from anchor order, so an image anchored
 * in paragraph B can exclude text in paragraph A. Geometry drives wrapping.
 *
 * Returns the indices whose start moved, as `[from, to)`.
 */
function reflowFlowsAgainstExclusions(
  flows: FlowBlock[],
  exclusionsOn: (page: number) => ExclusionsReader,
  zone: {
    pageNumber: number;
    band: Band | undefined;
    contentX: number;
    contentWidth: number;
  },
  floats: FloatSet,
  pageConfig: PageConfig,
  geometry: PageGeometry,
  ctx: MeasureContext,
): { from: number; to: number } {
  const { measurer, fontConfig, fontModifiers, inlineRegistry, fonts } = ctx;
  const page = zone.pageNumber;
  const exclusions = exclusionsOn(page);
  const pageTop = pageConfig.pageless ? -Infinity : geometry.startOf(page);
  const pageBottom = pageConfig.pageless ? Infinity : geometry.bottomOf(page);
  let moved = { from: flows.length, to: flows.length };
  const noteMoved = (range: { from: number; to: number }): void => {
    if (range.to <= range.from) return;
    moved = moved.to > moved.from
      ? { from: Math.min(moved.from, range.from), to: Math.max(moved.to, range.to) }
      : range;
  };

  for (let idx = 0; idx < flows.length; idx++) {
    const flow = flows[idx];
    if (!flow) break;
    const flowY = flow.globalY ?? 0;
    if (flowY >= pageBottom) break;
    // Leaf flows (image/HR/pageBreak) cannot be re-broken around a wrap zone.
    if (flow.kind === "leaf" || flowY + flow.height <= pageTop) continue;
    // A table cannot be re-broken either, so it moves below the float instead.
    if (flow.kind === "tableRow") {
      if (pageConfig.pageless) continue;
      const table = moveTableClearOfFloats(flows, idx, zone, floats, pageConfig, geometry);
      noteMoved(table.moved);
      idx = table.lastRowIndex;
      continue;
    }

    const blockContentX = zone.contentX + flow.indentLeft;
    const inBand = zone.band !== undefined && flowY < zone.band.bottom && flowY + flow.height > zone.band.top;
    const wrappedHere = flow.overlapsWrapZone === true && flow.wrapZonePage === page;
    const laidHere = wrappedHere && flow.wrapLaidAtY === flowY;
    const touches = exclusions.getNextFreeY(page, flowY, flow.height, blockContentX, flow.availableWidth) !== flowY;
    if (!inBand && laidHere) continue;
    if (!inBand && !wrappedHere && !touches) continue;

    // Lines are laid out where pagination will put them: a line that does
    // not fit above the page bottom starts the next page, and each line asks
    // the page it falls on. So the wrap holds wherever the block lands.
    const lineSpaceProvider: LineSpaceProvider = (absoluteLineY: number, lineHeight = 1) => {
      const linePage = pageConfig.pageless ? page : geometry.pageAt(absoluteLineY);
      if (
        !pageConfig.pageless &&
        absoluteLineY > geometry.startOf(linePage) &&
        absoluteLineY + lineHeight > geometry.bottomOf(linePage)
      ) {
        return { segments: [], skipToY: geometry.startOf(linePage + 1) };
      }
      const lineExclusions = exclusionsOn(linePage);
      const space = lineExclusions.getAvailableSegments(linePage, absoluteLineY, lineHeight, blockContentX, flow.availableWidth);
      // ExclusionManager returns segments in the same coordinate space as
      // contentX (here: absolute page-local). LineSpaceProvider's contract
      // requires block-content-relative coords, so translate.
      const segments = space.segments.map((s) => ({ x: s.x - blockContentX, width: s.width }));
      // Side rects can punch out every segment without a full-width rect.
      // Skip past every rect on the line so the line breaker advances past
      // the images instead of dropping words.
      if (segments.length === 0 && space.skipToY === undefined) {
        return {
          segments,
          skipToY: lineExclusions.getNextFreeY(linePage, absoluteLineY, lineHeight, blockContentX, flow.availableWidth),
        };
      }
      return space.skipToY !== undefined ? { segments, skipToY: space.skipToY } : { segments };
    };

    const reflowed = layoutBlock(flow.node, {
      nodePos: flow.nodePos,
      x: blockContentX,
      y: flowY,
      availableWidth: flow.availableWidth,
      page,
      measurer,
      fontConfig,
      ...(fontModifiers ? { fontModifiers } : {}),
      lineSpaceProvider,
      ...(inlineRegistry ? { inlineRegistry } : {}),
      ...(fonts ? { fonts } : {}),
    });

    const nextFlow: FlowBlock = {
      ...flow,
      overlapsWrapZone: true,
      wrapZonePage: pageConfig.pageless ? page : geometry.pageAt(flowY),
      wrapLaidAtY: flowY,
      lines: reflowed.lines,
      height: reflowed.height,
      blockType: reflowed.blockType,
      align: reflowed.align,
      availableWidth: reflowed.availableWidth,
    };
    flows[idx] = nextFlow;

    // Restamping re-derives later flows from their predecessors; only do it
    // when this block's end actually moved.
    const endBefore = advanceFlowGlobalY(flow, flowY, pageConfig, geometry).endGlobalY;
    const endAfter = advanceFlowGlobalY(nextFlow, flowY, pageConfig, geometry).endGlobalY;
    if (endAfter !== endBefore) {
      noteMoved(restampGlobalYFrom(flows, idx + 1, pageConfig, geometry, floats.startOf));
    }
  }

  return moved;
}

/** A row whose table goes on after it, so the next flow is that table's next row. */
function continuesTable(row: FlowBlock | undefined): row is FlowBlock {
  return row?.kind === "tableRow" && !row.isLastRow;
}

function bandsOverlap(a: Band, b: Band): boolean {
  return a.top < b.bottom && a.bottom > b.top;
}

/** The band from the first row's top to the last row's bottom. */
function tableExtent(flows: readonly FlowBlock[], start: number, end: number): Band {
  const first = flows[start];
  const last = flows[end];
  return {
    top: first?.globalY ?? 0,
    bottom: (last?.globalY ?? 0) + (last?.height ?? 0),
  };
}

/**
 * Place the table holding `rowIndex` below every float on the page it cannot
 * sit beside, measured from where the table would sit on its own. Word wraps
 * a table as one unit and never narrows it, so its rows on this page move
 * together; rows on other pages stay. The floats are taken where they sit
 * with the flows as they are now, never from rects a restamp left behind.
 */
function moveTableClearOfFloats(
  flows: FlowBlock[],
  rowIndex: number,
  zone: { pageNumber: number; contentX: number; contentWidth: number },
  floats: FloatSet,
  pageConfig: PageConfig,
  geometry: PageGeometry,
): { moved: { from: number; to: number }; lastRowIndex: number } {
  const page = zone.pageNumber;
  const onPage = (flow: FlowBlock | undefined): boolean =>
    flow !== undefined && geometry.pageAt(flow.globalY ?? 0) === page;

  let start = rowIndex;
  while (continuesTable(flows[start - 1]) && onPage(flows[start - 1])) start--;
  let end = rowIndex;
  while (continuesTable(flows[end]) && onPage(flows[end + 1])) end++;
  const first = flows[start];
  const none = { moved: { from: start, to: start }, lastRowIndex: end };
  if (!first) return none;

  const natural = naturalStartOf(flows, start, pageConfig, geometry);
  const tableHeight = tableExtent(flows, start, end).bottom - (first.globalY ?? 0);
  // Floats anchored before the table stay put while it moves. One anchored
  // after it moves with it, so it blocks the table only where it reaches back
  // over the table's own band — and a locked one never does: it is a float
  // anchored after the table, and those overlap it.
  // The table is cleared on the page its natural position is on, which is
  // not the page being scanned when an earlier move carried it over.
  const clearPage = geometry.pageAt(natural);
  const naturalBand = { top: natural, bottom: natural + tableHeight };
  const stayingPut = new ExclusionManager();
  const blocking = new ExclusionManager();
  for (const float of floats.placed) {
    if (!float.wraps || Math.abs(float.placement.page - clearPage) > 1) continue;
    const placement = floats.placementIn(float, flows);
    if (placement.page !== clearPage) continue;
    const rect = float.exclusionOf(placement);
    const anchoredBefore = float.anchorFlowIndex <= end;
    if (anchoredBefore) stayingPut.addRect(rect);
    if (anchoredBefore || (!float.locked && bandsOverlap(float.zoneOf(placement), naturalBand))) {
      blocking.addRect(rect);
    }
  }
  const clearOf = (exclusions: ExclusionManager): number => {
    const clearY = exclusions.getNextFreeY(clearPage, natural, tableHeight, zone.contentX, zone.contentWidth);
    return clearY === natural ? natural : advanceFlowGlobalY(first, clearY, pageConfig, geometry).startGlobalY;
  };
  const startingAt = (target: number): { flows: FlowBlock[]; to: number } => {
    const tentative = [...flows];
    tentative[start] = { ...first, globalY: target, solverPushedThisFlow: target !== natural };
    const restamped = restampGlobalYFrom(tentative, start + 1, pageConfig, geometry, floats.startOf);
    return { flows: tentative, to: Math.max(restamped.to, start + 1) };
  };

  // Clear every float if the floats the move drags let it; otherwise clear
  // only the floats that stay put and let the dragged ones overlap
  // when they would chase it; otherwise stay.
  const candidates = [
    { target: clearOf(blocking), reachBackMustClear: true },
    { target: clearOf(stayingPut), reachBackMustClear: false },
  ];
  let target = natural;
  let result = startingAt(natural);
  for (const candidate of candidates) {
    if (candidate.target === natural) continue;
    const tried = startingAt(candidate.target);
    if (!draggedFloatsHold(floats, flows, tried.flows, start, end, candidate.reachBackMustClear)) continue;
    target = candidate.target;
    result = tried;
    break;
  }
  if (target === first.globalY) return none;

  for (let i = start; i < result.to; i++) {
    const flow = result.flows[i];
    if (flow) flows[i] = flow;
  }
  return { moved: { from: start, to: result.to }, lastRowIndex: end };
}

/**
 * Moving a table drags every float anchored after it. The move holds only if
 * each one that reaches back over the table keeps its anchor on its page and,
 * when `reachBackMustClear`, clears the moved table; and each one that does
 * not reach back still clears it once carried. A float that does not reach
 * back may be carried onto the next page.
 */
function draggedFloatsHold(
  floats: FloatSet,
  before: readonly FlowBlock[],
  after: readonly FlowBlock[],
  start: number,
  end: number,
  reachBackMustClear: boolean,
): boolean {
  const tableBefore = tableExtent(before, start, end);
  const tableAfter = tableExtent(after, start, end);
  return floats.placed.every((float) => {
    if (!float.wraps || float.anchorFlowIndex <= end || float.locked) return true;
    const now = floats.placementIn(float, before);
    const moved = floats.placementIn(float, after);
    const clears = !bandsOverlap(float.zoneOf(moved), tableAfter);
    if (!bandsOverlap(float.zoneOf(now), tableBefore)) return clears;
    return moved.page === now.page && (clears || !reachBackMustClear);
  });
}
