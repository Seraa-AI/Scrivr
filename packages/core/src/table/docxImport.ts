/**
 * DOCX import for tables — the inverse of `docxExport.ts`, registered from the
 * same extension so one extension says what a table is in both directions.
 *
 * A cell's content is read with `ctx.walkBlocks`, not by this handler: a cell
 * holds ordinary blocks, and each of those belongs to whichever extension owns
 * it. This handler only rebuilds the grid around them.
 */
import type { Node } from "prosemirror-model";
import type { DocxBlockTransform, DocxTableCell } from "../exports/docx";

/** Cell attrs worth stating; the rest are schema defaults. */
function cellAttrs(cell: DocxTableCell): Record<string, unknown> | null {
  const attrs: Record<string, unknown> = {};
  if (cell.gridSpan > 1) attrs["gridSpan"] = cell.gridSpan;
  if (cell.vMerge !== "none") attrs["vMerge"] = cell.vMerge;
  if (cell.background) attrs["background"] = cell.background;
  return Object.keys(attrs).length > 0 ? attrs : null;
}

const importTable: DocxBlockTransform = (block, _content, ctx) => {
  if (block.type !== "table") return null;

  // The extension that registers this handler declares the table nodes, so in
  // an editor these lookups are narrowing rather than defence. A schema without
  // them is one a caller wired this handler into by hand.
  const tableType = ctx.schema.nodes["table"];
  const rowType = ctx.schema.nodes["tableRow"];
  const cellType = ctx.schema.nodes["tableCell"];
  const paragraphType = ctx.schema.nodes["paragraph"];
  if (!tableType || !rowType || !cellType || !paragraphType) {
    ctx.diagnostics.warn({
      code: "schema-missing-table",
      message: "Schema has no `table` / `tableRow` / `tableCell` / `paragraph` — table dropped",
      nodeType: "table",
    });
    return null;
  }
  const headerType = ctx.schema.nodes["tableHeader"] ?? cellType;

  const rowNodes: Node[] = [];
  for (const row of block.rows) {
    // A DOCX header row (`w:tblHeader`) carries no th/td distinction; its cells
    // are rebuilt as `tableHeader` so the round trip recovers header semantics.
    const rowCellType = row.repeatHeader ? headerType : cellType;
    const cellNodes: Node[] = [];

    for (const cell of row.cells) {
      const children = ctx.walkBlocks(cell.content);
      // `block+` requires at least one child.
      const content = children.length > 0 ? children : [paragraphType.create()];
      cellNodes.push(rowCellType.create(cellAttrs(cell), content));
    }

    if (cellNodes.length === 0) continue;
    rowNodes.push(rowType.create(row.repeatHeader ? { repeatHeader: true } : null, cellNodes));
  }

  if (rowNodes.length === 0) return null;
  return tableType.create(block.grid.length > 0 ? { grid: block.grid } : null, rowNodes);
};

/** Block handlers for `Table.addImports().docx.blocks`. */
export const tableDocxImportHandlers: Record<string, DocxBlockTransform> = {
  table: importTable,
};
