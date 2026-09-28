/**
 * resolveChrome — measures header/footer slots via runMiniPipeline and returns
 * a ChromeContribution with per-page height reservations.
 *
 * Called from addPageChrome().measure(). Page-count tokens can widen and wrap
 * a band, changing its height and pagination. The aggregator feeds that flow
 * back until the measured bands and the resulting pages agree.
 */

import type { Node } from "@scrivr/core/pm";
import {
  runMiniPipeline,
  type DocumentLayout,
  type PageChromeMeasureInput,
  type ChromeContribution,
  type LayoutIterationContext,
} from "@scrivr/core";
import type { HeaderFooterPolicy, HeaderFooterDefinition } from "./types";
import { resolveSlot } from "./resolveSlot";
import { chromeFontConfig } from "./chromeFontConfig";
import {
  setTokenContext,
  arrangedForPage,
  digitsIn,
  PAGE_COUNT_TOKENS,
  PER_PAGE_TOKEN,
} from "./tokenStrategies";

/** Measured layout + reserved height for one header/footer slot. */
export interface SlotLayout {
  /** The parsed PM doc node — kept for re-layout at different Y positions during rendering. */
  doc: Node;
  /** The widest arrangement, and what the band reserves room for. */
  layout: DocumentLayout;
  /**
   * One arrangement per page-number width, keyed by digit count.
   *
   * A band is measured once and painted on every page, so a page number's box
   * has to hold the longest number in the document — leaving "2 of 1040" with
   * three digits of empty space before " of ". Word has no such gap because it
   * lays each page's header out separately.
   *
   * A token is sized as widest-digit times digit count, so the only thing that
   * moves between pages is how many digits the number has. That makes the
   * distinct arrangements few enough to measure up front — four for a
   * thousand-page document — and leaves painting a lookup.
   */
  byDigits?: ReadonlyMap<number, DocumentLayout>;
  reservedHeight: number;
}

/** The arrangement to paint page `pageNumber` with. */
export function slotLayoutForPage(slot: SlotLayout, pageNumber: number): DocumentLayout {
  if (!slot.byDigits) return slot.layout;
  // Reachable when the aggregator exhausts: the accepted payload was measured
  // against the previous iteration's flow, so a document that grew past a digit
  // boundary on the last iteration asks for an arrangement nobody measured.
  // The widest is then a digit short and the number overruns it — the same
  // overflow as before any of this, and better than a band that does not paint.
  return slot.byDigits.get(digitsIn(pageNumber)) ?? slot.layout;
}

/** Payload stashed on ChromeContribution and routed to render(). */
export interface ResolvedHeaderFooter {
  slots: {
    defaultHeader?: SlotLayout | undefined;
    defaultFooter?: SlotLayout | undefined;
    firstPageHeader?: SlotLayout | undefined;
    firstPageFooter?: SlotLayout | undefined;
    evenPageHeader?: SlotLayout | undefined;
    evenPageFooter?: SlotLayout | undefined;
  };
  policy: HeaderFooterPolicy;
  /** Fallback marginTop from pageConfig — used when definition.marginTop is not set. */
  defaultMarginTop: number;
  /** Fallback marginBottom from pageConfig. */
  defaultMarginBottom: number;
}

/** Narrows a ChromeContribution payload back to this contributor's own. */
export function isResolvedHeaderFooter(value: unknown): value is ResolvedHeaderFooter {
  if (typeof value !== "object" || value === null) return false;
  return "policy" in value && "slots" in value;
}

/** Whether a mini-doc holds any node in `types`. */
function holds(miniDoc: Node, types: ReadonlySet<string>): boolean {
  let found = false;
  miniDoc.descendants((node) => {
    if (types.has(node.type.name)) found = true;
    return !found;
  });
  return found;
}

/** Whether any slot holds a token whose width follows the document's page count. */
function countsPages(slots: ResolvedHeaderFooter["slots"]): boolean {
  return Object.values(slots).some(
    (slot) => slot !== undefined && holds(slot.doc, PAGE_COUNT_TOKENS),
  );
}

const PER_PAGE_TOKENS: ReadonlySet<string> = new Set([PER_PAGE_TOKEN]);

function measureSlot(
  def: HeaderFooterDefinition | undefined,
  input: PageChromeMeasureInput,
  activeEditingGap: number,
  totalPages: number,
): SlotLayout | undefined {
  if (!def) return undefined;

  const schema = input.doc.type.schema;
  const miniDoc = schema.nodeFromJSON(def.content);

  const arrange = (): DocumentLayout => runMiniPipeline(miniDoc, {
    pageConfig: input.pageConfig,
    measurer: input.measurer,
    fontConfig: chromeFontConfig,
    ...(input.fonts ? { fonts: input.fonts } : {}),
    ...(input.fontModifiers ? { fontModifiers: input.fontModifiers } : {}),
    // Required, not optional: the tokens declare no size of their own, so
    // without their strategies there is nothing to reserve and they vanish.
    ...(input.inlineRegistry ? { inlineRegistry: input.inlineRegistry } : {}),
  });

  const widest = digitsIn(totalPages);
  // Measured widest-first so `layout` — what the band reserves against — is
  // the tallest arrangement any page can need.
  const layout = arrangedForPage(totalPages, arrange);

  let byDigits: Map<number, DocumentLayout> | undefined;
  // Only a page number differs from page to page. A band holding just the
  // total prints one string everywhere, so arranging it repeatedly would
  // produce identical layouts at the cost of a mini-pipeline apiece.
  if (widest > 1 && holds(miniDoc, PER_PAGE_TOKENS)) {
    byDigits = new Map([[widest, layout]]);
    for (let digits = 1; digits < widest; digits++) {
      // Any number of this width does: the token reserves widest-digit times
      // digit count, so every number with the same digit count arranges alike.
      byDigits.set(digits, arrangedForPage(10 ** (digits - 1), arrange));
    }
  }

  const natural = layout.totalContentHeight ?? 0;
  // Floor + default in one expression:
  //   def.margin === undefined → margin = activeEditingGap
  //   def.margin >= activeEditingGap → margin = def.margin
  //   def.margin <  activeEditingGap → margin = activeEditingGap
  //
  // One number expresses "the editing affordance is N px tall,
  // reserve N below header content," so the body never shifts when
  // a surface activates. Headless callers pass 0 to honor slot.margin
  // verbatim (no whitespace reserved for a UI that isn't drawn).
  //
  // This is the single place the floor is applied. The value becomes
  // part of `reservedHeight` below, which the chrome aggregator folds
  // into `metrics.contentTop`. Every downstream consumer (canvas
  // paint, PDF chrome render) reads those metrics unchanged — there
  // is no per-render override of the gap.
  const margin = Math.max(def.margin ?? activeEditingGap, activeEditingGap);
  const reservedHeight = Math.max(natural + margin, def.minHeight ?? 0);
  return { doc: miniDoc, layout, ...(byDigits ? { byDigits } : {}), reservedHeight };
}

/**
 * Resolve all header/footer slots and return a ChromeContribution.
 * Heights vary by page (`differentFirstPage`) via the `topForPage` /
 * `bottomForPage` closures.
 *
 * `activeEditingGap` — minimum pixels reserved between header content
 * and body. The React `HeaderFooterRibbon` overlays this gap while a
 * surface is active, so the default React wiring passes 28 (the
 * ribbon's height). Headless callers (PDF-only `ServerEditor`,
 * non-React renders) pass 0 to honor each slot's `margin` as-is
 * without reserving whitespace for a UI that isn't drawn.
 *
 * The value is plumbed in from `HeaderFooter.configure({
 * activeEditingGap })` via `addPageChrome().measure`, applied in
 * `measureSlot`, and baked into `slot.reservedHeight`. The layout
 * aggregator folds that into `metrics.contentTop`; both canvas paint
 * and PDF chrome render read those metrics unchanged. Decided once
 * per layout run, no later override — see the `HeaderFooterOptions`
 * docstring for the dual-use editor caveat.
 */
export function resolveChrome(
  policy: HeaderFooterPolicy,
  input: PageChromeMeasureInput,
  ctx: LayoutIterationContext,
  activeEditingGap: number,
): ChromeContribution {
  // How many pages the document has decides how wide a page-number token can
  // get, and measureSlot arranges the band once per width from it. Read it from
  // the flow rather than the token context, which paint rewrites per page as it
  // draws — otherwise a measurement answers from whichever page was drawn last.
  //
  // Only this run's flow counts as knowing. A remembered count is a starting
  // guess: the previous run's may predate the edit being laid out, and while a
  // document streams in it belongs to a partial layout — a lower bound, so a
  // late page falls back to the widest arrangement until the final chunk.
  // Accepted deliberately: nothing better exists mid-stream, and refusing it
  // would make every chunk exhaust the aggregator instead of converging.
  const verifiedPageCount = ctx.currentFlowLayout?.pages.length ?? null;
  const assumedPageCount =
    verifiedPageCount ?? ctx.previousRunFlowLayout?.pages.length ?? 1;

  const resolved: ResolvedHeaderFooter = {
    policy,
    defaultMarginTop: input.pageConfig.margins.top,
    defaultMarginBottom: input.pageConfig.margins.bottom,
    slots: {
      defaultHeader: measureSlot(policy.defaultHeader, input, activeEditingGap, assumedPageCount),
      defaultFooter: measureSlot(policy.defaultFooter, input, activeEditingGap, assumedPageCount),
      firstPageHeader: policy.differentFirstPage
        ? measureSlot(policy.firstPageHeader, input, activeEditingGap, assumedPageCount)
        : undefined,
      firstPageFooter: policy.differentFirstPage
        ? measureSlot(policy.firstPageFooter, input, activeEditingGap, assumedPageCount)
        : undefined,
      evenPageHeader: policy.differentOddEven
        ? measureSlot(policy.evenPageHeader, input, activeEditingGap, assumedPageCount)
        : undefined,
      evenPageFooter: policy.differentOddEven
        ? measureSlot(policy.evenPageFooter, input, activeEditingGap, assumedPageCount)
        : undefined,
    },
  };

  const pickHeader = (pageNumber: number): SlotLayout | undefined => {
    const def = resolveSlot(policy, { pageNumber }, "header");
    if (!def) return undefined;
    if (def === policy.firstPageHeader) return resolved.slots.firstPageHeader;
    if (def === policy.evenPageHeader) return resolved.slots.evenPageHeader;
    return resolved.slots.defaultHeader;
  };

  const pickFooter = (pageNumber: number): SlotLayout | undefined => {
    const def = resolveSlot(policy, { pageNumber }, "footer");
    if (!def) return undefined;
    if (def === policy.firstPageFooter) return resolved.slots.firstPageFooter;
    if (def === policy.evenPageFooter) return resolved.slots.evenPageFooter;
    return resolved.slots.defaultFooter;
  };

  // topForPage returns the FULL distance from page edge to contentTop:
  //   marginTop (where header band starts) + reservedHeight (content + gap)
  // This replaces margins.top — header owns the top of the page.
  const headerTopForPage = (pageNumber: number): number => {
    const slot = pickHeader(pageNumber);
    if (!slot) return 0;
    const def = resolveSlot(policy, { pageNumber }, "header");
    const marginTop = def?.marginTop ?? input.pageConfig.margins.top;
    return marginTop + slot.reservedHeight;
  };

  const footerBottomForPage = (pageNumber: number): number => {
    const slot = pickFooter(pageNumber);
    if (!slot) return 0;
    const def = resolveSlot(policy, { pageNumber }, "footer");
    const marginBottom = def?.marginBottom ?? input.pageConfig.margins.bottom;
    return marginBottom + slot.reservedHeight;
  };

  // A contributor replaces the margin only when it guarantees a non-zero
  // value on every possible page. When differentFirstPage is true, page 1
  // uses the first-page slot and pages 2+ use the default slot — both must
  // exist. Without this, the missing slot returns topForPage=0, and
  // replacesTopMargin causes contentTop=0 (body flush to page edge).
  const hasHeader = !!policy.defaultHeader &&
    (!policy.differentFirstPage || !!policy.firstPageHeader) &&
    (!policy.differentOddEven || !!policy.evenPageHeader);
  const hasFooter = !!policy.defaultFooter &&
    (!policy.differentFirstPage || !!policy.firstPageFooter) &&
    (!policy.differentOddEven || !!policy.evenPageFooter);

  return {
    topForPage: headerTopForPage,
    bottomForPage: footerBottomForPage,
    replacesTopMargin: hasHeader,
    replacesBottomMargin: hasFooter,
    topBandStart: (pageNumber: number) => {
      const def = resolveSlot(policy, { pageNumber }, "header");
      return def?.marginTop ?? input.pageConfig.margins.top;
    },
    bottomBandStart: (pageNumber: number) => {
      const def = resolveSlot(policy, { pageNumber }, "footer");
      return def?.marginBottom ?? input.pageConfig.margins.bottom;
    },
    payload: resolved,
    // This measurement is valid for the flow we were shown. If a wider token
    // wraps the band and causes new pagination, the aggregator must give us
    // that new flow before accepting convergence.
    stable: verifiedPageCount !== null || !countsPages(resolved.slots),
  };
}
