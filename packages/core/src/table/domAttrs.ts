import type { DOMOutputSpec } from "prosemirror-model";
import type { CellHAlign, CellVAlign, CellVMerge } from "./attrs";
import { isHAlign, isVAlign, isVMerge, storableFill } from "./attrs";

/**
 * The HTML attribute layer for table nodes — one module owning both directions
 * of the mapping, so a value we emit is a value we can read back.
 *
 * Scrivr's cell attrs are Word-shaped (`gridSpan`, `vMerge`), while HTML says
 * `colspan` and `rowspan`. The two disagree about vertical merging in
 * particular: HTML puts `rowspan` on one cell and omits the covered cells,
 * whereas Word keeps a real cell per row and marks it `vMerge: "continue"`.
 * These helpers translate the per-cell values; expanding and collapsing the
 * covered rows needs the whole table and belongs to the caller.
 *
 * Everything here treats its input as hostile — the DOM it reads comes from the
 * clipboard, which means Word, Google Docs, or an arbitrary web page.
 */


/**
 * Upper bound on the columns one cell may claim. Every column a span claims
 * becomes a real cell in every row once the integrity pass pads the grid
 * (`normalize.ts`), so `colspan="100000"` would otherwise materialise a
 * document of empty cells. Word's own limit is 63 columns.
 *
 * Rows need no such bound: a vertical merge can only cover rows that already
 * exist, so `readRowSpan` clamps to its row group instead.
 */
const MAX_COLUMN_SPAN = 64;

/** True for a table cell element — `td` or `th`. */
export function isCell(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "td" || tag === "th";
}

// ── Reading ───────────────────────────────────────────────────────────────────

/**
 * Read a span attribute the way HTML parses a non-negative integer: an optional
 * `+`, then the digits it starts with, and nothing else. `2px` is 2, `1e3` is 1,
 * and anything with no leading digit — `.5`, `-1`, `nope` — is one span.
 *
 * `0` is returned as written, because it means different things for rows and
 * columns and only the caller knows which it is holding.
 */
function readSpanAttr(el: Element, name: string): number {
  const raw = el.getAttribute(name);
  if (raw === null) return 1;
  const digits = /^\+?(\d+)/.exec(raw.trim());
  if (!digits) return 1;
  const span = Number.parseInt(digits[1]!, 10);
  return Number.isFinite(span) ? span : 1;
}

/** `colspan` allocates columns, so it has an independent allocation limit. */
export function readGridSpan(el: Element): number {
  return Math.min(Math.max(1, readSpanAttr(el, "colspan")), MAX_COLUMN_SPAN);
}

/** A vertical merge can cover only existing rows in its own row group. */
export function readRowSpan(el: Element, rowsLeftInGroup: number): number {
  const span = readSpanAttr(el, "rowspan");
  return span === 0 ? rowsLeftInGroup : Math.min(span, rowsLeftInGroup);
}

/**
 * Reads a value the style sets, falling back to the presentational attribute.
 * CSS wins over the attribute because that is the order a browser paints them.
 */
function readStyledValue(el: HTMLElement, styleValue: string, attrName: string): string | null {
  const styled = styleValue.trim();
  if (styled !== "") return styled;
  const attr = el.getAttribute(attrName);
  const trimmed = attr === null ? "" : attr.trim();
  return trimmed === "" ? null : trimmed;
}

/** `text-align` / `align` → the cell's `hAlign`, or null to keep the default. */
export function readCellHAlign(el: HTMLElement): CellHAlign | null {
  const value = readStyledValue(el, el.style.textAlign, "align");
  if (value === null) return null;
  const lower = value.toLowerCase();
  return isHAlign(lower) ? lower : null;
}

/** `vertical-align` / `valign` → the cell's `vAlign`, or null to keep the default. */
export function readCellVAlign(el: HTMLElement): CellVAlign | null {
  const value = readStyledValue(el, el.style.verticalAlign, "valign");
  if (value === null) return null;
  const lower = value.toLowerCase();
  // HTML's vertical centre is "middle"; the model calls it "center".
  if (lower === "middle") return "center";
  return isVAlign(lower) ? lower : null;
}

/**
 * `data-vmerge` → the cell's vertical-merge role.
 *
 * HTML has no attribute for "this cell is covered by the one above" — it simply
 * omits the covered cells and puts `rowspan` on the survivor. The marker
 * carries the role across that gap within a single paste: `expandRowSpans`
 * writes it and `parseCellAttrs` reads it. It never leaves the editor —
 * `collapseRowSpans` strips it and states the merge as `rowspan` instead, so
 * markup on the clipboard is markup any editor understands.
 */
export function readCellVMerge(el: HTMLElement): CellVMerge {
  const raw = el.getAttribute("data-vmerge");
  if (raw === null) return "none";
  const lower = raw.trim().toLowerCase();
  return isVMerge(lower) ? lower : "none";
}

/** The cell's vertical-merge role → the marker `readCellVMerge` reads. */
export function cellVMergeAttrs(vMerge: CellVMerge): Record<string, string> {
  return vMerge === "none" ? {} : { "data-vmerge": vMerge };
}

/** `background-color` / `bgcolor` → the cell's fill, or null when it has none. */
export function readCellBackground(el: HTMLElement): string | null {
  const shorthand = el.style.background.trim();
  // A shorthand carrying an image is not a fill we can represent, and reading
  // past it to some other token would silently keep half of what was written.
  if (shorthand !== "" && /url\(/i.test(shorthand)) return null;

  const styled = el.style.backgroundColor.trim();
  const candidate = styled !== "" ? styled : readStyledValue(el, shorthand, "bgcolor");
  return candidate === null ? null : storableFill(candidate);
}

/**
 * CSS absolute units, in px. Word writes column widths in points; a font-
 * relative unit (`em`, `ch`) is left out because resolving it needs the font
 * the cell will be laid out in, which nobody knows at parse time.
 */
const UNIT_PX: Record<string, number> = {
  "": 1,
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
};

/** Reads one column's width in CSS px, or null when it is missing or relative. */
function readColWidth(col: Element): number | null {
  const styled = col instanceof HTMLElement ? col.style.width.trim() : "";
  const raw = styled !== "" ? styled : (col.getAttribute("width") ?? "");

  const measure = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/i.exec(raw.trim());
  if (!measure) return null;
  const unit = measure[2]!.toLowerCase();
  const scale = Object.hasOwn(UNIT_PX, unit) ? UNIT_PX[unit] : undefined;
  if (scale === undefined) return null;

  const width = Number.parseFloat(measure[1]!) * scale;
  return Number.isFinite(width) && width > 0 ? width : null;
}

/**
 * `<colgroup>` → the table's `grid` of column widths in CSS px.
 *
 * Percentage widths need a container width nobody has at parse time, so a
 * relative grid reads as unset and the layout falls back to uniform columns.
 */
export function readTableGrid(el: HTMLElement): number[] {
  const cols = ownColumns(el);
  if (cols.length > 0) return widthsOf(cols);

  // Word states column widths on the cells of each row rather than in a
  // colgroup. The first row describes the grid — but only when no cell in it
  // spans, since one width across several columns cannot be split honestly.
  const firstRow = ownRows(el)[0];
  if (!firstRow) return [];
  const cells = Array.from(firstRow.children).filter(isCell);
  if (cells.some((cell) => readGridSpan(cell) > 1)) return [];
  return widthsOf(cells);
}

/**
 * The `<col>` elements describing this table's columns. A nested table's
 * columns describe a cell's content, not the table around it, so only
 * colgroups the table owns are read.
 */
function ownColumns(el: HTMLElement): Element[] {
  const cols: Element[] = [];
  for (const child of el.children) {
    if (child.tagName.toLowerCase() !== "colgroup") continue;
    for (const col of child.children) {
      if (col.tagName.toLowerCase() === "col") cols.push(col);
    }
  }
  return cols;
}

/** This table's own rows, skipping any belonging to a table inside a cell. */
function ownRows(el: HTMLElement): Element[] {
  return Array.from(el.querySelectorAll("tr")).filter((row) => row.closest("table") === el);
}

/**
 * The width each column is given, all or nothing: a grid describing only some
 * columns misaligns the rest. A `<col>` carrying a `span` describes that many
 * columns, all the same width.
 */
function widthsOf(elements: Iterable<Element>): number[] {
  const grid: number[] = [];
  for (const element of elements) {
    const width = readColWidth(element);
    if (width === null) return [];
    const columns = element.tagName.toLowerCase() === "col" ? readColSpan(element) : 1;
    for (let i = 0; i < columns; i++) grid.push(width);
  }
  return grid;
}

/**
 * `<col span>` allocates columns just like a cell's `colspan`. HTML reads a
 * span of `0` as the rest of the colgroup, which needs a column count nobody
 * has at parse time, so it describes the one column it certainly does.
 */
function readColSpan(col: Element): number {
  return Math.min(Math.max(1, readSpanAttr(col, "span")), MAX_COLUMN_SPAN);
}

// ── Emitting ──────────────────────────────────────────────────────────────────

/**
 * `gridSpan` → `colspan`, omitting HTML's default of one column. `rowspan` has
 * no counterpart here: a cell cannot see the rows it covers, so
 * `collapseRowSpans` writes it where the whole table is in view.
 */
export function cellColspanAttrs(gridSpan: number): Record<string, string> {
  return gridSpan > 1 ? { colspan: String(gridSpan) } : {};
}

export interface CellPresentation {
  hAlign: CellHAlign | null;
  vAlign: CellVAlign | null;
  background: string | null;
}

/** Alignment and fill → the inline style other editors read on paste. */
export function cellPresentationAttrs(cell: CellPresentation): Record<string, string> {
  const declarations: string[] = [];
  if (cell.hAlign !== null) declarations.push(`text-align: ${cell.hAlign}`);
  if (cell.vAlign !== null) {
    declarations.push(`vertical-align: ${cell.vAlign === "center" ? "middle" : cell.vAlign}`);
  }
  if (cell.background !== null) declarations.push(`background-color: ${cell.background}`);
  return declarations.length > 0 ? { style: declarations.join("; ") } : {};
}

/** The table's `grid` → a `<colgroup>`, or null when the grid is unset. */
export function tableColgroupSpec(grid: number[]): DOMOutputSpec | null {
  if (grid.length === 0) return null;
  return ["colgroup", ...grid.map((width) => ["col", { width: String(width) }])];
}
