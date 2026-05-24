/**
 * resolveChrome — measures header/footer slots via runMiniPipeline and returns
 * a ChromeContribution with per-page height reservations.
 *
 * Called from addPageChrome().measure(). Always returns stable:true because
 * header/footer heights don't depend on flow content layout.
 */

import type { Node } from "prosemirror-model";
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

/** Measured layout + reserved height for one header/footer slot. */
export interface SlotLayout {
  /** The parsed PM doc node — kept for re-layout at different Y positions during rendering. */
  doc: Node;
  layout: DocumentLayout;
  reservedHeight: number;
}

/** Payload stashed on ChromeContribution and routed to render(). */
export interface ResolvedHeaderFooter {
  slots: {
    defaultHeader?: SlotLayout | undefined;
    defaultFooter?: SlotLayout | undefined;
    firstPageHeader?: SlotLayout | undefined;
    firstPageFooter?: SlotLayout | undefined;
  };
  policy: HeaderFooterPolicy;
  /** Fallback marginTop from pageConfig — used when definition.marginTop is not set. */
  defaultMarginTop: number;
  /** Fallback marginBottom from pageConfig. */
  defaultMarginBottom: number;
}

function measureSlot(
  def: HeaderFooterDefinition | undefined,
  input: PageChromeMeasureInput,
  activeEditingGap: number,
): SlotLayout | undefined {
  if (!def) return undefined;

  const schema = input.doc.type.schema;
  const miniDoc = schema.nodeFromJSON(def.content);

  const layout = runMiniPipeline(miniDoc, {
    pageConfig: input.pageConfig,
    measurer: input.measurer,
    fontConfig: chromeFontConfig,
  });

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
  return { doc: miniDoc, layout, reservedHeight };
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
  _ctx: LayoutIterationContext,
  activeEditingGap: number,
): ChromeContribution {
  const resolved: ResolvedHeaderFooter = {
    policy,
    defaultMarginTop: input.pageConfig.margins.top,
    defaultMarginBottom: input.pageConfig.margins.bottom,
    slots: {
      defaultHeader: measureSlot(policy.defaultHeader, input, activeEditingGap),
      defaultFooter: measureSlot(policy.defaultFooter, input, activeEditingGap),
      firstPageHeader: policy.differentFirstPage
        ? measureSlot(policy.firstPageHeader, input, activeEditingGap)
        : undefined,
      firstPageFooter: policy.differentFirstPage
        ? measureSlot(policy.firstPageFooter, input, activeEditingGap)
        : undefined,
    },
  };

  const pickHeader = (pageNumber: number): SlotLayout | undefined => {
    const def = resolveSlot(policy, { pageNumber }, "header");
    if (!def) return undefined;
    if (def === policy.firstPageHeader) return resolved.slots.firstPageHeader;
    return resolved.slots.defaultHeader;
  };

  const pickFooter = (pageNumber: number): SlotLayout | undefined => {
    const def = resolveSlot(policy, { pageNumber }, "footer");
    if (!def) return undefined;
    if (def === policy.firstPageFooter) return resolved.slots.firstPageFooter;
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
  const hasHeader = policy.differentFirstPage
    ? !!(policy.defaultHeader && policy.firstPageHeader)
    : !!policy.defaultHeader;
  const hasFooter = policy.differentFirstPage
    ? !!(policy.defaultFooter && policy.firstPageFooter)
    : !!policy.defaultFooter;

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
    stable: true,
  };
}
