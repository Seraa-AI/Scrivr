/** Reading and writing the block-marker layer. */
import type { IBaseEditor } from "@scrivr/core";
import type { Node as PmNode } from "@scrivr/core/pm";
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
 * A marker whose block has left the document is left out — it names a block,
 * and there is nothing to anchor to once that block is gone — so a writer
 * never has to re-set after an edit.
 */
export function getBlockMarkers(editor: IBaseEditor): PlacedBlockMarker[] {
  return resolveMarkers(editor).map(({ marker }) => marker);
}

/**
 * The markers on the innermost marked block containing the cursor.
 *
 * Innermost, because every ancestor contains the cursor too: a paragraph
 * inside a marked list would otherwise report the list's finding as well, and
 * an overlay anchoring to the first of them paints a paragraph's marker at the
 * top of the whole list.
 *
 * The "activate" half of the lifecycle, kept as a function of state so it can
 * be asked headlessly. `activeBlockMarkerAnchor` answers the same question for
 * a surface that also needs the block to anchor against.
 */
export function activeBlockMarkers(editor: IBaseEditor): PlacedBlockMarker[] {
  return activeBlockMarkerAnchor(editor)?.markers ?? [];
}

/** The innermost marked block holding the cursor, its position, and its markers. */
export interface ActiveBlockMarkers {
  markers: PlacedBlockMarker[];
  node: PmNode;
  pos: number;
}

/**
 * `activeBlockMarkers` plus the block it resolved against.
 *
 * One document walk answers both. The overlay needs the node's position for a
 * rect, and looking it up again would be a second resolution of a fact this
 * already established — against a state it would have to re-read.
 */
export function activeBlockMarkerAnchor(editor: IBaseEditor): ActiveBlockMarkers | null {
  const { head } = editor.getState().selection;

  let best: ActiveBlockMarkers | null = null;
  for (const { marker, node, pos } of resolveMarkers(editor)) {
    if (head < pos || head > pos + node.nodeSize) continue;
    // Deeper means smaller: a descendant's range is contained in its
    // ancestor's, so the narrowest containing block is the innermost one.
    if (best && best.node.nodeSize <= node.nodeSize) {
      if (best.pos === pos && best.node === node) best.markers.push(marker);
      continue;
    }
    best = { markers: [marker], node, pos };
  }
  return best;
}

/**
 * Resolve every placed marker to the block it names, in one pass over the
 * document rather than one `findNodeById` walk per marker — the overlay asks
 * on every state change and every scroll.
 */
function resolveMarkers(
  editor: IBaseEditor,
): Array<{ marker: PlacedBlockMarker; node: PmNode; pos: number }> {
  const state = editor.getState();
  const bySource = blockMarkersPluginKey.getState(state);
  if (!bySource || bySource.size === 0) return [];

  const wanted = new Map<string, { node: PmNode; pos: number }>();
  for (const markers of bySource.values()) {
    for (const marker of markers) wanted.set(marker.nodeId, { node: state.doc, pos: -1 });
  }
  state.doc.descendants((node, pos) => {
    const id = node.attrs["nodeId"];
    if (typeof id === "string" && wanted.get(id)?.pos === -1) wanted.set(id, { node, pos });
    return true;
  });

  const out: Array<{ marker: PlacedBlockMarker; node: PmNode; pos: number }> = [];
  for (const markers of bySource.values()) {
    for (const marker of markers) {
      const found = wanted.get(marker.nodeId);
      if (found && found.pos !== -1) out.push({ marker, node: found.node, pos: found.pos });
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
