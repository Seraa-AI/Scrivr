import { Plugin, Selection } from "prosemirror-state";
import type { Command, EditorState, Transaction } from "prosemirror-state";
import { keydownHandler } from "prosemirror-keymap";
import { Fragment } from "prosemirror-model";
import type { Node, ResolvedPos, Schema, Slice } from "prosemirror-model";
import { tableStructureCommands } from "./commands";
import { getTableMap } from "./TableMap";
import { selectedCells, enclosingCell, type ResolvedCellRange } from "./cellSelection";

/**
 * `tableEditingGuards` (Phase 5) — the editing-UX layer that sits on top of the
 * document-validity `tableIntegrityPlugin`. Where the integrity plugin keeps the
 * doc structurally valid, this plugin keeps *editing* faithful to Word/Docs:
 *
 *   - Tab / Shift-Tab move between cells; Tab past the last cell appends a row.
 *   - Backspace/Delete never escape a cell boundary (no accidental cell merges
 *     or table deletion); on a multi-cell selection they clear the cells.
 *   - Pasting into a multi-cell selection distributes into the rectangle rather
 *     than dropping the payload into one cell.
 *
 * Key handling lives in the plugin's `handleKeyDown` prop (not `addKeymap`) so
 * it is ordered before the merged extension keymap and can defer to
 * `BaseEditing`'s Backspace/Delete by returning false — no keymap collision.
 *
 * The individual `Command`s and transaction builders are exported so they can
 * be unit-tested headlessly on `ServerEditor`, without a view.
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

// ── Paste distribution ───────────────────────────────────────────────────────

function firstTableInSlice(slice: Slice): Node | null {
  const first = slice.content.firstChild;
  return first && first.type.name === "table" ? first : null;
}

/** Map each source cell's grid offset (TableMap space) to its block content. */
function sourceCellContents(table: Node): Map<number, Fragment> {
  const out = new Map<number, Fragment>();
  table.forEach((row, rowOffset) => {
    row.forEach((cell, cellOffsetInRow) => {
      out.set(rowOffset + 1 + cellOffsetInRow, cell.content);
    });
  });
  return out;
}

/** Coerce a pasted slice to cell-valid block content (wrap loose inline runs). */
function sliceAsBlocks(slice: Slice, schema: Schema): Fragment | null {
  if (slice.content.childCount === 0) return null;
  if (slice.content.firstChild?.isBlock) return slice.content;
  const para = schema.nodes["paragraph"];
  return para ? Fragment.from(para.create(null, slice.content)) : null;
}

/**
 * Content to drop into the target cell whose top-left grid cell is (dr, dc)
 * relative to the selection's top-left — matching by grid coordinate so a
 * pasted merged cell lands in the geometrically corresponding target, not the
 * n-th flattened cell. Null when the source has no cell at that coordinate.
 */
function payloadForTargetCell(
  srcTable: Node,
  target: { top: number; left: number },
  originTop: number,
  originLeft: number,
): Fragment | null {
  const srcMap = getTableMap(srcTable);
  const contents = sourceCellContents(srcTable);
  const srcOffset = srcMap.positionAt(target.top - originTop, target.left - originLeft);
  return srcOffset == null ? null : contents.get(srcOffset) ?? null;
}

/**
 * Distribute a paste into a multi-cell selection: a pasted table fills the
 * rectangle by grid coordinate (clipped to the target); any other payload fills
 * every selected cell with a copy. Cells with no matching source content — or
 * content invalid for a cell — are left untouched (never silently cleared).
 * Returns null when the selection is not a cell rectangle, so ordinary paste
 * proceeds.
 */
export function distributePasteTr(state: EditorState, slice: Slice): Transaction | null {
  const range = selectedCells(state);
  if (!range) return null;

  const srcTable = firstTableInSlice(slice);
  const blocks = srcTable ? null : sliceAsBlocks(slice, state.schema);
  const targets = [...range.cellPositions].sort((a, b) => a - b);

  let tr = state.tr;
  // Edit high→low so original positions stay valid across replacements.
  for (let i = targets.length - 1; i >= 0; i--) {
    const cellPos = targets[i]!;
    const cellNode = state.doc.nodeAt(cellPos);
    if (!cellNode) continue;

    let content: Fragment | null;
    if (srcTable) {
      const targetRect = range.map.findCell(cellPos - range.tableStart);
      content = payloadForTargetCell(srcTable, targetRect, range.rect.top, range.rect.left);
    } else {
      content = blocks;
    }
    if (!content || content.childCount === 0) continue;
    if (!cellNode.type.validContent(content)) continue; // leave invalid pastes untouched

    tr = tr.replaceWith(cellPos + 1, cellPos + cellNode.nodeSize - 1, content);
  }
  if (!tr.docChanged) return null;

  return landInCell(tr, targets[0]!);
}

// ── Plugin ───────────────────────────────────────────────────────────────────

/**
 * The editing-guards plugin. Key handling runs before the merged extension
 * keymap (plugin order) and defers to it on `false`; paste distribution
 * intercepts a paste into a cell rectangle.
 */
export function tableEditingGuards(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown: keydownHandler({
        Tab: tabToNextCell,
        "Shift-Tab": tabToPreviousCell,
        Backspace: guardBackspace,
        Delete: guardDelete,
      }),
      handlePaste(view, _event, slice) {
        const tr = distributePasteTr(view.state, slice);
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      },
    },
  });
}
