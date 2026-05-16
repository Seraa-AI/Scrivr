import type { Node } from "prosemirror-model";

/**
 * TableMap — a grid view of a `table` node. Used by the layout engine, hit
 * testing, and editing commands so they can ask geometric questions ("which
 * cell sits at row 2, col 3?") without re-walking the doc tree on every call.
 *
 * Cell offsets stored here are positions **relative to the table's content
 * start** — i.e. the same `pos` value that `tableNode.descendants(fn)` yields
 * for that cell. Callers add the table's absolute doc position when they
 * need a full-document position.
 *
 * vMerge handling: the source-of-truth schema attrs are Word's
 * `vMerge: "restart" | "continue"` (DOCX-faithful). At build time we walk the
 * chain once and expose `rowSpanAt(cellOffset)` plus a unified `findCell`
 * rect, so consumers never re-walk a chain at query time. Broken chains
 * (continuation with no preceding restart, or row-misalignment) are
 * defensively treated as fresh placements — `normalizeTables` repairs the
 * doc itself in a separate pass.
 */
export interface Rect {
  /** Inclusive grid column index of the top-left corner. */
  left: number;
  /** Inclusive grid row index of the top-left corner. */
  top: number;
  /** Exclusive grid column index of the bottom-right corner. */
  right: number;
  /** Exclusive grid row index of the bottom-right corner. */
  bottom: number;
}

export interface TableMap {
  /** Number of grid columns (from `table.attrs.grid` or the widest row). */
  readonly width: number;
  /** Number of rows. */
  readonly height: number;
  /**
   * Row-major flat array of cell offsets. `map[row * width + col]` is the
   * cell offset occupying that grid slot. Slots not covered by any cell
   * (empty doc, missing continuation) hold `-1`.
   */
  readonly map: ReadonlyArray<number>;
  /** Row span derived during build — never walks a chain at query time. */
  rowSpanAt(cellOffset: number): number;
  /** Bounding rect of the cell (top-left inclusive, bottom-right exclusive). */
  findCell(cellOffset: number): Rect;
  /** Unique cell offsets whose grid coverage intersects `rect`. */
  cellsInRect(rect: Rect): number[];
  /** Cell at (row, col) or `null` if out of range / empty slot. */
  positionAt(row: number, col: number): number | null;
}

const cache = new WeakMap<Node, TableMap>();

/**
 * Returns a cached TableMap for `table`. Identity-keyed: a structural change
 * to the table produces a new node, which invalidates the cache for free.
 * Non-structural transactions reuse the same Node and hence the same map.
 */
export function getTableMap(table: Node): TableMap {
  const cached = cache.get(table);
  if (cached) return cached;
  const built = buildTableMap(table);
  cache.set(table, built);
  return built;
}

/** Build a TableMap fresh, bypassing the cache. Exposed for tests. */
export function buildTableMap(table: Node): TableMap {
  const grid = readGridAttr(table);
  const height = table.childCount;
  const width = computeWidth(table, grid);

  const map = new Array<number>(width * height).fill(-1);
  const cellRects = new Map<number, Rect>();
  const cellRowSpans = new Map<number, number>();

  let rowIdx = 0;
  table.forEach((rowNode, rowOffset) => {
    let col = 0;
    rowNode.forEach((cellNode, cellOffsetInRow) => {
      // Skip slots already claimed by an active vMerge from above.
      while (col < width && map[rowIdx * width + col] !== -1) col++;
      if (col >= width) return;

      const cellOffset = rowOffset + 1 + cellOffsetInRow;
      const gridSpan = readGridSpan(cellNode);
      const vMerge = readVMerge(cellNode);

      if (vMerge === "continue" && rowIdx > 0) {
        const above = map[(rowIdx - 1) * width + col] ?? -1;
        if (above !== -1 && cellRects.has(above)) {
          extendRect(cellRects, cellRowSpans, above, rowIdx);
          for (let c = col; c < col + gridSpan && c < width; c++) {
            map[rowIdx * width + c] = above;
          }
          col += gridSpan;
          return;
        }
        // Fall through to fresh placement — chain is broken; defensively
        // treat as restart so queries still resolve.
      }

      cellRects.set(cellOffset, {
        left: col,
        top: rowIdx,
        right: Math.min(col + gridSpan, width),
        bottom: rowIdx + 1,
      });
      cellRowSpans.set(cellOffset, 1);
      for (let c = col; c < col + gridSpan && c < width; c++) {
        map[rowIdx * width + c] = cellOffset;
      }
      col += gridSpan;
    });
    rowIdx++;
  });

  return Object.freeze({
    width,
    height,
    map,
    rowSpanAt(cellOffset: number): number {
      return cellRowSpans.get(cellOffset) ?? 0;
    },
    findCell(cellOffset: number): Rect {
      const r = cellRects.get(cellOffset);
      if (!r) {
        throw new Error(`TableMap: no cell registered at offset ${cellOffset}`);
      }
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    },
    cellsInRect(rect: Rect): number[] {
      const seen = new Set<number>();
      const out: number[] = [];
      const top = Math.max(0, rect.top);
      const left = Math.max(0, rect.left);
      const bottom = Math.min(height, rect.bottom);
      const right = Math.min(width, rect.right);
      for (let row = top; row < bottom; row++) {
        for (let col = left; col < right; col++) {
          const offset = map[row * width + col]!;
          if (offset !== -1 && !seen.has(offset)) {
            seen.add(offset);
            out.push(offset);
          }
        }
      }
      return out;
    },
    positionAt(row: number, col: number): number | null {
      if (row < 0 || row >= height || col < 0 || col >= width) return null;
      const offset = map[row * width + col]!;
      return offset === -1 ? null : offset;
    },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readGridAttr(table: Node): number[] {
  const raw = table.attrs["grid"];
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const item of raw) {
    if (typeof item === "number" && Number.isFinite(item)) out.push(item);
  }
  return out;
}

function computeWidth(table: Node, grid: number[]): number {
  if (grid.length > 0) return grid.length;
  let width = 0;
  table.forEach((rowNode) => {
    let rowWidth = 0;
    rowNode.forEach((cellNode) => { rowWidth += readGridSpan(cellNode); });
    if (rowWidth > width) width = rowWidth;
  });
  return width;
}

function readGridSpan(cell: Node): number {
  const v = cell.attrs["gridSpan"];
  if (typeof v === "number" && Number.isFinite(v) && v >= 1) return Math.floor(v);
  return 1;
}

function readVMerge(cell: Node): "none" | "restart" | "continue" {
  const v = cell.attrs["vMerge"];
  if (v === "restart" || v === "continue") return v;
  return "none";
}

function extendRect(
  rects: Map<number, Rect>,
  rowSpans: Map<number, number>,
  cellOffset: number,
  newBottomRowIdx: number,
): void {
  const r = rects.get(cellOffset);
  if (!r) return;
  r.bottom = newBottomRowIdx + 1;
  rowSpans.set(cellOffset, (rowSpans.get(cellOffset) ?? 1) + 1);
}
