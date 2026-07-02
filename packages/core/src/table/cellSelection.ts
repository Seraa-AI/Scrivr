import type { EditorState } from "prosemirror-state";
import type { Node, ResolvedPos } from "prosemirror-model";
import { getTableMap, type Rect, type TableMap } from "./TableMap";

/**
 * Cell selection geometry (Phase 5).
 *
 * A `CellRange` is the rectangular cell selection a user expresses by dragging
 * a text selection out of one cell and into another. In v1 it is DERIVED from
 * that spanning `TextSelection` on demand — there is no stored selection state
 * yet. Phase 6 (drag-select + overlay) will introduce a persisted range and a
 * real ProseMirror `Selection` subclass; until then the spanning text
 * selection is the single source of truth, and editing guards (delete, paste)
 * ask this module "does the current selection span cells, and which?".
 *
 * The rect is normalized so a partially-covered merged cell (gridSpan / vMerge)
 * pulls the whole merged cell in — matching Word/Docs, where you cannot select
 * half of a merged cell.
 */
export interface CellRange {
  /** Absolute doc position of the enclosing `table` node. */
  tablePos: number;
  /** Grid rect covering every cell the anchor→head span touches. */
  rect: Rect;
}

export interface ResolvedCellRange extends CellRange {
  table: Node;
  /** Absolute position just inside the table (before its first row). */
  tableStart: number;
  map: TableMap;
  /**
   * Absolute positions (the slot before each cell node) of every cell in the
   * rect, in document order.
   */
  cellPositions: number[];
}

interface CellInfo {
  /** Absolute position before the cell node. */
  cellPos: number;
  /** `cellPos` relative to the table content start (TableMap's offset space). */
  cellOffset: number;
  tableNode: Node;
  tablePos: number;
  tableStart: number;
}

function isCellType(name: string): boolean {
  return name === "tableCell" || name === "tableHeader";
}

function readGridSpan(cell: Node): number {
  const v = cell.attrs["gridSpan"];
  if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 1) return v;
  return 1;
}

/** Grid (row, physical column) of the cell at `cellOffset`, or null. */
function locateCell(table: Node, cellOffset: number): { row: number; col: number } | null {
  let rowStart = 0; // offset of each row node, relative to table content start
  for (let r = 0; r < table.childCount; r++) {
    const rowNode = table.child(r);
    if (cellOffset > rowStart && cellOffset < rowStart + rowNode.nodeSize) {
      let cellPos = rowStart + 1;
      let col = 0;
      for (let i = 0; i < rowNode.childCount; i++) {
        const cell = rowNode.child(i);
        if (cellPos === cellOffset) return { row: r, col };
        col += readGridSpan(cell);
        cellPos += cell.nodeSize;
      }
      return null;
    }
    rowStart += rowNode.nodeSize;
  }
  return null;
}

/**
 * Bounding rect of the cell at `cellOffset`. `findCell` covers ordinary cells;
 * a `vMerge:"continue"` offset isn't registered, so fall back to the grid slot
 * it occupies and return the master cell's rect (matches `commands.ts`).
 */
function rectForCellOffset(map: TableMap, table: Node, cellOffset: number): Rect | null {
  try {
    return map.findCell(cellOffset);
  } catch {
    const loc = locateCell(table, cellOffset);
    if (!loc) return null;
    const master = map.positionAt(loc.row, loc.col);
    if (master == null) return null;
    try {
      return map.findCell(master);
    } catch {
      return null;
    }
  }
}

/** Resolve the cell / table enclosing `$pos`, or null when outside a table. */
function cellInfoAt($pos: ResolvedPos): CellInfo | null {
  for (let d = $pos.depth; d >= 2; d--) {
    if (!isCellType($pos.node(d).type.name)) continue;
    const tableNode = $pos.node(d - 2);
    if (tableNode.type.name !== "table") return null;
    const tablePos = $pos.before(d - 2);
    const tableStart = tablePos + 1;
    const cellPos = $pos.before(d);
    return { cellPos, cellOffset: cellPos - tableStart, tableNode, tablePos, tableStart };
  }
  return null;
}

function unionRect(a: Rect, b: Rect): Rect {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/**
 * Grow `rect` until every cell it intersects is fully contained. A merged cell
 * straddling the edge widens the selection to swallow the whole cell; the loop
 * is bounded by the grid size (each pass can only ever enlarge the rect).
 */
function normalizeRect(map: TableMap, rect: Rect): Rect {
  const r = { ...rect };
  for (let guard = 0; guard <= map.width * map.height; guard++) {
    let changed = false;
    for (const offset of map.cellsInRect(r)) {
      const cr = map.findCell(offset);
      if (cr.left < r.left) (r.left = cr.left), (changed = true);
      if (cr.top < r.top) (r.top = cr.top), (changed = true);
      if (cr.right > r.right) (r.right = cr.right), (changed = true);
      if (cr.bottom > r.bottom) (r.bottom = cr.bottom), (changed = true);
    }
    if (!changed) break;
  }
  return r;
}

/**
 * The rectangular cell selection implied by the current selection, or null when
 * the selection is empty, lies within a single cell, or is not confined to one
 * table. This is the promotion the spec calls "cross-cell text selection → a
 * CellRange".
 */
export function cellRangeFromSelection(state: EditorState): CellRange | null {
  const sel = state.selection;
  if (sel.empty) return null;

  const fromInfo = cellInfoAt(sel.$from);
  const toInfo = cellInfoAt(sel.$to);
  if (!fromInfo || !toInfo) return null;
  if (fromInfo.tablePos !== toInfo.tablePos) return null;
  if (fromInfo.cellPos === toInfo.cellPos) return null;

  const map = getTableMap(fromInfo.tableNode);
  const fromRect = rectForCellOffset(map, fromInfo.tableNode, fromInfo.cellOffset);
  const toRect = rectForCellOffset(map, toInfo.tableNode, toInfo.cellOffset);
  if (!fromRect || !toRect) return null;

  return { tablePos: fromInfo.tablePos, rect: normalizeRect(map, unionRect(fromRect, toRect)) };
}

/** Resolve a `CellRange` against the current doc, or null if it no longer fits. */
export function resolveCellRange(state: EditorState, range: CellRange): ResolvedCellRange | null {
  const { doc } = state;
  if (range.tablePos < 0 || range.tablePos >= doc.content.size) return null;
  const table = doc.nodeAt(range.tablePos);
  if (!table || table.type.name !== "table") return null;

  const tableStart = range.tablePos + 1;
  const map = getTableMap(table);
  const cellPositions = map
    .cellsInRect(range.rect)
    .map((offset) => tableStart + offset)
    .sort((a, b) => a - b);

  return { ...range, table, tableStart, map, cellPositions };
}

/** Convenience: resolve the cell selection the current selection implies. */
export function selectedCells(state: EditorState): ResolvedCellRange | null {
  const range = cellRangeFromSelection(state);
  return range ? resolveCellRange(state, range) : null;
}

export interface EnclosingCell {
  /** Absolute doc position of the enclosing table node. */
  tablePos: number;
  /** Absolute position before the enclosing cell node. */
  cellPos: number;
  /** Resolved-pos depth of the cell node. */
  cellDepth: number;
}

/** The table cell containing the selection head, or null when outside a table. */
export function enclosingCell(state: EditorState): EnclosingCell | null {
  const info = cellInfoAt(state.selection.$head);
  if (!info) return null;
  const { $head } = state.selection;
  let cellDepth = $head.depth;
  for (let d = $head.depth; d >= 2; d--) {
    if (isCellType($head.node(d).type.name)) {
      cellDepth = d;
      break;
    }
  }
  return { tablePos: info.tablePos, cellPos: info.cellPos, cellDepth };
}
