/**
 * Slot resolution — picks the correct header/footer definition for a given page.
 * Pure function, no side effects, no imports beyond types.
 */

import type { HeaderFooterPolicy, HeaderFooterDefinition, SlotContext } from "./types";

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
