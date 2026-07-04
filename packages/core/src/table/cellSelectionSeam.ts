import type { EditorState } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import type { IEditor, OverlayRenderHandler } from "../extensions/types";
import type {
  GesturePoint,
  HitTarget,
  HitTester,
  SelectionBehavior,
  SelectionDescriptor,
  SelectionGesture,
  SelectionGestureProvider,
} from "../selection/types";
import { cellAtCoords } from "../layout/cellHitTest";
import { CellSelection, enclosingCellPos, resolveCellRange, selectedCells } from "./cellSelection";
import { getTableMap } from "./TableMap";

/**
 * Table cell selection, expressed through the selection seam plus one overlay:
 *
 *   - `cellSelectionBehavior` describes a `CellSelection` (kind `"table-cell"`,
 *     capabilities, grid bounds, cell count).
 *   - `cellHitTester` turns a pointer position over a cell into a `HitTarget`
 *     carrying the precise in-cell caret plus the cell node position.
 *   - `cellSelectionGesture` owns a cell drag: it places the caret on press,
 *     dispatches a `CellSelection` when the drag crosses into another cell, and
 *     falls back to plain in-cell text selection otherwise.
 *   - `tableCellWashHandler` paints the cell wash for any selection that covers
 *     cells — a cell range OR a text range spanning the table.
 */

// ── Descriptor ────────────────────────────────────────────────────────────────

/** The `SelectionDescriptor` for a cell selection, with table-specific fields. */
export interface CellSelectionDescriptor extends SelectionDescriptor {
  kind: "table-cell";
  /** Grid rows covered (0-based, half-open). */
  rows: { from: number; to: number };
  /** Grid columns covered (0-based, half-open). */
  columns: { from: number; to: number };
  selectedCellCount: number;
  /** The rectangle spans >1 cell, so they can be merged into one. */
  mergeCells: boolean;
  /** A selected cell spans rows/columns, so it can be split. */
  splitCell: boolean;
}

export function isCellDescriptor(d: SelectionDescriptor): d is CellSelectionDescriptor {
  return d.kind === "table-cell";
}

// ── Behavior ──────────────────────────────────────────────────────────────────

export const cellSelectionBehavior: SelectionBehavior<CellSelection> = {
  kind: "table-cell",
  matches: (s): s is CellSelection => s instanceof CellSelection,
  describe: (s, ctx): CellSelectionDescriptor => {
    const tablePos = s.$anchorCell.before(-1);
    const resolved = resolveCellRange(ctx.state, { tablePos, rect: s.rect });
    const count = resolved?.cellPositions.length ?? 0;
    // splitCell only applies to a single selected cell that itself spans rows or
    // columns — so only probe the geometry in that case.
    const spans =
      resolved && count === 1
        ? (() => {
            const map = getTableMap(resolved.table);
            const cellRect = map.findCell(resolved.cellPositions[0]! - resolved.tableStart);
            return cellRect.right - cellRect.left > 1 || cellRect.bottom - cellRect.top > 1;
          })()
        : false;
    return {
      kind: "table-cell",
      surfaceId: ctx.surfaceId,
      empty: false,
      capabilities: {
        copy: true,
        cut: !ctx.readOnly,
        delete: !ctx.readOnly,
        // A cell range shows a table toolbar, not the text bubble menu
        // (Google-Docs style) — so text formatting is not advertised here.
        formatText: false,
        drag: false,
        resize: false,
      },
      anchor: s.anchor,
      head: s.head,
      from: s.from,
      to: s.to,
      rows: { from: s.rect.top, to: s.rect.bottom },
      columns: { from: s.rect.left, to: s.rect.right },
      selectedCellCount: count,
      mergeCells: !ctx.readOnly && count > 1,
      splitCell: !ctx.readOnly && count === 1 && spans,
    };
  },
  // Cells are washed by `tableCellWashHandler` (one code path for cell ranges and
  // text ranges that span a table), not through the per-selection geometry seam —
  // so this emits nothing and, notably, no caret, keeping the wash clean.
  geometry: () => [],
};

// ── Hit tester ────────────────────────────────────────────────────────────────

interface CellHitPayload {
  /** Absolute doc position of the cell node under the pointer. */
  cellPos: number;
}

function isCellHit(payload: unknown): payload is CellHitPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "cellPos" in payload &&
    typeof (payload as { cellPos: unknown }).cellPos === "number"
  );
}

/**
 * Constrain a caret to the cell that geometry says the pointer is in. The cell
 * *rect* (which owns padding and blank space) decides the cell; the glyph-based
 * `posAtCoords` decides the caret but can snap into a neighbouring cell near an
 * edge or in padding. Clamping to the cell's own document range makes the two
 * agree, so the caret can never land in a different cell than the one clicked.
 */
function caretWithinCell(doc: Node, cellPos: number, pos: number): number {
  const cell = doc.nodeAt(cellPos);
  if (!cell) return pos;
  const from = cellPos + 1;
  const to = cellPos + cell.nodeSize - 1;
  return Math.max(from, Math.min(pos, to));
}

export const cellHitTester: HitTester = {
  // Above the built-in text caret (which lives in the pointer controller, not
  // the registry) — a point inside a cell is a cell hit first.
  priority: 10,
  hitTest: (docX, docY, page, ctx) => {
    const cellPos = cellAtCoords(ctx.editor.layout.pages, docX, docY, page);
    if (cellPos == null) return null;
    // Region-first: the cell rect is authoritative for *which* cell; the caret
    // is then resolved constrained to that cell so the two never disagree.
    const rawPos = ctx.posAtCoords(docX, docY, page);
    return {
      kind: "table-cell",
      page,
      pos: caretWithinCell(ctx.state.doc, cellPos, rawPos),
      payload: { cellPos },
    };
  },
};

// ── Gesture ───────────────────────────────────────────────────────────────────

/**
 * A cell drag. Placing the caret on press keeps in-cell editing working even
 * when the drag never leaves the anchor cell; crossing into another cell
 * dispatches a `CellSelection`; dragging within the anchor cell extends a plain
 * text selection; dragging off any cell freezes (never a spanning selection).
 */
class CellDragGesture implements SelectionGesture {
  private lastHeadCell: number | null = null;
  /** Doc-position range [from, to] of the table the drag started in. */
  private readonly tableFrom: number;
  private readonly tableTo: number;

  constructor(
    private readonly editor: IEditor,
    private readonly anchorCell: number,
    private readonly anchorCaretPos: number,
    private readonly posAtCoords: (docX: number, docY: number, page: number) => number,
    // A plain click places the caret; a shift-click has already dispatched the
    // CellSelection, so it skips caret placement and seeds the committed head.
    placeCaret = true,
    initialHead: number | null = null,
    private readonly restoreOnCancel?: () => void,
  ) {
    if (placeCaret) {
      // Go through the selection controller (not a raw transaction) so the
      // hidden textarea is focused — a click in a cell must behave like any
      // other caret placement, otherwise keyboard/follow-up selections break.
      this.editor.selection.moveCursorTo(this.anchorCaretPos);
    }
    this.lastHeadCell = initialHead;

    const $anchor = this.editor.getState().doc.resolve(this.anchorCell);
    const table: Node = $anchor.node(-1);
    this.tableFrom = $anchor.before(-1);
    this.tableTo = this.tableFrom + table.nodeSize;
  }

  update(hit: HitTarget | null, _event: PointerEvent, point: GesturePoint | null): void {
    const overCell =
      hit && hit.kind === "table-cell" && isCellHit(hit.payload) ? hit.payload.cellPos : null;

    if (overCell != null && overCell !== this.anchorCell) {
      if (overCell === this.lastHeadCell) return;
      const state = this.editor.getState();
      const sel = CellSelection.between(state.doc, this.anchorCell, overCell);
      if (sel) {
        this.lastHeadCell = overCell;
        this.editor.applyTransaction(state.tr.setSelection(sel));
      }
      return;
    }

    if (overCell === this.anchorCell && hit) {
      // Back in / still in the anchor cell → plain in-cell text selection.
      this.lastHeadCell = null;
      this.editor.selection.setSelection(this.anchorCaretPos, hit.pos);
      return;
    }

    // Off any cell. If the pointer left the table entirely, extend a normal text
    // selection into the body — setSelection's isolating-snap pulls the in-cell
    // anchor out to the table boundary, so the whole table + body is selected
    // (Word/Docs). A point still inside the table (a cell border) → freeze.
    if (point) {
      const bodyPos = this.posAtCoords(point.docX, point.docY, point.page);
      if (bodyPos < this.tableFrom || bodyPos > this.tableTo) {
        this.lastHeadCell = null;
        this.editor.selection.setSelection(this.anchorCaretPos, bodyPos);
      }
    }
  }

  finish(hit: HitTarget | null, event: PointerEvent, point: GesturePoint | null): void {
    this.update(hit, event, point);
  }

  cancel(): void {
    if (this.restoreOnCancel) {
      this.restoreOnCancel();
      return;
    }
    // A cancelled drag unwinds to the caret placed on press — same as the
    // pre-drag state, so an interrupted drag leaves no lingering cell range.
    this.editor.selection.moveCursorTo(this.anchorCaretPos);
  }
}

/** The cell to extend a shift-click from: the CellSelection anchor, or the cell
 *  the current caret sits in. Null when the current selection has no cell to
 *  anchor on (a body selection), so shift-click falls through to text. */
function shiftAnchorCell(state: EditorState): number | null {
  const sel = state.selection;
  if (sel instanceof CellSelection) return sel.$anchorCell.pos;
  return enclosingCellPos(sel.$anchor);
}

export const cellSelectionGesture: SelectionGestureProvider = {
  beginGesture: (hit, event, ctx) => {
    if (hit.kind !== "table-cell" || !isCellHit(hit.payload)) return null;
    // Double/triple-click is word/block text selection — defer to the built-in
    // handling (ctx.clickCount is reliable; event.detail is not on pointerdown).
    if (ctx.clickCount > 1) return null;
    const clickedCell = hit.payload.cellPos;
    const state = ctx.state;

    if (event.shiftKey) {
      // Extend to a rectangular CellSelection when both ends are cells of one
      // table; otherwise let the built-in text shift-extend handle it.
      const anchorCell = shiftAnchorCell(state);
      if (anchorCell === null) return null;
      // Shift-click within the current cell is ordinary text extension. A
      // one-cell CellSelection would unexpectedly select the cell's complete
      // contents when the user only moved the text-selection head.
      if (anchorCell === clickedCell) return null;
      const previous = state.selection.getBookmark();
      const sel = CellSelection.between(state.doc, anchorCell, clickedCell);
      if (!sel) return null;
      ctx.editor.applyTransaction(state.tr.setSelection(sel));
      const anchorCaret = Math.min(anchorCell + 2, state.doc.content.size);
      // Own the pointer (so the built-in shift-extend doesn't override) and let a
      // continued drag keep extending from the same anchor.
      return new CellDragGesture(
        ctx.editor,
        anchorCell,
        anchorCaret,
        ctx.posAtCoords,
        false,
        clickedCell,
        () => {
          const current = ctx.editor.getState();
          ctx.editor.applyTransaction(current.tr.setSelection(previous.resolve(current.doc)));
        },
      );
    }

    return new CellDragGesture(ctx.editor, clickedCell, hit.pos, ctx.posAtCoords);
  },
};

// ── Cell wash ──────────────────────────────────────────────────────────────────

/**
 * Every cell the current selection highlights — the single source for cell
 * washing, whatever the selection kind:
 *   - a `CellSelection` → its rectangle of cells;
 *   - any other selection → the cells it *fully contains* (a table caught inside
 *     a body selection washes whole, Word/Docs style; a selection that only dips
 *     into part of one cell contains no cell, so nothing washes).
 */
export function cellsCoveredBySelection(state: EditorState): Set<number> {
  const sel = state.selection;
  if (sel instanceof CellSelection) {
    return new Set(selectedCells(state)?.cellPositions ?? []);
  }
  const covered = new Set<number>();
  if (sel.empty) return covered;
  const { from, to } = sel;
  state.doc.nodesBetween(from, to, (node, pos) => {
    const name = node.type.name;
    if ((name === "tableCell" || name === "tableHeader") && from <= pos && to >= pos + node.nodeSize) {
      covered.add(pos);
    }
    return true;
  });
  return covered;
}

/**
 * Overlay handler that washes the covered cells. Cell washing lives here (not in
 * the behavior's `geometry`) because a *text* selection running through a table
 * must wash it identically, and a text selection can't resolve the cell
 * behavior — one handler covers every selection kind. Cell rects come from the
 * Phase-4 layout: `cell.x` is absolute, `cell.y` is relative to the row's top.
 */
export function tableCellWashHandler(editor: IEditor): OverlayRenderHandler {
  return (ctx, pageNumber, _pageConfig, _charMap, theme) => {
    const covered = cellsCoveredBySelection(editor.getState());
    if (!covered.size) return;
    const page = editor.layout.pages.find((p) => p.pageNumber === pageNumber);
    if (!page) return;
    ctx.save();
    ctx.fillStyle = theme.selectionFill;
    for (const block of page.blocks) {
      if (block.kind !== "tableRow" || !block.cells) continue;
      for (const c of block.cells) {
        if (covered.has(c.cellPos)) ctx.fillRect(c.x, block.y + c.y, c.width, c.height);
      }
    }
    ctx.restore();
  };
}
