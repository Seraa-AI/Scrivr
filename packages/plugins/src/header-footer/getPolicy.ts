/**
 * Shared policy accessor — validates shape before returning.
 * Used by both the HeaderFooter extension and the HeaderFooterController.
 */

import type { Node } from "prosemirror-model";
import type { IBaseEditor } from "@scrivr/core";
import type { HeaderFooterPolicy } from "./types";

/** Runtime shape check — returns true only for objects that look like a HeaderFooterPolicy. */
function isHeaderFooterPolicy(val: unknown): val is HeaderFooterPolicy {
  if (typeof val !== "object" || val === null) return false;
  if (!("enabled" in val) || typeof (val as Record<string, unknown>)["enabled"] !== "boolean") return false;
  if (!("differentFirstPage" in val)) return false;
  if (!("differentOddEven" in val)) return false;
  return true;
}

/** Read the headerFooter policy from a PM doc node with shape validation. */
export function getHeaderFooterPolicy(doc: Node): HeaderFooterPolicy | null {
  if (!("headerFooter" in doc.attrs)) return null;
  const val = doc.attrs["headerFooter"];
  return isHeaderFooterPolicy(val) ? val : null;
}

/** Read the policy from an editor's current state. */
export function getPolicyFromEditor(editor: IBaseEditor): HeaderFooterPolicy | null {
  return getHeaderFooterPolicy(editor.getState().doc);
}
