/**
 * Where flows sit in continuous global-Y: the page geometry that both
 * pagination and the anchored-object solver build on.
 */
import type { PageGeometry } from "./PageMetrics";
import { fitLinesInCapacity } from "./splitLines";
import type { FlowBlock, PageConfig } from "./PageLayout";

/**
 * Global Y of the start of the first page strictly below `y`. A content bottom
 * exactly on a page boundary belongs to the page above (it rendered there), so
 * the break advances one page past it — matching `paginateFlow`, which always
 * advances exactly one page per forced break.
 */
function nextPageStartAfter(
  geometry: PageGeometry,
  y: number,
  breakType: FlowBlock["pageBreakType"],
): number {
  let contentPage = geometry.pageAt(y);
  if (contentPage > 1 && geometry.startOf(contentPage) === y) {
    contentPage -= 1;
  }
  return geometry.startOf(targetPageNumber(contentPage, breakType));
}

export function targetPageNumber(
  currentPage: number,
  breakType: FlowBlock["pageBreakType"],
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
  if (flow.isPageBreak && !pageConfig.pageless) {
    const start = nextPageStartAfter(geometry, naturalStart, flow.pageBreakType);
    return { startGlobalY: start, endGlobalY: start + flow.height };
  }
  if (pageConfig.pageless) {
    return { startGlobalY: naturalStart, endGlobalY: naturalStart + flow.height };
  }

  const pageOf = (g: number): number => geometry.pageAt(g);
  const pageStart = (p: number): number => geometry.startOf(p);
  const pageBottom = (p: number): number => geometry.bottomOf(p);

  // Atomic blocks (image / hr / tableRow) never split: if the block overflows
  // its page and fits on a fresh one, it moves whole (the gap). `paginateFlow`
  // keeps a too-tall block or a first-on-page block where it is.
  const isAtomic = flow.kind === "leaf" || flow.kind === "tableRow";
  if (isAtomic || flow.lines.length === 0) {
    let start = naturalStart;
    const page = pageOf(start);
    const atTop = start === pageStart(page);
    const tooTall = flow.height > geometry.metricsFor(page).contentHeight;
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

/** Where the flow after this one continues from. */
export interface FlowCursor {
  y: number;
  prevSpaceAfter: number;
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
  return {
    y: advanceFlowGlobalY(flow, startGlobalY, pageConfig, geometry).endGlobalY,
    prevSpaceAfter: flow.isPageBreak ? 0 : flow.spaceAfter,
  };
}

/**
 * Whether a first line `lineHeight` tall fits when the gap before it is given
 * up and it starts right where its predecessor ended.
 */
export function fitsWithoutGap(pageBottom: number, prevEnd: number, lineHeight: number): boolean {
  return pageBottom - prevEnd >= lineHeight - 0.5;
}

/**
 * Where a flow starts when its predecessor ends at `prevEnd` and the collapsed
 * gap before it is `gap` — where `paginateFlow` paints it:
 * - a gap that reaches the bottom of the page the predecessor ended on is
 *   dropped, and the flow starts the next page;
 * - a first line that does not fit gives up the gap if that is enough,
 *   and otherwise starts the next page.
 * The first line is the flow's own, so a flow laid out again is landed again.
 */
export function landingAfter(
  flow: FlowBlock,
  prevEnd: number,
  gap: number,
  pageConfig: PageConfig,
  geometry: PageGeometry,
): number {
  const start = prevEnd + gap;
  if (pageConfig.pageless || flow.isPageBreak) {
    return advanceFlowGlobalY(flow, start, pageConfig, geometry).startGlobalY;
  }
  let page = geometry.pageAt(prevEnd);
  if (page > 1 && geometry.startOf(page) === prevEnd) page -= 1;
  const bottom = geometry.bottomOf(page);
  if (start >= bottom) return geometry.startOf(page + 1);

  const firstLine = flow.kind === "text" ? flow.lines[0] : undefined;
  if (!firstLine) return advanceFlowGlobalY(flow, start, pageConfig, geometry).startGlobalY;
  if (start === geometry.startOf(page) || start + firstLine.lineHeight <= bottom) return start;
  if (gap > 0 && fitsWithoutGap(bottom, prevEnd, firstLine.lineHeight)) return prevEnd;
  return geometry.startOf(page + 1);
}

/**
 * Stamp each flow with its continuous-flow Y.
 *
 * Omitting `initialSpaceAfter` means the document's first flow, whose leading
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
): FlowBlock[] {
  let y = initialY;
  let prevSpaceAfter = initialSpaceAfter ?? 0;

  return flows.map((flow, index) => {
    const gap = index === 0 && initialSpaceAfter === undefined
      ? 0 : collapseMargins(prevSpaceAfter, flow.spaceBefore);
    const startGlobalY = landingAfter(flow, y, gap, pageConfig, geometry);
    ({ y, prevSpaceAfter } = flowCursorAfter(flow, startGlobalY, pageConfig, geometry));
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
