import { Selection } from "prosemirror-state";
import type { Command, EditorState, Transaction } from "prosemirror-state";
import type { ResolvedPos } from "prosemirror-model";
import { tableStructureCommands } from "./commands";
import { clearCells, selectedCells, enclosingCell, type ResolvedCellRange } from "./cellSelection";

/**
 * Table editing-UX commands (Phase 5) — the layer that sits on top of the
 * document-validity `tableIntegrityPlugin` and keeps *editing* faithful to
 * Word/Docs:
 *
 *   - Tab / Shift-Tab move between cells; Tab past the last cell appends a row.
 *   - Backspace/Delete never escape a cell boundary (no accidental cell merges
 *     or table deletion); on a multi-cell selection they clear the cells.
 *
 * These are plain `Command`s (not a plugin): the canvas `InputBridge` dispatches
 * keys through the merged extension keymap, never through ProseMirror plugin
 * `handleKeyDown` props, so they are wired via `Table.addKeymap()` and chained
 * with the base Backspace/Delete + List/CodeBlock Tab in `StarterKit`. A guard
 * returns false when it doesn't apply, so the chain falls through. All are
 * exported for headless unit tests on `ServerEditor`.
 *
 * Paste distribution into a multi-cell selection is deferred to Phase 7 (its
 * seam is `PasteTransformer`, not this keymap layer).
 */

const structure = tableStructureCommands();

// ── Cell navigation (Tab / Shift-Tab) ────────────────────────────────────────

/** Move to the first cell of the table's last row (already appended in `tr`). */
function selectLastRowFirstCell(tr: Transaction, tablePos: number): Selection | null {
  const table = tr.doc.nodeAt(tablePos);
  if (!table || table.type.name !== "table" || table.childCount === 0) return null;
  let pos = tablePos + 1; // table content start
  for (let i = 0; i < table.childCount - 1; i++) pos += table.child(i).nodeSize;
  // pos → before last row; +1 into row, +1 into its first cell.
  return Selection.near(tr.doc.resolve(pos + 2), 1);
}

/**
 * Tab: advance to the next cell. At the last cell, append a row and land in its
 * first cell (Word's "Tab past the end grows the table"). Returns false when the
 * selection is not inside a table so other Tab handlers still run.
 */
export const tabToNextCell: Command = (state, dispatch) => {
  if (structure["goToNextCell"]!()(state, dispatch)) return true;

  const cell = enclosingCell(state);
  if (!cell) return false; // not in a table — defer to other handlers
  if (!dispatch) return true; // in the last cell: appending a row is possible

  structure["addRowAfter"]!()(state, (tr) => {
    const sel = selectLastRowFirstCell(tr, cell.tablePos);
    dispatch((sel ? tr.setSelection(sel) : tr).scrollIntoView());
  });
  return true;
};

/** Shift-Tab: move to the previous cell (no wrap past the first cell). */
export const tabToPreviousCell: Command = (state, dispatch) =>
  structure["goToPreviousCell"]!()(state, dispatch);

// ── Backspace / Delete guards ────────────────────────────────────────────────

/**
 * Empty every cell in `range` — a cell selection's, or a text selection's that
 * runs across cells — as `CellSelection.replace` does. Null when every cell
 * was already empty.
 */
function clearCellsTr(state: EditorState, range: ResolvedCellRange): Transaction | null {
  const tr = state.tr;
  clearCells(tr, range.cellPositions);
  return tr.docChanged ? tr.scrollIntoView() : null;
}

/**
 * The caret is at the very start of a cell when it sits at offset 0 of its
 * textblock AND every node on the path down from the cell is a first child —
 * otherwise a Backspace inside e.g. a nested list at the cell's top would be
 * wrongly swallowed instead of outdenting.
 */
function atCellStart(state: EditorState): boolean {
  if (!state.selection.empty) return false;
  const cell = enclosingCell(state);
  if (!cell) return false;
  const $head: ResolvedPos = state.selection.$head;
  for (let d = cell.cellDepth; d < $head.depth; d++) {
    if ($head.index(d) !== 0) return false;
  }
  return $head.parentOffset === 0;
}

/** Mirror of {@link atCellStart}: caret at the tail of the cell's last block. */
function atCellEnd(state: EditorState): boolean {
  if (!state.selection.empty) return false;
  const cell = enclosingCell(state);
  if (!cell) return false;
  const $head: ResolvedPos = state.selection.$head;
  for (let d = cell.cellDepth; d < $head.depth; d++) {
    if ($head.index(d) !== $head.node(d).childCount - 1) return false;
  }
  return $head.parentOffset === $head.parent.content.size;
}

/**
 * Backspace guard: clear a multi-cell selection, or swallow a Backspace that
 * would escape the top of a cell (which would otherwise merge cells / delete
 * the table). Returns false for ordinary in-cell deletion so `BaseEditing`
 * handles it.
 */
export const guardBackspace: Command = (state, dispatch) => {
  const range = selectedCells(state);
  if (range) {
    if (dispatch) {
      const tr = clearCellsTr(state, range);
      if (tr) dispatch(tr);
    }
    return true;
  }
  return atCellStart(state); // swallow at the boundary; else defer
};

/** Delete guard: mirror of {@link guardBackspace} at the cell's tail. */
export const guardDelete: Command = (state, dispatch) => {
  const range = selectedCells(state);
  if (range) {
    if (dispatch) {
      const tr = clearCellsTr(state, range);
      if (tr) dispatch(tr);
    }
    return true;
  }
  return atCellEnd(state);
};
