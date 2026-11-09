import { IMAGE_NODE_ATTRS, anchoredOf, type IBaseEditor } from "@scrivr/core";
import { findLiveNodeById, proposedForDeletion, trackAsSuggestion } from "@scrivr/plugins";
import type { SemanticImageAttrs } from "../schema/edit";

/** An agent's image layout as image node attrs: only what it set. */
export function imageNodeAttrs(attrs: SemanticImageAttrs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const nodeAttr: unknown = Reflect.get(IMAGE_NODE_ATTRS, key);
    if (value !== undefined && typeof nodeAttr === "string") out[nodeAttr] = value;
  }
  return out;
}

/** An image unit's new layout, addressed by the paragraph that holds the image. */
export interface ImageLayoutEdit {
  nodeId: string;
  attrs: SemanticImageAttrs;
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
    // A legacy `wrappingMode` outranks `wrapMode`/`xAlign`: write out what it
    // meant and retire it, so the layout the agent sets is the one that shows.
    const placed = anchoredOf(image);
    if (!placed) continue;
    const legacy = image.attrs["wrappingMode"] !== "inline"
      ? { wrapMode: placed.wrapMode, xAlign: placed.xAlign, wrappingMode: "inline" }
      : {};
    const next = { ...image.attrs, ...legacy, ...imageNodeAttrs(attrs) };
    if (Object.entries(next).every(([key, value]) => value === image.attrs[key])) continue;
    tr.setNodeMarkup(at, undefined, next, image.marks);
    changed.push(nodeId);
  }
  if (tr.docChanged) editor.applyTransaction(tr);
  return changed;
}
