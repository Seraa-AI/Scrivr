/**
 * DOCX export for tables — extension-owned node handlers (mirrors the PDF
 * parity in `pdfExport.ts`). Registered via `Table.addExports()` so
 * `@scrivr/docx` stays free of table-specific knowledge, the same way the
 * walker already dispatches paragraphs and lists through contributed handlers.
 *
 * OOXML shape:
 *   <w:tbl>
 *     <w:tblPr> … borders … </w:tblPr>
 *     <w:tblGrid><w:gridCol w:w="…"/> …per column… </w:tblGrid>
 *     <w:tr>[<w:trPr><w:tblHeader/></w:trPr>] <w:tc>…</w:tc> … </w:tr>
 *   </w:tbl>
 *
 * Cell `<w:tc>` content arrives already-walked (paragraphs), so the handlers
 * only wrap structure. Word requires every `<w:tc>` to end in a block-level
 * element; our cells always hold paragraphs, so that holds.
 */
import { compositeColor, parseCssColor, toHex6 } from "../model/cssColor";
import { cellBackground, cellGridSpan, cellVMerge } from "./attrs";
import type { Node } from "prosemirror-model";
import { xml, pxToTwips, type DocxNodeHandler, type XmlNode } from "../exports/docx";

const BORDER_SIZE = "4"; // eighths of a point → 0.5pt, matching the canvas hairline.
const BORDER_COLOR = "9CA3AF"; // neutral gray, same as TableRowStrategy.

/**
 * DOCX shading takes six hex digits, while a cell's fill is whatever CSS
 * literal its source wrote — a name, a hex triple, `rgb(...)`, with or without
 * alpha. Resolving it is what keeps those from being dropped.
 */
function readHexFill(value: string | null): string | null {
  if (value === null) return null;
  const colour = parseCssColor(value);
  if (!colour || colour.alpha === 0) return null;
  // DOCX cell shading has no alpha; these documents use an unshaded white page.
  const opaque = compositeColor(colour, { r: 255, g: 255, b: 255 });
  return toHex6(opaque).toUpperCase();
}

/** Single-line borders on every edge so the table reads like the canvas grid. */
function tableBorders(): XmlNode {
  const edge = (name: string): XmlNode =>
    xml(`w:${name}`, { "w:val": "single", "w:sz": BORDER_SIZE, "w:space": "0", "w:color": BORDER_COLOR });
  return xml("w:tblBorders", undefined, [
    edge("top"),
    edge("left"),
    edge("bottom"),
    edge("right"),
    edge("insideH"),
    edge("insideV"),
  ]);
}

function gridFromTable(node: Node): number[] {
  const grid = node.attrs["grid"];
  if (Array.isArray(grid) && grid.length > 0 && grid.every((w) => typeof w === "number")) {
    return grid;
  }
  // No grid attr — derive column count from the first row's cells (summing
  // gridSpans) and split evenly so Word still gets a `<w:tblGrid>`.
  const firstRow = node.firstChild;
  let cols = 0;
  firstRow?.forEach((cell) => (cols += cellGridSpan(cell)));
  return Array.from({ length: Math.max(cols, 1) }, () => 100);
}

const tableHandler: DocxNodeHandler = (node, children) => {
  const grid = gridFromTable(node);
  // Fill the text area (Word/Docs fit a table to the page — matching the canvas,
  // which scales the grid to `availableWidth`). `pct` = fiftieths of a percent,
  // so 5000 = 100%; the `<w:gridCol>` widths then act as column proportions.
  // Auto width would render the raw grid px sum, which is much smaller than the
  // page and reads as a shrunken table.
  const tblPr = xml("w:tblPr", undefined, [
    xml("w:tblW", { "w:w": "5000", "w:type": "pct" }),
    tableBorders(),
  ]);
  const tblGrid = xml(
    "w:tblGrid",
    undefined,
    grid.map((w) => xml("w:gridCol", { "w:w": String(pxToTwips(w)) })),
  );
  return xml("w:tbl", undefined, [tblPr, tblGrid, ...children]);
};

const tableRowHandler: DocxNodeHandler = (node, children) => {
  const rowChildren: XmlNode[] = [];
  if (node.attrs["repeatHeader"] === true) {
    rowChildren.push(xml("w:trPr", undefined, [xml("w:tblHeader")]));
  }
  rowChildren.push(...children);
  return xml("w:tr", undefined, rowChildren);
};

const cellHandler: DocxNodeHandler = (node, children) => {
  const props: XmlNode[] = [];

  const gridSpan = cellGridSpan(node);
  if (gridSpan > 1) props.push(xml("w:gridSpan", { "w:val": String(gridSpan) }));

  const vMerge = cellVMerge(node);
  if (vMerge === "restart") props.push(xml("w:vMerge", { "w:val": "restart" }));
  else if (vMerge === "continue") props.push(xml("w:vMerge"));

  const fill = readHexFill(cellBackground(node));
  if (fill) props.push(xml("w:shd", { "w:val": "clear", "w:color": "auto", "w:fill": fill }));

  const tcChildren: XmlNode[] = [];
  if (props.length > 0) tcChildren.push(xml("w:tcPr", undefined, props));
  tcChildren.push(...children);
  return xml("w:tc", undefined, tcChildren);
};

/** Node handlers for `Table.addExports().docx.nodes`. */
export const tableDocxHandlers: Record<string, DocxNodeHandler> = {
  table: tableHandler,
  tableRow: tableRowHandler,
  tableCell: cellHandler,
  tableHeader: cellHandler,
};
