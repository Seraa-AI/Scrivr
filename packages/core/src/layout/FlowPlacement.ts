/**
 * Where flows sit in continuous global-Y: the page geometry that both
 * pagination and the anchored-object solver build on.
 */
import type { PageGeometry } from "./PageMetrics";
import { fitLinesInCapacity } from "./splitLines";
import type { LayoutLine } from "./LineBreaker";
import type { FlowBlock, PageConfig } from "./PageLayout";
import type { PageStart } from "./layoutItems";

export function targetPageNumber(
  currentPage: number,
  breakType: PageStart | undefined,
): number {
  let target = currentPage + 1;
  if (breakType === "evenPage" && target % 2 !== 0) target++;
  if (breakType === "oddPage" && target % 2 === 0) target++;
  return target;
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
export function advanceFlowGlobalY(
  flow: FlowBlock,
  naturalStart: number,
  pageConfig: PageConfig,
  geometry: PageGeometry,
): { startGlobalY: number; endGlobalY: number } {
  // A break was landed on the page it starts.
  if (flow.pageStart || pageConfig.pageless) {
    return { startGlobalY: naturalStart, endGlobalY: naturalStart + flow.height };
  }

  const pageOf = (g: number): number => geometry.pageAt(g);
  const pageStart = (p: number): number => geometry.startOf(p);
  const pageBottom = (p: number): number => geometry.bottomOf(p);

  // Atomic blocks (image / hr / a composite unit) never split: if the block overflows
  // its page it moves whole to a fresh one (the gap), and overflows from there
  // when it is taller than a page. `paginateFlow` does the same.
  const isAtomic = flow.kind === "leaf" || flow.kind === "composite";
  if (isAtomic || flow.lines.length === 0) {
    let start = naturalStart;
    const page = pageOf(start);
    const atTop = start === pageStart(page);
    if (!atTop && start + flow.height > pageBottom(page)) {
      start = pageStart(page + 1);
    }
    // However far a block hangs past its page, the page ends at its bottom, and
    // what follows starts the next one.
    return { startGlobalY: start, endGlobalY: Math.min(start + flow.height, pageBottom(pageOf(start))) };
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
      const [first] = remaining;
      // paginateFlow forces one line at a page top (a line taller than the
      // page) and a first line within its sub-pixel tolerance of fitting.
      const forced = first && (cursor === top || lineFitsAt(pageBottom(page), cursor, first.lineHeight));
      if (forced) {
        fitted = [first];
        rest = remaining.slice(1);
        // A line taller than the page, or within tolerance of fitting, hangs past
        // the bottom; its page still ends there, so what follows starts the next.
        fittedHeight = Math.min(first.lineHeight, pageBottom(page) - cursor);
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

/** Where the flow after this one continues from. */
export interface FlowCursor {
  y: number;
  prevSpaceAfter: number;
  /** The page it ended on. A `y` at a page's top does not say whether it filled the page above. */
  page: number;
}

/**
 * The cursor a flow leaves behind. A page break swallows its own trailing
 * space, so what follows collapses against nothing.
 */
export function flowCursorAfter(
  flow: FlowBlock,
  startGlobalY: number,
  pageConfig: PageConfig,
  geometry: PageGeometry,
): FlowCursor {
  const { endGlobalY } = advanceFlowGlobalY(flow, startGlobalY, pageConfig, geometry);
  const page = geometry.pageAt(endGlobalY);
  const filledThePageAbove = endGlobalY > startGlobalY && geometry.startOf(page) === endGlobalY;
  return {
    y: endGlobalY,
    prevSpaceAfter: flow.pageStart ? 0 : flow.spaceAfter,
    page: filledThePageAbove ? page - 1 : page,
  };
}

/**
 * The lines a flow has starting at `start`: lines laid out around a float hold
 * only where they were laid, and elsewhere the measured ones stand in until the
 * flow is laid out there.
 */
function linesAt(flow: FlowBlock, start: number): LayoutLine[] {
  return flow.measuredLines && flow.wrapLaidAtY !== start ? flow.measuredLines : flow.lines;
}

/** Whether a line `lineHeight` tall starting at `y` fits, within half a pixel. */
export function lineFitsAt(pageBottom: number, y: number, lineHeight: number): boolean {
  return pageBottom - y >= lineHeight - 0.5;
}

/**
 * Where a flow starts when its predecessor left `prev` and the collapsed gap
 * before it is `gap` — where `paginateFlow` paints it. As in Word, the gap
 * is never given up to fit a line: a first line that does not fit after it
 * starts the next page, where the gap is dropped.
 * The first line is the flow's own, so a flow laid out again is landed again.
 */
export function landingAfter(
  flow: FlowBlock,
  prev: Pick<FlowCursor, "y" | "page">,
  gap: number,
  pageConfig: PageConfig,
  geometry: PageGeometry,
): number {
  const start = prev.y + gap;
  if (pageConfig.pageless) return start;
  const { page } = prev;
  if (flow.pageStart) return geometry.startOf(targetPageNumber(page, flow.pageStart));
  const bottom = geometry.bottomOf(page);
  if (start >= bottom) return geometry.startOf(page + 1);

  const firstLine = flow.kind === "text" ? linesAt(flow, start)[0] : undefined;
  if (!firstLine) return advanceFlowGlobalY(flow, start, pageConfig, geometry).startGlobalY;
  if (start === geometry.startOf(page) || lineFitsAt(bottom, start, firstLine.lineHeight)) return start;
  return geometry.startOf(page + 1);
}

/**
 * Stamp each flow with its continuous-flow Y.
 *
 * Omitting `initialSpaceAfter` means the first flow on a page, whose leading
 * margin is suppressed. Passing `0` means a continuation whose predecessor
 * happened to end with no trailing space — that one still collapses, and so
 * still emits `spaceBefore`. The two are different pixels; `?? 0` would erase
 * the distinction.
 */
export function assignGlobalY(
  flows: FlowBlock[],
  initialY: number,
  pageConfig: PageConfig,
  geometry: PageGeometry,
  initialSpaceAfter?: number,
  initialPage: number = geometry.pageAt(initialY),
): FlowBlock[] {
  let cursor: FlowCursor = { y: initialY, prevSpaceAfter: initialSpaceAfter ?? 0, page: initialPage };

  return flows.map((flow, index) => {
    const gap = index === 0 && initialSpaceAfter === undefined
      ? 0 : collapseMargins(cursor.prevSpaceAfter, flow.spaceBefore);
    const startGlobalY = landingAfter(flow, cursor, gap, pageConfig, geometry);
    cursor = flowCursorAfter(flow, startGlobalY, pageConfig, geometry);
    return { ...flow, globalY: startGlobalY, originalGlobalY: startGlobalY };
  });
}

export function pageLocalYForGlobalY(
  geometry: PageGeometry,
  pageNumber: number,
  globalY: number,
): number {
  return geometry.metricsFor(pageNumber).contentTop + (globalY - geometry.startOf(pageNumber));
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
