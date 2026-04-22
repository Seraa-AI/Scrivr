/**
 * Slot resolution — picks the correct header/footer definition for a given page.
 * Pure functions, no side effects.
 */

import type { HeaderFooterPolicy, HeaderFooterDefinition, SlotContext } from "./types";
import type { SlotKey } from "./surfaces";

/**
 * Resolve which HeaderFooterDefinition applies to a specific page.
 * Returns null when headers/footers are disabled or no slot matches.
 */
export function resolveSlot(
  policy: HeaderFooterPolicy | null,
  ctx: SlotContext,
  kind: "header" | "footer",
): HeaderFooterDefinition | null {
  if (!policy?.enabled) return null;

  const isFirst = ctx.pageNumber === 1;
  const isEven = ctx.pageNumber % 2 === 0;

  if (isFirst && policy.differentFirstPage) {
    return policy[kind === "header" ? "firstPageHeader" : "firstPageFooter"] ?? null;
  }
  if (isEven && policy.differentOddEven) {
    return policy[kind === "header" ? "evenPageHeader" : "evenPageFooter"] ?? null;
  }
  return policy[kind === "header" ? "defaultHeader" : "defaultFooter"] ?? null;
}

/**
 * Given a policy and page number, determine which SlotKey applies.
 * Shared by canvas rendering and PDF export.
 */
export function resolveSlotKey(
  policy: HeaderFooterPolicy,
  pageNumber: number,
  kind: "header" | "footer",
): SlotKey | null {
  const def = resolveSlot(policy, { pageNumber }, kind);
  if (!def) return null;
  if (kind === "header") {
    return def === policy.firstPageHeader ? "firstPageHeader" : "defaultHeader";
  }
  return def === policy.firstPageFooter ? "firstPageFooter" : "defaultFooter";
}
