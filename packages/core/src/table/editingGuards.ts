import { Selection } from "prosemirror-state";
import type { Command, EditorState, Transaction } from "prosemirror-state";
import type { Node, ResolvedPos, Schema } from "prosemirror-model";
import { tableStructureCommands } from "./commands";
import { selectedCells, enclosingCell, type ResolvedCellRange } from "./cellSelection";

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

function emptyParagraph(schema: Schema): Node | null {
  return schema.nodes["paragraph"]?.create() ?? null;
}

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
 * Replace every cell in `range` with an empty paragraph, collapsing the
 * selection into the top-left cell. Cells are cleared from the original doc's
 * positions in descending order, so each edit leaves the lower positions valid.
 */
function clearCellsTr(state: EditorState, range: ResolvedCellRange): Transaction | null {
  const para = emptyParagraph(state.schema);
  if (!para) return null;

  let tr = state.tr;
  const descending = [...range.cellPositions].sort((a, b) => b - a);
  for (const cellPos of descending) {
    const cellNode = state.doc.nodeAt(cellPos);
    if (!cellNode) continue;
    const from = cellPos + 1;
    const to = cellPos + cellNode.nodeSize - 1;
    // Skip cells that are already a single empty paragraph — nothing to clear.
    if (cellNode.childCount === 1 && cellNode.firstChild?.content.size === 0) continue;
    tr = tr.replaceWith(from, to, para);
  }
  if (!tr.docChanged) return null;

  // The top-left cell has the smallest position and nothing before it was
  // edited, so its start is stable — land the caret at its content start
  // directly rather than mapping a position through its own replacement.
  const firstCell = Math.min(...range.cellPositions);
  return landInCell(tr, firstCell);
}

/** Collapse the selection to the start of the cell at `cellPos` in `tr.doc`. */
function landInCell(tr: Transaction, cellPos: number): Transaction {
  const target = Math.min(cellPos + 2, tr.doc.content.size);
  return tr.setSelection(Selection.near(tr.doc.resolve(target), 1)).scrollIntoView();
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
