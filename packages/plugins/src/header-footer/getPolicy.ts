/**
 * Shared policy accessor — validates shape before returning.
 * Used by both the HeaderFooter extension and the HeaderFooterController.
 */

import type { Node } from "prosemirror-model";
import type { IBaseEditor } from "@scrivr/core";
import type { HeaderFooterPolicy } from "./types";

/** Read the headerFooter policy from a PM doc node with shape validation. */
export function getHeaderFooterPolicy(doc: Node): HeaderFooterPolicy | null {
  if (!("headerFooter" in doc.attrs)) return null;
  const val = doc.attrs["headerFooter"];
  if (typeof val !== "object" || val === null) return null;
  if (!("enabled" in val)) return null;
  return val as HeaderFooterPolicy;
}

/** Read the policy from an editor's current state. */
export function getPolicyFromEditor(editor: IBaseEditor): HeaderFooterPolicy | null {
  return getHeaderFooterPolicy(editor.getState().doc);
}
