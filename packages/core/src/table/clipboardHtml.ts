import { isCell, readGridSpan, readRowSpan } from "./domAttrs";

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
 *
 * A merge belongs to one row group. HTML does not let a `rowspan` escape its
 * `thead`/`tbody`/`tfoot`, and browsers clamp one that tries, so each group is
 * translated on its own.
 */

interface Occupancy {
  /** Rows still covered by the merge, counting down as rows are visited. */
  remaining: number;
  /** The cell that started the merge — its tag and span are copied forward. */
  master: HTMLElement;
}

/** Expands every `rowspan` in `root` into explicit continuation cells. */
export function expandRowSpans(root: HTMLElement): void {
  for (const table of tablesIn(root)) {
    for (const rows of rowGroups(table)) expandGroup(rows);
  }
}

function expandGroup(rows: HTMLElement[]): void {
  // Column index → the merge currently covering it.
  const covered = new Map<number, Occupancy>();

  for (const [index, row] of rows.entries()) {
    const cells = Array.from(row.children).filter(isCell);
    let column = 0;
    let next = 0;

    for (;;) {
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
      if (!cell) {
        // The row ran out of cells, but a merge may still cover a column
        // further right. A ragged row is legal HTML, and the covered slot is
        // where it always was — so stand the row's missing slots up rather
        // than dropping the merge or hanging the continuation off the end.
        const ahead = nextCoveredColumn(covered, column);
        if (ahead === undefined) break;
        for (; column < ahead; column++) row.appendChild(fillerLike(row));
        continue;
      }
      next += 1;

      const rowSpan = readRowSpan(cell, rows.length - index);
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

/** The leftmost column at or right of `from` that a merge still covers. */
function nextCoveredColumn(covered: Map<number, Occupancy>, from: number): number | undefined {
  let found: number | undefined;
  for (const column of covered.keys()) {
    if (column >= from && (found === undefined || column < found)) found = column;
  }
  return found;
}

/**
 * Collapses continuation cells back into `rowspan`, the only vertical merge
 * other editors understand. The continuation cells are removed: they exist to
 * hold a position in the grid, and the master's content is what the merge
 * displays.
 */
export function collapseRowSpans(root: HTMLElement): void {
  for (const table of tablesIn(root)) {
    for (const rows of rowGroups(table)) collapseGroup(rows);
  }
}

interface OpenMerge {
  master: HTMLElement;
  rows: number;
}

function collapseGroup(rows: HTMLElement[]): void {
  // Column index → the merge still collecting continuations below it.
  const open = new Map<number, OpenMerge>();

  for (const row of rows) {
    let column = 0;
    for (const cell of Array.from(row.children).filter(isCell)) {
      const span = readGridSpan(cell);
      const role = cell.getAttribute("data-vmerge");
      cell.removeAttribute("data-vmerge");

      if (role === "continue") {
        const merge = open.get(column);
        // A continuation whose master is outside the copied range is a cell in
        // its own right — the range starts partway down someone else's merge.
        if (merge) {
          merge.rows += 1;
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

function closeMerge(merge: OpenMerge | undefined): void {
  if (merge && merge.rows > 1) merge.master.setAttribute("rowspan", String(merge.rows));
}

/** Every table under `root`, including `root` itself when it is one. */
function tablesIn(root: HTMLElement): HTMLElement[] {
  const tables: HTMLElement[] = Array.from(root.querySelectorAll("table"));
  if (root.tagName.toLowerCase() === "table") tables.unshift(root);
  return tables;
}

/**
 * The table's own rows, split into row groups in document order. A nested
 * table's rows belong to it, not to the table around it.
 */
function rowGroups(table: HTMLElement): HTMLElement[][] {
  const groups = new Map<Element, HTMLElement[]>();
  for (const row of table.querySelectorAll("tr")) {
    if (row.closest("table") !== table) continue;
    const group = row.closest("thead, tbody, tfoot") ?? table;
    const rows = groups.get(group);
    if (rows) rows.push(row);
    else groups.set(group, [row]);
  }
  return Array.from(groups.values());
}

/** An empty cell standing in the same columns as the merge it continues. */
function continuationOf(master: HTMLElement): HTMLElement {
  const cell = emptyCellLike(master);
  cell.setAttribute("data-vmerge", "continue");
  const span = master.getAttribute("colspan");
  if (span !== null) cell.setAttribute("colspan", span);
  return cell;
}

/** An empty cell of the same kind as the row's other cells. */
function fillerLike(row: HTMLElement): HTMLElement {
  const sibling = Array.from(row.children).find(isCell);
  return sibling ? emptyCellLike(sibling) : row.ownerDocument.createElement("td");
}

function emptyCellLike(model: HTMLElement): HTMLElement {
  return model.ownerDocument.createElement(model.tagName.toLowerCase());
}
