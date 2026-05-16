import { Plugin, type EditorState, type Transaction } from "prosemirror-state";
import type { Node, NodeType } from "prosemirror-model";

/**
 * Document-validity normalisation for tables. Run from
 * `tableIntegrityPlugin.appendTransaction` so structural drift produced by
 * user edits, paste, or collab merges is silently repaired before the next
 * render.
 *
 * Rules applied (fixed-point loop):
 *   - Cells with `gridSpan < 1` → clamp to 1.
 *   - `vMerge: "continue"` cells with no preceding restart → reset to "none".
 *   - `table.grid` shorter than the widest row → extend with default widths.
 *   - Rows narrower than `table.grid` → pad with empty cells.
 *
 * Pure trim/shrink rules are deliberately NOT included — extending the grid
 * to fit content is preferred over discarding cells the user authored.
 *
 * Termination guard: rules iterate up to `MAX_ITERATIONS = 8`. If a malformed
 * input + a buggy repair rule looped forever the plugin's `appendTransaction`
 * would freeze the editor; the cap surfaces the issue via a console warning
 * instead.
 */
const MAX_ITERATIONS = 8;
const DEFAULT_COLUMN_WIDTH = 100;

export function normalizeTables(state: EditorState): Transaction | null {
  let tr = state.tr;
  let prevSteps = tr.steps.length;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    tr = repairCellAttrs(tr);
    tr = repairBrokenVMerge(tr);
    tr = extendGridToMaxRow(tr);
    tr = padRowsToGrid(tr);

    if (tr.steps.length === prevSteps) break;
    prevSteps = tr.steps.length;

    if (iter === MAX_ITERATIONS - 1) {
      console.warn(
        "[normalizeTables] hit iteration cap (N=8); doc may still be inconsistent",
      );
    }
  }

  return tr.docChanged ? tr : null;
}

// ── Rule 1: clamp cell.attrs.gridSpan to ≥ 1 ─────────────────────────────────

function repairCellAttrs(tr: Transaction): Transaction {
  const fixes: Array<{ pos: number; type: NodeType; attrs: Record<string, unknown> }> = [];

  tr.doc.descendants((node, pos) => {
    if (node.type.name !== "tableCell" && node.type.name !== "tableHeader") return true;
    const span = node.attrs["gridSpan"];
    if (typeof span !== "number" || !Number.isFinite(span) || !Number.isInteger(span) || span < 1) {
      fixes.push({ pos, type: node.type, attrs: { ...node.attrs, gridSpan: 1 } });
    }
    return true;
  });

  for (const fix of fixes) tr = tr.setNodeMarkup(fix.pos, fix.type, fix.attrs);
  return tr;
}

// ── Rule 2: vMerge "continue" with no preceding restart → reset to "none" ────

function repairBrokenVMerge(tr: Transaction): Transaction {
  const fixes: Array<{ pos: number; type: NodeType; attrs: Record<string, unknown> }> = [];

  tr.doc.descendants((tableNode, tablePos) => {
    if (tableNode.type.name !== "table") return true;

    let prevRowVMerge: Array<"none" | "restart" | "continue"> = [];

    tableNode.forEach((rowNode, rowOffset) => {
      const thisRowVMerge: Array<"none" | "restart" | "continue"> = [];
      let col = 0;

      rowNode.forEach((cellNode, cellOffsetInRow) => {
        const cellPos = tablePos + 1 + rowOffset + 1 + cellOffsetInRow;
        const span = readGridSpan(cellNode);
        const vMerge = readVMerge(cellNode);

        if (vMerge === "continue") {
          const above = prevRowVMerge[col];
          const isChainStart = above === "restart" || above === "continue";
          if (!isChainStart) {
            fixes.push({
              pos: cellPos,
              type: cellNode.type,
              attrs: { ...cellNode.attrs, vMerge: "none" },
            });
          }
        }

        for (let c = 0; c < span; c++) thisRowVMerge[col + c] = vMerge;
        col += span;
      });

      prevRowVMerge = thisRowVMerge;
    });

    return false; // don't descend — handled the table's contents above
  });

  for (const fix of fixes) tr = tr.setNodeMarkup(fix.pos, fix.type, fix.attrs);
  return tr;
}

// ── Rule 3: extend table.grid to cover the widest row ────────────────────────

function extendGridToMaxRow(tr: Transaction): Transaction {
  interface GridFix { pos: number; type: NodeType; attrs: Record<string, unknown> }
  const fixes: GridFix[] = [];

  tr.doc.descendants((tableNode, tablePos) => {
    if (tableNode.type.name !== "table") return true;

    const grid = readGrid(tableNode);
    let maxRowWidth = 0;
    tableNode.forEach((rowNode) => {
      let w = 0;
      rowNode.forEach((cellNode) => { w += readGridSpan(cellNode); });
      if (w > maxRowWidth) maxRowWidth = w;
    });

    if (grid.length < maxRowWidth) {
      const need = maxRowWidth - grid.length;
      const newGrid = [...grid, ...Array.from({ length: need }, () => DEFAULT_COLUMN_WIDTH)];
      fixes.push({
        pos: tablePos,
        type: tableNode.type,
        attrs: { ...tableNode.attrs, grid: newGrid },
      });
    }

    return false;
  });

  for (const fix of fixes) tr = tr.setNodeMarkup(fix.pos, fix.type, fix.attrs);
  return tr;
}

// ── Rule 4: pad rows narrower than table.grid with empty cells ───────────────

function padRowsToGrid(tr: Transaction): Transaction {
  interface PadFix { rowEndPos: number; cells: Node[] }
  const fixes: PadFix[] = [];

  tr.doc.descendants((tableNode, tablePos) => {
    if (tableNode.type.name !== "table") return true;

    const grid = readGrid(tableNode);
    if (grid.length === 0) return false; // wait for extendGridToMaxRow next pass

    const cellType = tableNode.type.schema.nodes["tableCell"];
    const paragraphType = tableNode.type.schema.nodes["paragraph"];
    if (!cellType || !paragraphType) return false;

    tableNode.forEach((rowNode, rowOffset) => {
      let rowWidth = 0;
      rowNode.forEach((cellNode) => { rowWidth += readGridSpan(cellNode); });
      if (rowWidth >= grid.length) return;

      const need = grid.length - rowWidth;
      const newCells = Array.from({ length: need }, () =>
        cellType.create({ gridSpan: 1, vMerge: "none" }, paragraphType.create()),
      );
      const rowEndPos = tablePos + 1 + rowOffset + rowNode.nodeSize - 1;
      fixes.push({ rowEndPos, cells: newCells });
    });

    return false;
  });

  // Apply in descending position order so earlier inserts don't shift later positions.
  fixes.sort((a, b) => b.rowEndPos - a.rowEndPos);
  for (const fix of fixes) tr = tr.insert(fix.rowEndPos, fix.cells);
  return tr;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readGrid(table: Node): number[] {
  const v = table.attrs["grid"];
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) if (typeof x === "number" && Number.isFinite(x)) out.push(x);
  return out;
}

function readGridSpan(cell: Node): number {
  const v = cell.attrs["gridSpan"];
  if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 1) return v;
  return 1;
}

function readVMerge(cell: Node): "none" | "restart" | "continue" {
  const v = cell.attrs["vMerge"];
  if (v === "restart" || v === "continue") return v;
  return "none";
}

/**
 * ProseMirror plugin that runs `normalizeTables` on every transaction whose
 * doc changed. Returned transaction is appended (no separate dispatch needed,
 * no separate undo step generated).
 *
 * Document-validity only — editing-UX guards (cross-cell selection promotion,
 * Tab navigation, Backspace at empty-cell boundaries) live in a separate
 * plugin so the two concerns stay testable in isolation.
 */
export function tableIntegrityPlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      // Skip if no transaction changed the doc — saves a full descendants walk
      // on selection-only changes (which fire constantly during cursor moves).
      if (!transactions.some((t) => t.docChanged)) return null;
      return normalizeTables(newState);
    },
  });
}
