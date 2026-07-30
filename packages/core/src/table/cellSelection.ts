import { Selection, SelectionRange, TextSelection } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import { Fragment, Slice } from "prosemirror-model";
import type { Node, ResolvedPos } from "prosemirror-model";
import type { Mappable } from "prosemirror-transform";
import { getTableMap, type Rect, type TableMap } from "./TableMap";

/**
 * Cell selection geometry + the `CellSelection` class.
 *
 * A `CellRange` is a rectangular cell selection: an enclosing table plus a grid
 * rect. The durable selection is the {@link CellSelection} class below (a real
 * ProseMirror `Selection`); `CellRange` is the resolved geometry that editing
 * guards, the clipboard, and the paint behavior read via {@link selectedCells}.
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

// ── CellSelection (a real ProseMirror Selection subclass) ─────────────────────

/** True when `$pos` sits immediately before a cell node inside a table row. */
export function pointsAtCell($pos: ResolvedPos): boolean {
  return (
    $pos.parent.type.name === "tableRow" &&
    !!$pos.nodeAfter &&
    isCellType($pos.nodeAfter.type.name)
  );
}

/** True when two cell positions belong to the same enclosing table. */
export function inSameTable($a: ResolvedPos, $b: ResolvedPos): boolean {
  return $a.depth >= 1 && $b.depth >= 1 && $a.node(-1) === $b.node(-1);
}

/** The node position of the cell enclosing `$pos`, or null when outside a table. */
export function enclosingCellPos($pos: ResolvedPos): number | null {
  return cellInfoAt($pos)?.cellPos ?? null;
}

/**
 * A rectangular selection of table cells — Scrivr's own `Selection` subclass,
 * mirroring prosemirror-tables. Cells are `isolating`, so a drag across them
 * can't produce a spanning `TextSelection`; this is the durable, mappable,
 * serializable representation that replaces the Phase-6 plugin shadow, which
 * gives undo, collaboration, and clipboard round-tripping for free.
 *
 * `$anchorCell` / `$headCell` are resolved positions pointing immediately in
 * front of the anchor and head cell nodes. The head cell's content is the
 * primary selection range, so `.head` (and thus the hidden textarea / caret)
 * lands inside the head cell rather than in some other cell of the rectangle.
 */
export class CellSelection extends Selection {
  readonly $anchorCell: ResolvedPos;
  readonly $headCell: ResolvedPos;
  /** Normalized grid rect covering every cell in the selection. */
  readonly rect: Rect;

  constructor($anchorCell: ResolvedPos, $headCell: ResolvedPos = $anchorCell) {
    if (
      !pointsAtCell($anchorCell) ||
      !pointsAtCell($headCell) ||
      !inSameTable($anchorCell, $headCell)
    ) {
      throw new RangeError("CellSelection endpoints must point at cells in the same table");
    }
    const table = $anchorCell.node(-1);
    const tableStart = $anchorCell.start(-1);
    const map = getTableMap(table);
    const anchorRect = rectForCellOffset(map, table, $anchorCell.pos - tableStart);
    const headRect = rectForCellOffset(map, table, $headCell.pos - tableStart);
    if (!anchorRect || !headRect) {
      throw new RangeError("CellSelection endpoints are not present in the table map");
    }
    const rect = normalizeRect(map, unionRect(anchorRect, headRect));

    const doc = $anchorCell.node(0);
    const headOffset = $headCell.pos - tableStart;
    // Head cell first, so the primary range (super's anchor/head) is the head
    // cell's content — the in-cell text anchor (RFC requirement 4).
    const offsets = map.cellsInRect(rect).filter((o) => o !== headOffset);
    offsets.unshift(headOffset);

    const ranges = offsets.map((offset) => {
      const cell = table.nodeAt(offset);
      const from = tableStart + offset + 1;
      const to = from + (cell ? cell.content.size : 0);
      return new SelectionRange(doc.resolve(from), doc.resolve(to));
    });

    super(ranges[0]!.$from, ranges[0]!.$to, ranges);
    this.$anchorCell = $anchorCell;
    this.$headCell = $headCell;
    this.rect = rect;
  }

  override map(doc: Node, mapping: Mappable): Selection {
    const $anchorCell = doc.resolve(mapping.map(this.$anchorCell.pos));
    const $headCell = doc.resolve(mapping.map(this.$headCell.pos));
    if (
      pointsAtCell($anchorCell) &&
      pointsAtCell($headCell) &&
      inSameTable($anchorCell, $headCell)
    ) {
      return new CellSelection($anchorCell, $headCell);
    }
    // An edit dissolved a cell or split the range across tables — degrade to a
    // plain text selection between the mapped endpoints.
    return TextSelection.between($anchorCell, $headCell);
  }

  /**
   * The selected rectangle as a standalone `table` slice. Because the rect is
   * normalized to whole merged cells, each source row can be sliced by column
   * without trimming spans — the sub-grid keeps its `gridSpan` / `vMerge` chain
   * intact, so paste and undo round-trip the exact structure.
   */
  override content(): Slice {
    const table = this.$anchorCell.node(-1);
    const schema = table.type.schema;
    const rowType = schema.nodes["tableRow"];
    const { rect } = this;

    const rows: Node[] = [];
    for (let r = rect.top; r < rect.bottom && r < table.childCount; r++) {
      const rowNode = table.child(r);
      const cells: Node[] = [];
      let col = 0;
      rowNode.forEach((cellNode) => {
        const span = readGridSpan(cellNode);
        if (col >= rect.left && col + span <= rect.right) cells.push(cellNode);
        col += span;
      });
      if (rowType) rows.push(rowType.create(rowNode.attrs, cells));
    }

    const grid = Array.isArray(table.attrs["grid"])
      ? table.attrs["grid"].slice(rect.left, rect.right)
      : [];
    const sub = table.type.create({ ...table.attrs, grid }, Fragment.from(rows));
    return new Slice(Fragment.from(sub), 0, 0);
  }

  override eq(other: Selection): boolean {
    return (
      other instanceof CellSelection &&
      other.$anchorCell.pos === this.$anchorCell.pos &&
      other.$headCell.pos === this.$headCell.pos
    );
  }

  override toJSON(): { type: string; anchor: number; head: number } {
    return { type: CELL_SELECTION_JSON_ID, anchor: this.$anchorCell.pos, head: this.$headCell.pos };
  }

  override getBookmark(): CellBookmark {
    return new CellBookmark(this.$anchorCell.pos, this.$headCell.pos);
  }

  static override fromJSON(doc: Node, json: { anchor: number; head: number }): Selection {
    // Untrusted (persisted / collaborative) data: validate through the same
    // guarded path as `between` and degrade to a caret rather than throwing or
    // constructing an unrelated rectangle when the positions aren't two cells of
    // one table.
    const size = doc.content.size;
    const clamp = (n: number): number =>
      Number.isFinite(n) ? Math.max(0, Math.min(Math.floor(n), size)) : 0;
    const anchor = clamp(json.anchor);
    const head = clamp(json.head);
    return CellSelection.between(doc, anchor, head) ?? Selection.near(doc.resolve(head));
  }

  /** Build a CellSelection between two cell node positions, or null if invalid. */
  static between(doc: Node, anchorCellPos: number, headCellPos: number): CellSelection | null {
    const $anchor = doc.resolve(anchorCellPos);
    const $head = doc.resolve(headCellPos);
    if (!pointsAtCell($anchor) || !pointsAtCell($head) || !inSameTable($anchor, $head)) {
      return null;
    }
    return new CellSelection($anchor, $head);
  }
}

/** A CellSelection's mappable, doc-independent form (for history/collab). */
export class CellBookmark {
  constructor(
    readonly anchor: number,
    readonly head: number,
  ) {}

  map(mapping: Mappable): CellBookmark {
    return new CellBookmark(mapping.map(this.anchor), mapping.map(this.head));
  }

  resolve(doc: Node): Selection {
    const $anchorCell = doc.resolve(this.anchor);
    const $headCell = doc.resolve(this.head);
    if (
      pointsAtCell($anchorCell) &&
      pointsAtCell($headCell) &&
      inSameTable($anchorCell, $headCell)
    ) {
      return new CellSelection($anchorCell, $headCell);
    }
    return Selection.near($headCell, 1);
  }
}

/**
 * jsonID under which `CellSelection` registers with prosemirror-state's single
 * global selection registry. Namespaced because that registry is process-wide:
 * prosemirror-tables (which Tiptap ships) also claims the bare `"cell"`, so an
 * app running Tiptap alongside Scrivr would throw "Duplicate use of selection
 * JSON ID cell" on import. `"scrivr:cell"` cannot collide with theirs.
 */
export const CELL_SELECTION_JSON_ID = "scrivr:cell";

// The registry is keyed globally, so a second registration of this id — a
// duplicate @scrivr/core copy in a consumer's bundle — also throws. Swallow it:
// any registration under our namespace is a Scrivr CellSelection, so the already
// registered class is compatible.
try {
  Selection.jsonID(CELL_SELECTION_JSON_ID, CellSelection);
} catch {
  // already registered by another @scrivr/core instance — harmless
}

/**
 * The active cell selection resolved to its cell positions, or null when the
 * current selection is not a `CellSelection`. Editing guards and the clipboard
 * both call this so they see one answer.
 */
export function selectedCells(state: EditorState): ResolvedCellRange | null {
  const sel = state.selection;
  if (!(sel instanceof CellSelection)) return null;
  const tablePos = sel.$anchorCell.before(-1);
  return resolveCellRange(state, { tablePos, rect: sel.rect });
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
