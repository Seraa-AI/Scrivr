import { Mapping, NodeSelection, Selection, Transaction, type Node } from "@scrivr/core/pm";

/** What one round of replay learned about where the selection belongs. */
export type ReplayedSelection = {
  /** Replay map index of each restamp, to the index of the undo it mirrors. */
  restamps: Map<number, number>;
  /** Where the caret belongs, in the replayed document after `replayedMaps` maps. */
  caretAfterStep?: { pos: number; replayedMaps: number };
};

/**
 * The same node written back: everything but its tracking records matches. An
 * id counts only once both have one; the copy can predate the id's assignment.
 */
const writtenBack = (copy: Node | null, node: Node) => {
  if (!copy || copy.type !== node.type || !copy.content.eq(node.content)) return false;
  const { dataTracked: _, nodeId: copyId, ...copyAttrs } = copy.attrs;
  const { dataTracked: __, nodeId: selectedId, ...nodeAttrs } = node.attrs;
  return JSON.stringify(copyAttrs) === JSON.stringify(nodeAttrs) && (!copyId || !selectedId || copyId === selectedId);
};

/**
 * Carries the selection through a round of replay. The replay undoes a step and
 * writes the same content back, so the two are declared mirrors: a position
 * inside that content comes out inside it, which keeps a range a range and a
 * selected node selected.
 *
 * A caret that trailed a step is the case mapping cannot answer: at the edge of
 * undone content it maps past what the undo put back, so it goes where the
 * tracker reports. A selected node taken out and written back is re-selected.
 * Runs once per round, since a round can replay several transactions.
 */
export function fixAndSetSelectionAfterTracking(
  newTr: Transaction,
  selection: Selection,
  { restamps, caretAfterStep: caret }: ReplayedSelection,
) {
  if (restamps.size) {
    const mapping = new Mapping();
    newTr.mapping.maps.forEach((map, index) => mapping.appendMap(map, restamps.get(index)));
    newTr.setSelection(selection.map(newTr.doc, mapping));
  }
  if (selection instanceof NodeSelection && !(newTr.selection instanceof NodeSelection)) {
    // Either edge can sit inside what the undo spanned; the other then still
    // lands against the copy.
    const candidates = [
      newTr.mapping.map(selection.from, -1),
      newTr.mapping.map(selection.to, 1) - selection.node.nodeSize,
    ];
    const pos = candidates.find(at => writtenBack(newTr.doc.nodeAt(at), selection.node));
    if (pos !== undefined) {
      newTr.setSelection(NodeSelection.create(newTr.doc, pos));
      return;
    }
  }
  if (!caret) return;

  const pos = newTr.mapping.slice(caret.replayedMaps).map(caret.pos, -1);
  if (pos <= newTr.doc.content.size) {
    newTr.setSelection(Selection.near(newTr.doc.resolve(pos), -1));
  }
}
