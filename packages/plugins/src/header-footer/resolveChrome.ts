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
}

function measureSlot(
  def: HeaderFooterDefinition | undefined,
  input: PageChromeMeasureInput,
): SlotLayout | undefined {
  if (!def) return undefined;

  const schema = input.doc.type.schema;
  const miniDoc = schema.nodeFromJSON(def.content);

  const chromeFontConfig = {
    ...defaultFontConfig,
    paragraph: { ...defaultFontConfig.paragraph, spaceBefore: 0, spaceAfter: 0 },
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

  return {
    topForPage: (pageNumber) => pickHeader(pageNumber)?.reservedHeight ?? 0,
    bottomForPage: (pageNumber) => pickFooter(pageNumber)?.reservedHeight ?? 0,
    payload: resolved,
    stable: true,
  };
}
