import type { IBaseEditor } from "@scrivr/core";
import type { Node as PmNode } from "@scrivr/core/pm";
import { findLiveNodeById, trackAsSuggestion } from "@scrivr/plugins";
import type { SemanticImageAttrs } from "../schema/edit";

/** The image node's attribute for each layout attr an agent sets. */
const IMAGE_NODE_ATTR: Record<keyof SemanticImageAttrs, string> = {
  alt: "alt",
  width: "width",
  height: "height",
  wrap: "wrapMode",
  align: "xAlign",
};

/** An agent's image layout as image node attrs: only what it set. */
export function imageNodeAttrs(attrs: SemanticImageAttrs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, nodeAttr] of Object.entries(IMAGE_NODE_ATTR)) {
    const value: unknown = Reflect.get(attrs, key);
    if (value !== undefined) out[nodeAttr] = value;
  }
  return out;
}

/** An image unit's new layout, addressed by the paragraph that holds the image. */
export interface ImageLayoutEdit {
  nodeId: string;
  attrs: SemanticImageAttrs;
}

/** Whether an image's own records propose deleting it. */
function proposedForDeletion(image: PmNode): boolean {
  const records: unknown = image.attrs["dataTracked"];
  return Array.isArray(records) && records.some((record: unknown) =>
    typeof record === "object" && record !== null && "operation" in record && record.operation === "delete" &&
    "status" in record && record.status === "pending");
}

/**
 * Sets each image unit's layout in one transaction, as `authorID`'s tracked
 * suggestion whatever mode the person is in. Returns the ids it changed.
 */
export function applyImageLayout(editor: IBaseEditor, edits: ImageLayoutEdit[], authorID: string): string[] {
  const tr = trackAsSuggestion(editor.getState().tr, authorID);
  const changed: string[] = [];
  for (const { nodeId, attrs } of edits) {
    const found = findLiveNodeById(tr.doc, nodeId);
    if (!found) continue;
    let at = -1;
    found.node.forEach((child, offset) => {
      if (at < 0 && child.type.name === "image" && !proposedForDeletion(child)) at = found.pos + 1 + offset;
    });
    const image = at < 0 ? null : tr.doc.nodeAt(at);
    if (!image) continue;
    tr.setNodeMarkup(at, undefined, { ...image.attrs, ...imageNodeAttrs(attrs) }, image.marks);
    changed.push(nodeId);
  }
  if (tr.docChanged) editor.applyTransaction(tr);
  return changed;
}
