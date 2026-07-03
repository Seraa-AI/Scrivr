import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorState, Transaction } from "prosemirror-state";
import type { Node, ResolvedPos } from "prosemirror-model";
import { getTableMap, type Rect, type TableMap } from "./TableMap";

/**
 * Cell selection geometry + persisted range (Phases 5-6).
 *
 * A `CellRange` is a rectangular cell selection. It has two sources:
 *   - DERIVED (Phase 5): a spanning `TextSelection` across cells (keyboard).
 *   - PERSISTED (Phase 6): a stored `{anchor, head}` cell-position pair set by
 *     mouse drag-select, held in `cellSelectionPlugin` state and remapped
 *     through edits. Cells are `isolating`, so a mouse drag can't produce a
 *     spanning text selection — the persisted range is how drag expresses one.
 *
 * `selectedCells()` prefers the persisted range, else derives from the text
 * selection, so editing guards (delete/paste) and the overlay see one answer.
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

/** Resolve the cell/table for a cell node's absolute position, or null. */
function cellInfoAtPos(doc: Node, cellPos: number): CellInfo | null {
  if (cellPos < 0 || cellPos + 1 > doc.content.size) return null;
  return cellInfoAt(doc.resolve(cellPos + 1));
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

/**
 * The rectangular cell selection spanning the cells at two absolute positions
 * (the anchor and head of a drag), or null if they aren't cells in one table.
 * Unlike {@link cellRangeFromSelection}, anchor === head is allowed (1 cell).
 */
export function cellRangeBetween(
  doc: Node,
  anchorCellPos: number,
  headCellPos: number,
): CellRange | null {
  const a = cellInfoAtPos(doc, anchorCellPos);
  const b = cellInfoAtPos(doc, headCellPos);
  if (!a || !b || a.tablePos !== b.tablePos) return null;
  // Both endpoints must land exactly on a cell boundary. A position that merely
  // falls *inside* a cell (e.g. a remap that drifted into content) resolves to
  // that cell's before-pos, which wouldn't equal the supplied position — reject
  // it rather than silently snapping.
  if (a.cellPos !== anchorCellPos || b.cellPos !== headCellPos) return null;

  const map = getTableMap(a.tableNode);
  const ar = rectForCellOffset(map, a.tableNode, a.cellOffset);
  const br = rectForCellOffset(map, b.tableNode, b.cellOffset);
  if (!ar || !br) return null;

  return { tablePos: a.tablePos, rect: normalizeRect(map, unionRect(ar, br)) };
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

/**
 * Persisted drag-selection: the anchor and head cell positions of a mouse
 * drag. Held here (not as a ProseMirror selection) because `isolating` cells
 * forbid a spanning text selection. Remapped through edits; a real `Selection`
 * subclass is deferred to Phase 9.
 */
export interface StoredCellRange {
  anchor: number;
  head: number;
}

export const cellSelectionPluginKey = new PluginKey<StoredCellRange | null>(
  "tableCellSelection",
);

/** Meta-set the persisted drag range on a transaction (or clear with null). */
export function setStoredCellRange(tr: Transaction, range: StoredCellRange | null): Transaction {
  return tr.setMeta(cellSelectionPluginKey, range);
}

/**
 * Holds the persisted drag range. Cleared whenever a selection is set without
 * our meta (a plain click / caret move drops the drag range), and remapped
 * through doc changes. Validated after remap — an edit that dissolves a cell
 * clears the range rather than pointing at garbage.
 */
export function cellSelectionPlugin(): Plugin {
  return new Plugin<StoredCellRange | null>({
    key: cellSelectionPluginKey,
    state: {
      init: () => null,
      apply(tr, value) {
        const meta = tr.getMeta(cellSelectionPluginKey);
        if (meta !== undefined) return meta; // explicit set (range) or clear (null)
        if (!value) return null;
        // ANY selection change we didn't author (click, arrow, Tab — even one that
        // also changes the doc, e.g. the multi-cell clear) drops the drag range.
        // Checked before docChanged so a compound tx can't slip through to remap.
        if (tr.selectionSet) return null;
        if (tr.docChanged) {
          // assoc +1 keeps an endpoint on the existing cell when text is inserted
          // at its boundary; a deleted endpoint (cell removed) clears the range.
          const a = tr.mapping.mapResult(value.anchor, 1);
          const h = tr.mapping.mapResult(value.head, 1);
          if (a.deleted || h.deleted) return null;
          if (!cellRangeBetween(tr.doc, a.pos, h.pos)) return null;
          return { anchor: a.pos, head: h.pos };
        }
        return value;
      },
    },
  });
}

/**
 * The active cell selection: the persisted drag range if present, else derived
 * from a spanning text selection. Editing guards and the overlay both call this
 * so mouse and keyboard selections resolve identically.
 */
export function selectedCells(state: EditorState): ResolvedCellRange | null {
  const stored = cellSelectionPluginKey.getState(state);
  if (stored) {
    const range = cellRangeBetween(state.doc, stored.anchor, stored.head);
    if (range) return resolveCellRange(state, range);
  }
  const derived = cellRangeFromSelection(state);
  return derived ? resolveCellRange(state, derived) : null;
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
