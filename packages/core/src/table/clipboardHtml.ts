import { readGridSpan, readRowSpan } from "./domAttrs";

/**
 * Translates table markup between the clipboard's shape and the schema's, in
 * both directions.
 *
 * HTML expresses a vertical merge by omitting the covered cells and putting
 * `rowspan` on the survivor. Word — and so Scrivr — keeps a real cell in every
 * row and marks it as a continuation. Paste closes that gap before parsing:
 * once ProseMirror has read the markup, the covered rows are simply short, and
 * which columns they were short by is no longer recoverable. Copy closes it in
 * reverse, so what leaves the editor is markup any editor understands.
 */

interface Occupancy {
  /** Rows still covered by the merge, counting down as rows are visited. */
  remaining: number;
  /** The cell that started the merge — its tag and span are copied forward. */
  master: HTMLElement;
}

/** Expands every `rowspan` in `root` into explicit continuation cells. */
export function expandRowSpans(root: HTMLElement): void {
  for (const table of root.querySelectorAll("table")) {
    expandTable(table);
  }
}

function expandTable(table: HTMLElement): void {
  // A nested table's rows belong to it, not to the table around it.
  const rows = Array.from(table.querySelectorAll("tr")).filter(
    (row) => row.closest("table") === table,
  );

  // Column index → the merge currently covering it.
  const covered = new Map<number, Occupancy>();

  for (const row of rows) {
    const cells = Array.from(row.children).filter(isCell);
    let column = 0;
    let next = 0;

    while (next < cells.length || covered.size > 0) {
      const occupancy = covered.get(column);
      if (occupancy) {
        row.insertBefore(continuationOf(occupancy.master), cells[next] ?? null);
        const span = readGridSpan(occupancy.master);
        occupancy.remaining -= 1;
        if (occupancy.remaining <= 0) covered.delete(column);
        column += span;
        continue;
      }

      const cell = cells[next];
      if (!cell) break;
      next += 1;

      const rowSpan = readRowSpan(cell);
      if (rowSpan > 1) {
        cell.setAttribute("data-vmerge", "restart");
        // The expansion has said everything `rowspan` was saying.
        cell.removeAttribute("rowspan");
        covered.set(column, { remaining: rowSpan - 1, master: cell });
      }
      column += readGridSpan(cell);
    }
  }
}

/**
 * Collapses continuation cells back into `rowspan`, the only vertical merge
 * other editors understand. The continuation cells are removed: they exist to
 * hold a position in the grid, and the master's content is what the merge
 * displays.
 */
export function collapseRowSpans(root: HTMLElement): void {
  for (const table of root.querySelectorAll("table")) {
    collapseTable(table);
  }
}

function collapseTable(table: HTMLElement): void {
  const rows = Array.from(table.querySelectorAll("tr")).filter(
    (row) => row.closest("table") === table,
  );

  // Column index → the merge still collecting continuations below it.
  const open = new Map<number, { master: HTMLElement; rows: number }>();

  for (const row of rows) {
    let column = 0;
    for (const cell of Array.from(row.children).filter(isCell)) {
      const span = readGridSpan(cell);
      const merge = cell.getAttribute("data-vmerge");
      cell.removeAttribute("data-vmerge");

      if (merge === "continue") {
        const master = open.get(column);
        // A continuation whose master is outside the copied range is a cell in
        // its own right — the range starts partway down someone else's merge.
        if (master) {
          master.rows += 1;
          cell.remove();
          column += span;
          continue;
        }
      }

      // This cell takes the column, so whatever merge held it has ended.
      closeMerge(open.get(column));
      open.set(column, { master: cell, rows: 1 });
      column += span;
    }
  }

  for (const merge of open.values()) closeMerge(merge);
}

function closeMerge(merge: { master: HTMLElement; rows: number } | undefined): void {
  if (merge && merge.rows > 1) merge.master.setAttribute("rowspan", String(merge.rows));
}

function isCell(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "td" || tag === "th";
}

/** An empty cell standing in the same columns as the merge it continues. */
function continuationOf(master: HTMLElement): HTMLElement {
  const cell = master.ownerDocument.createElement(master.tagName.toLowerCase());
  cell.setAttribute("data-vmerge", "continue");
  const span = master.getAttribute("colspan");
  if (span !== null) cell.setAttribute("colspan", span);
  return cell;
}
