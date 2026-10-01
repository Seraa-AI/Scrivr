/**
 * Reading and writing the block-marker layer.
 *
 * A writer names itself on every call. That is what makes the layer additive:
 * several bridges write to the same document surface, none of them owns it,
 * and each should be able to replace what it said last without erasing what
 * the others are saying.
 */
import type { IBaseEditor } from "@scrivr/core";
import { findNodeById } from "../ai-toolkit/UniqueId";
import { blockMarkersPluginKey, BLOCK_MARKERS_SET } from "./BlockMarkersPlugin";
import type { BlockMarker, PlacedBlockMarker } from "./types";

/**
 * Replace everything `source` has placed with `markers`.
 *
 * Other writers' markers are untouched. Nothing is written to the document —
 * a marker is about a block, not in it — so this does not enter history and a
 * reader's undo never steps back through a review's findings.
 */
export function setBlockMarkers(
  editor: IBaseEditor,
  source: string,
  markers: readonly BlockMarker[],
): void {
  dispatch(editor, { source, markers: markers.map((m) => ({ ...m, source })) });
}

/** Remove everything `source` has placed, leaving other writers' markers. */
export function clearBlockMarkers(editor: IBaseEditor, source: string): void {
  dispatch(editor, { source, markers: null });
}

/**
 * Every marker currently placed, in source order and then in the order each
 * writer gave them.
 *
 * A marker whose block has left the document is left out: it names a block,
 * and there is nothing to anchor to once that block is gone. Filtering on read
 * rather than pruning on every transaction keeps the cost on the surface that
 * is about to paint, and means a writer never has to re-set after an edit.
 */
export function getBlockMarkers(editor: IBaseEditor): PlacedBlockMarker[] {
  const state = editor.getState();
  const bySource = blockMarkersPluginKey.getState(state);
  if (!bySource) return [];

  const out: PlacedBlockMarker[] = [];
  for (const markers of bySource.values()) {
    for (const marker of markers) {
      if (findNodeById(state.doc, marker.nodeId)) out.push(marker);
    }
  }
  return out;
}

function dispatch(
  editor: IBaseEditor,
  meta: { source: string; markers: readonly PlacedBlockMarker[] | null },
): void {
  editor.applyTransaction(
    editor.getState().tr.setMeta(BLOCK_MARKERS_SET, meta).setMeta("addToHistory", false),
  );
}

/**
 * The markers on the block the cursor is in.
 *
 * The "activate" half of the lifecycle, kept as a function of state so it can
 * be asked headlessly — the overlay controller is a thin shell over this plus
 * the block's rect.
 */
export function activeBlockMarkers(editor: IBaseEditor): PlacedBlockMarker[] {
  const state = editor.getState();
  const { head } = state.selection;

  return getBlockMarkers(editor).filter((marker) => {
    const found = findNodeById(state.doc, marker.nodeId);
    if (!found) return false;
    return head >= found.pos && head <= found.pos + found.node.nodeSize;
  });
}
