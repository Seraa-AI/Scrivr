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
  defaultFontConfig,
  type DocumentLayout,
  type FontConfig,
  type PageChromeMeasureInput,
  type ChromeContribution,
  type LayoutIterationContext,
} from "@scrivr/core";
import type { HeaderFooterPolicy, HeaderFooterDefinition } from "./types";
import { resolveSlot } from "./resolveSlot";

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
): SlotLayout | undefined {
  if (!def) return undefined;

  const schema = input.doc.type.schema;
  const miniDoc = schema.nodeFromJSON(def.content);

  const baseParagraph = defaultFontConfig["paragraph"];
  const chromeFontConfig: FontConfig = {
    ...defaultFontConfig,
    ...(baseParagraph ? {
      paragraph: {
        font: baseParagraph.font,
        align: baseParagraph.align,
        spaceBefore: 0,
        spaceAfter: 0,
      },
    } : {}),
  };

  const layout = runMiniPipeline(miniDoc, {
    pageConfig: input.pageConfig,
    measurer: input.measurer,
    fontConfig: chromeFontConfig,
  });

  const natural = layout.totalContentHeight ?? 0;
  const margin = def.margin ?? 12;
  const reservedHeight = Math.max(natural + margin, def.minHeight ?? 0);
  return { doc: miniDoc, layout, reservedHeight };
}

/**
 * Resolve all header/footer slots and return a ChromeContribution.
 * Heights vary by page (differentFirstPage) via topForPage/bottomForPage closures.
 */
export function resolveChrome(
  policy: HeaderFooterPolicy,
  input: PageChromeMeasureInput,
  _ctx: LayoutIterationContext,
): ChromeContribution {
  const resolved: ResolvedHeaderFooter = {
    policy,
    defaultMarginTop: input.pageConfig.margins.top,
    defaultMarginBottom: input.pageConfig.margins.bottom,
    slots: {
      defaultHeader: measureSlot(policy.defaultHeader, input),
      defaultFooter: measureSlot(policy.defaultFooter, input),
      firstPageHeader: policy.differentFirstPage
        ? measureSlot(policy.firstPageHeader, input)
        : undefined,
      firstPageFooter: policy.differentFirstPage
        ? measureSlot(policy.firstPageFooter, input)
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
