import { Selection, TextSelection } from "prosemirror-state";
import type { Command, EditorState } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { getTableMap, type Rect, type TableMap } from "./TableMap";

/**
 * Structural table commands: add/delete row, add/delete column, and cell
 * navigation. These edit the document tree only — layout, rendering, and cell
 * selection live elsewhere.
 *
 * Edits are expressed as fine-grained `setNodeMarkup` / `insert` / `delete`
 * steps against the original document rather than a whole-table rebuild. This
 * keeps surviving cells as the same `Node` instances, so the measurement cache
 * (keyed on cell-node identity) and the `TableMap` WeakMap stay warm across
 * structural commands.
 *
 * `tableIntegrityPlugin` runs after every command and repairs any residual
 * drift (broken vMerge chains, grid/row-width mismatch), so each command only
 * needs to produce a structurally reasonable result — not a perfectly
 * normalised one.
 */

const DEFAULT_COLUMN_WIDTH = 100; // CSS px — matches the insert/normalise default.

interface CellContext {
  /** The enclosing `table` node. */
  table: Node;
  /** Absolute document position of the table node (the slot before it). */
  tablePos: number;
  /** Absolute position just inside the table — i.e. before its first row. */
  tableStart: number;
  /** Grid view of the table. */
  map: TableMap;
  /** The `tableRow` node containing the selection. */
  rowNode: Node;
  /** Absolute position of that row node. */
  rowPos: number;
  /** Grid index of the row containing the selection. */
  rowIndex: number;
  /** Grid bounding rect of the cell containing the selection. */
  rect: Rect;
}

function isCell(node: Node): boolean {
  return node.type.name === "tableCell" || node.type.name === "tableHeader";
}

function readGridSpan(cell: Node): number {
  const v = cell.attrs["gridSpan"];
  if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 1) return v;
  return 1;
}

function readGrid(table: Node): number[] {
  const v = table.attrs["grid"];
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) if (typeof x === "number" && Number.isFinite(x)) out.push(x);
  return out;
}

/** Slot lookup that tolerates `noUncheckedIndexedAccess`; `-1` = empty slot. */
function slotAt(map: TableMap, row: number, col: number): number {
  return map.map[row * map.width + col] ?? -1;
}

/** Absolute position of the row node at grid index `idx` (or table end). */
function rowStartPos(table: Node, tableStart: number, idx: number): number {
  let pos = tableStart;
  for (let i = 0; i < idx; i++) pos += table.child(i).nodeSize;
  return pos;
}

function physicalCellColumn(rowNode: Node, rowPos: number, cellPos: number): number | null {
  let col = 0;
  let pos = rowPos + 1;
  for (let i = 0; i < rowNode.childCount; i++) {
    const cell = rowNode.child(i);
    if (pos === cellPos) return col;
    col += readGridSpan(cell);
    pos += cell.nodeSize;
  }
  return null;
}

function rectForCell(
  map: TableMap,
  rowNode: Node,
  rowPos: number,
  tableStart: number,
  rowIndex: number,
  cellPos: number,
): Rect | null {
  const cellOffset = cellPos - tableStart;
  try {
    return map.findCell(cellOffset);
  } catch {
    const col = physicalCellColumn(rowNode, rowPos, cellPos);
    if (col == null) return null;
    const occupyingOffset = slotAt(map, rowIndex, col);
    if (occupyingOffset === -1) return null;
    try {
      const rect = map.findCell(occupyingOffset);
      return { left: col, top: rowIndex, right: col + (rect.right - rect.left), bottom: rowIndex + 1 };
    } catch {
      return null;
    }
  }
}

function deleteTableKeepingValidDoc(state: EditorState, tablePos: number, table: Node) {
  const tableEnd = tablePos + table.nodeSize;
  const paragraphType = state.schema.nodes["paragraph"];
  if (!paragraphType) return state.tr.delete(tablePos, tableEnd);

  if (tablePos === 0 && tableEnd === state.doc.content.size) {
    return state.tr.replaceWith(tablePos, tableEnd, paragraphType.create());
  }
  return state.tr.delete(tablePos, tableEnd);
}

/**
 * Resolve the table/row/cell context around the current selection, or `null`
 * if the selection is not inside a table.
 */
function findCellContext(state: EditorState): CellContext | null {
  const { $from } = state.selection;
  let cellDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    if (isCell($from.node(d))) {
      cellDepth = d;
      break;
    }
  }
  if (cellDepth < 2) return null;

  const rowNode = $from.node(cellDepth - 1);
  const tableNode = $from.node(cellDepth - 2);
  if (rowNode.type.name !== "tableRow" || tableNode.type.name !== "table") return null;

  const tablePos = $from.before(cellDepth - 2);
  const tableStart = tablePos + 1;
  const rowPos = $from.before(cellDepth - 1);
  const rowIndex = $from.index(cellDepth - 2);
  const cellPos = $from.before(cellDepth);

  const map = getTableMap(tableNode);
  const rect = rectForCell(map, rowNode, rowPos, tableStart, rowIndex, cellPos);
  if (!rect) return null;

  return { table: tableNode, tablePos, tableStart, map, rowNode, rowPos, rowIndex, rect };
}

// ── Rows ───────────────────────────────────────────────────────────────────────

/**
 * Build a fresh row to insert at grid index `insertRowIdx`. Columns whose
 * vertical merge spans across the insertion boundary receive a `continue`
 * cell (so the merge stays contiguous); every other column gets a plain
 * single-span cell.
 */
function buildInsertedRow(table: Node, map: TableMap, insertRowIdx: number): Node | null {
  const schema = table.type.schema;
  const rowType = schema.nodes["tableRow"];
  const cellType = schema.nodes["tableCell"];
  const paragraphType = schema.nodes["paragraph"];
  if (!rowType || !cellType || !paragraphType) return null;

  const w = map.width;
  const cells: Node[] = [];
  let c = 0;
  while (c < w) {
    const insideMerge =
      insertRowIdx > 0 &&
      insertRowIdx < map.height &&
      slotAt(map, insertRowIdx - 1, c) !== -1 &&
      slotAt(map, insertRowIdx - 1, c) === slotAt(map, insertRowIdx, c);

    if (insideMerge) {
      const span = map.findCell(slotAt(map, insertRowIdx, c)).right - c;
      cells.push(cellType.create({ gridSpan: span, vMerge: "continue" }, paragraphType.create()));
      c += span;
    } else {
      cells.push(cellType.create({ gridSpan: 1, vMerge: "none" }, paragraphType.create()));
      c += 1;
    }
  }
  return rowType.create(null, cells);
}

function addRowCommand(after: boolean): Command {
  return (state, dispatch) => {
    const ctx = findCellContext(state);
    if (!ctx) return false;
    const { table, tableStart, map, rect } = ctx;

    const insertRowIdx = after ? rect.bottom : rect.top;
    const newRow = buildInsertedRow(table, map, insertRowIdx);
    if (!newRow) return false;

    if (dispatch) {
      const insertPos = rowStartPos(table, tableStart, insertRowIdx);
      dispatch(state.tr.insert(insertPos, newRow).scrollIntoView());
    }
    return true;
  };
}

/**
 * Grid columns where a vertical merge starts in `rowIndex` and continues into
 * the next row — deleting this row would orphan those continuations, so the
 * cell directly below each must be promoted from `continue` to `restart` to
 * keep the merge alive (one row shorter). Matches Word: deleting a merged
 * cell's top row shrinks the merge rather than dropping it.
 */
function mergeMasterColumns(map: TableMap, rowIndex: number): number[] {
  const cols: number[] = [];
  let c = 0;
  while (c < map.width) {
    const off = slotAt(map, rowIndex, c);
    if (off === -1) {
      c += 1;
      continue;
    }
    const cellRect = map.findCell(off);
    if (cellRect.top === rowIndex && cellRect.bottom > rowIndex + 1) cols.push(c);
    c += cellRect.right - cellRect.left;
  }
  return cols;
}

function deleteRowCommand(): Command {
  return (state, dispatch) => {
    const ctx = findCellContext(state);
    if (!ctx) return false;
    const { table, tablePos, tableStart, map, rowNode, rowPos, rowIndex } = ctx;

    if (dispatch) {
      let tr = state.tr;
      if (table.childCount === 1) {
        // `tableRow+` forbids an empty table — deleting the last row removes
        // the whole table (matches Word).
        tr = deleteTableKeepingValidDoc(state, tablePos, table);
      } else {
        // Promote next-row continuations of any merge that begins in this row,
        // so the merge survives (size-stable markup before the delete shifts
        // positions). The promoted columns line up with the next row's cells.
        const promoteCols = new Set(mergeMasterColumns(map, rowIndex));
        if (promoteCols.size > 0) {
          const nextRow = table.child(rowIndex + 1);
          let col = 0;
          let pos = rowStartPos(table, tableStart, rowIndex + 1) + 1;
          for (let i = 0; i < nextRow.childCount; i++) {
            const cell = nextRow.child(i);
            if (promoteCols.has(col)) {
              tr = tr.setNodeMarkup(pos, undefined, { ...cell.attrs, vMerge: "restart" });
            }
            col += readGridSpan(cell);
            pos += cell.nodeSize;
          }
        }
        tr = tr.delete(rowPos, rowPos + rowNode.nodeSize);
      }
      const target = Math.min(tr.mapping.map(rowPos, -1), tr.doc.content.size);
      tr = tr.setSelection(Selection.near(tr.doc.resolve(target)));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// ── Columns ─────────────────────────────────────────────────────────────────────

function addColumnCommand(after: boolean): Command {
  return (state, dispatch) => {
    const ctx = findCellContext(state);
    if (!ctx) return false;
    const { table, tablePos, tableStart, rect } = ctx;
    const insertCol = after ? rect.right : rect.left;

    const schema = table.type.schema;
    const cellType = schema.nodes["tableCell"];
    const paragraphType = schema.nodes["paragraph"];
    if (!cellType || !paragraphType) return false;
    if (!dispatch) return true;

    // Plan against the original doc: each row either grows a straddling cell's
    // gridSpan or gets one fresh cell inserted at the column boundary.
    const grows: Array<{ pos: number; cell: Node }> = [];
    const insertPositions: number[] = [];

    for (let r = 0; r < table.childCount; r++) {
      const rowNode = table.child(r);
      const rowStart = rowStartPos(table, tableStart, r);
      let col = 0;
      let cellPos = rowStart + 1; // before the row's first cell
      let placed = false;
      for (let i = 0; i < rowNode.childCount; i++) {
        const cell = rowNode.child(i);
        const span = readGridSpan(cell);
        if (insertCol > col && insertCol < col + span) {
          grows.push({ pos: cellPos, cell });
          placed = true;
          break;
        }
        if (insertCol === col) {
          insertPositions.push(cellPos);
          placed = true;
          break;
        }
        col += span;
        cellPos += cell.nodeSize;
      }
      if (!placed) insertPositions.push(cellPos); // insertCol === width → row end
    }

    let tr = state.tr;
    // Size-stable markup first, so the original positions stay valid.
    for (const g of grows) {
      tr = tr.setNodeMarkup(g.pos, undefined, { ...g.cell.attrs, gridSpan: readGridSpan(g.cell) + 1 });
    }
    // Inserts descending so earlier inserts don't shift later positions.
    insertPositions.sort((a, b) => b - a);
    for (const pos of insertPositions) {
      tr = tr.insert(pos, cellType.create({ gridSpan: 1, vMerge: "none" }, paragraphType.create()));
    }
    const grid = readGrid(table);
    const newGrid = [...grid.slice(0, insertCol), DEFAULT_COLUMN_WIDTH, ...grid.slice(insertCol)];
    tr = tr.setNodeMarkup(tablePos, undefined, { ...table.attrs, grid: newGrid });

    dispatch(tr.scrollIntoView());
    return true;
  };
}

function deleteColumnCommand(): Command {
  return (state, dispatch) => {
    const ctx = findCellContext(state);
    if (!ctx) return false;
    const { table, tablePos, tableStart, map, rect } = ctx;
    const delCol = rect.left;

    if (map.width === 1) {
      // Last column — remove the whole table.
      if (dispatch) dispatch(deleteTableKeepingValidDoc(state, tablePos, table).scrollIntoView());
      return true;
    }
    if (!dispatch) return true;

    const shrinks: Array<{ pos: number; cell: Node }> = [];
    const deletions: Array<{ from: number; to: number }> = [];

    for (let r = 0; r < table.childCount; r++) {
      const rowNode = table.child(r);
      const rowStart = rowStartPos(table, tableStart, r);
      let col = 0;
      let cellPos = rowStart + 1;
      for (let i = 0; i < rowNode.childCount; i++) {
        const cell = rowNode.child(i);
        const span = readGridSpan(cell);
        if (delCol >= col && delCol < col + span) {
          if (span > 1) shrinks.push({ pos: cellPos, cell });
          else deletions.push({ from: cellPos, to: cellPos + cell.nodeSize });
          break;
        }
        col += span;
        cellPos += cell.nodeSize;
      }
    }

    let tr = state.tr;
    for (const s of shrinks) {
      tr = tr.setNodeMarkup(s.pos, undefined, { ...s.cell.attrs, gridSpan: readGridSpan(s.cell) - 1 });
    }
    deletions.sort((a, b) => b.from - a.from);
    for (const d of deletions) tr = tr.delete(d.from, d.to);
    const grid = readGrid(table);
    const newGrid = [...grid.slice(0, delCol), ...grid.slice(delCol + 1)];
    tr = tr.setNodeMarkup(tablePos, undefined, { ...table.attrs, grid: newGrid });

    const target = Math.min(tr.mapping.map(state.selection.from, -1), tr.doc.content.size);
    tr = tr.setSelection(Selection.near(tr.doc.resolve(target)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

// ── Navigation ──────────────────────────────────────────────────────────────────

function goToNextCellCommand(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const ctx = findCellContext(state);
    if (!ctx) return false;
    const { table, tableStart } = ctx;

    // Absolute position before each cell node, in document order.
    const cellStarts: number[] = [];
    table.forEach((rowNode, rowOffset) => {
      rowNode.forEach((_cell, cellOffsetInRow) => {
        cellStarts.push(tableStart + rowOffset + 1 + cellOffsetInRow);
      });
    });

    const { $from } = state.selection;
    let curStart = -1;
    for (let d = $from.depth; d > 0; d--) {
      if (isCell($from.node(d))) {
        curStart = $from.before(d);
        break;
      }
    }
    const idx = cellStarts.indexOf(curStart);
    if (idx === -1) return false;

    const nextIdx = idx + dir;
    // Wrapping / new-row-on-tab-past-end is Phase 5's `Tab` handler; the bare
    // command stops at the table's edges.
    if (nextIdx < 0 || nextIdx >= cellStarts.length) return false;

    if (dispatch) {
      const sel = Selection.near(state.doc.resolve(cellStarts[nextIdx]! + 1), 1);
      dispatch(state.tr.setSelection(sel).scrollIntoView());
    }
    return true;
  };
}

// ── Public command factory ───────────────────────────────────────────────────────

export function tableStructureCommands(): Record<string, () => Command> {
  return {
    addRowBefore: () => addRowCommand(false),
    addRowAfter: () => addRowCommand(true),
    deleteRow: () => deleteRowCommand(),
    addColumnBefore: () => addColumnCommand(false),
    addColumnAfter: () => addColumnCommand(true),
    deleteColumn: () => deleteColumnCommand(),
    goToNextCell: () => goToNextCellCommand(1),
    goToPreviousCell: () => goToNextCellCommand(-1),
  };
}

// Re-export for tests and future keymap wiring that needs a directional handle.
export { TextSelection };
