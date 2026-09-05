import type { DOMOutputSpec } from "prosemirror-model";

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

export const VALID_HALIGNS = ["left", "center", "right", "justify"] as const;
export const VALID_VALIGNS = ["top", "center", "bottom"] as const;
export const VALID_VMERGE = ["none", "restart", "continue"] as const;

export type CellHAlign = (typeof VALID_HALIGNS)[number];
export type CellVAlign = (typeof VALID_VALIGNS)[number];

/**
 * Upper bound on a single cell's span. A pasted `colspan="100000"` would
 * otherwise have the integrity pass pad every row out to match it.
 */
const MAX_SPAN = 1000;

/** CSS keywords that mean "no colour of my own" — the same as an unset fill. */
const NON_COLOURS = new Set([
  "transparent",
  "inherit",
  "initial",
  "unset",
  "revert",
  "currentcolor",
  "none",
  "auto",
]);

const HEX_COLOUR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL_COLOUR = /^(?:rgb|rgba|hsl|hsla)\([\d\s.,%/+-]*\)$/i;
const NAMED_COLOUR = /^[a-z]{3,20}$/i;

// ── Reading ───────────────────────────────────────────────────────────────────

function readSpanAttr(el: HTMLElement, name: string): number {
  const raw = el.getAttribute(name);
  if (raw === null) return 1;
  const parsed = Number.parseFloat(raw.trim());
  if (!Number.isFinite(parsed)) return 1;
  const span = Math.floor(parsed);
  if (span < 1) return 1;
  return Math.min(span, MAX_SPAN);
}

/** `colspan` → the cell's `gridSpan`. */
export function readGridSpan(el: HTMLElement): number {
  return readSpanAttr(el, "colspan");
}

/**
 * `rowspan` → how many rows the cell covers. The caller turns a span above 1
 * into `vMerge: "restart"` plus continuation cells in the rows below.
 */
export function readRowSpan(el: HTMLElement): number {
  return readSpanAttr(el, "rowspan");
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

function isHAlign(value: string): value is CellHAlign {
  const candidates: readonly string[] = VALID_HALIGNS;
  return candidates.includes(value);
}

function isVAlign(value: string): value is CellVAlign {
  const candidates: readonly string[] = VALID_VALIGNS;
  return candidates.includes(value);
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

export type CellVMerge = (typeof VALID_VMERGE)[number];

function isVMerge(value: string): value is CellVMerge {
  const candidates: readonly string[] = VALID_VMERGE;
  return candidates.includes(value);
}

/**
 * `data-vmerge` → the cell's vertical-merge role.
 *
 * HTML has no attribute for "this cell is covered by the one above" — it simply
 * omits the covered cells and puts `rowspan` on the survivor. Scrivr keeps a
 * real cell per row, so a marker carries the role between the two shapes:
 * expanding `rowspan` writes it, and a copy of Scrivr's own markup reads it
 * back without the reader having to re-derive the merge from the table map.
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

/**
 * True when the value is a colour this editor can paint. A cell fill is only
 * ever painted, so anything that would resolve to a fetch (`url(...)`) or to
 * another value (`var(...)`) is not a colour for our purposes.
 */
function isColour(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (NON_COLOURS.has(trimmed.toLowerCase())) return false;
  return (
    HEX_COLOUR.test(trimmed) ||
    FUNCTIONAL_COLOUR.test(trimmed) ||
    NAMED_COLOUR.test(trimmed)
  );
}

/** `background-color` / `bgcolor` → the cell's fill, or null when it has none. */
export function readCellBackground(el: HTMLElement): string | null {
  const shorthand = el.style.background.trim();
  // A shorthand carrying an image is not a fill we can represent, and reading
  // past it to some other token would silently keep half of what was written.
  if (shorthand !== "" && /url\(/i.test(shorthand)) return null;

  const styled = el.style.backgroundColor.trim();
  const candidate = styled !== "" ? styled : readStyledValue(el, shorthand, "bgcolor");
  if (candidate === null) return null;
  return isColour(candidate) ? candidate : null;
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
  const scale = UNIT_PX[measure[2]!.toLowerCase()];
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
  const colgroup = el.querySelector("colgroup");
  if (colgroup) return widthsOf(colgroup.querySelectorAll("col"));

  // Word states column widths on the cells of each row rather than in a
  // colgroup. The first row describes the grid — but only when no cell in it
  // spans, since one width across several columns cannot be split honestly.
  const firstRow = el.querySelector("tr");
  if (!firstRow) return [];
  const cells = Array.from(firstRow.children).filter((child) => {
    const tag = child.tagName.toLowerCase();
    return tag === "td" || tag === "th";
  });
  if (cells.some((cell) => cell instanceof HTMLElement && readGridSpan(cell) > 1)) return [];
  return widthsOf(cells);
}

/** All-or-nothing: a grid describing only some columns misaligns the rest. */
function widthsOf(elements: Iterable<Element>): number[] {
  const grid: number[] = [];
  for (const element of elements) {
    const width = readColWidth(element);
    if (width === null) return [];
    grid.push(width);
  }
  return grid;
}

// ── Emitting ──────────────────────────────────────────────────────────────────

/** `gridSpan` + covered rows → `colspan`/`rowspan`, omitting HTML's defaults. */
export function cellSpanAttrs(gridSpan: number, rowSpan: number): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (gridSpan > 1) attrs["colspan"] = String(gridSpan);
  if (rowSpan > 1) attrs["rowspan"] = String(rowSpan);
  return attrs;
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
