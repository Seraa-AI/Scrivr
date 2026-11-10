import { IMAGE_NODE_ATTRS, anchoredOf, placementAttrs, semanticImage, type IBaseEditor, type PlacementPatch } from "@scrivr/core";
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
      if (at < 0 && semanticImage(child) && !proposedForDeletion(child)) at = found.pos + 1 + offset;
    });
    const image = at < 0 ? null : tr.doc.nodeAt(at);
    if (!image) continue;
    // The layout goes through the node's own declaration. A new wrap, alignment
    // or size is written with the resolved wrap and alignment, so a layout the
    // node holds from older attrs cannot outrank the one the agent sets.
    const placed = anchoredOf(image);
    if (!placed) continue;
    const patch: PlacementPatch = {
      ...(attrs.wrap !== undefined ? { wrapMode: attrs.wrap } : {}),
      ...(attrs.align !== undefined ? { xAlign: attrs.align } : {}),
      ...(attrs.width !== undefined ? { width: attrs.width } : {}),
      ...(attrs.height !== undefined ? { height: attrs.height } : {}),
    };
    const placing = Object.keys(patch).length > 0
      ? placementAttrs(image, { wrapMode: placed.wrapMode, xAlign: placed.xAlign, ...patch }) ?? {}
      : {};
    const next = { ...image.attrs, ...placing, ...(attrs.alt !== undefined ? { alt: attrs.alt } : {}) };
    if (Object.entries(next).every(([key, value]) => value === image.attrs[key])) continue;
    tr.setNodeMarkup(at, undefined, next, image.marks);
    changed.push(nodeId);
  }
  if (tr.docChanged) editor.applyTransaction(tr);
  return changed;
}
