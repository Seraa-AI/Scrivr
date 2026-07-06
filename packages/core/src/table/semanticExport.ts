/**
 * SemanticUnit export for tables — extension-owned node handler (mirrors the
 * DOCX/PDF parity in `docxExport.ts` / `pdfExport.ts`). Registered via
 * `Table.addExports().semantic` so `@scrivr/export-semantic` stays free of
 * table-specific knowledge; the walker dispatches the `table` node here.
 *
 * A table is one semantic unit. GFM markdown can't encode merged cells, so:
 *   - no merges (all gridSpan===1 && vMerge==="none") → let the shared markdown
 *     serializer produce GFM (walker fallback);
 *   - any merge → suppress markdown (empty string) and rely on the structured
 *     `cells`, which preserve gridSpan / vMerge for the consumer.
 */
import type { Node } from "prosemirror-model";
import type {
  SemanticNodeHandler,
  TableCell,
  TableCellsRow,
} from "../exports/semantic";

function readGridSpan(cell: Node): number {
  const raw = cell.attrs["gridSpan"];
  return typeof raw === "number" && raw >= 1 ? raw : 1;
}

function readVMerge(cell: Node): TableCell["vMerge"] {
  const raw = cell.attrs["vMerge"];
  return raw === "restart" || raw === "continue" ? raw : "none";
}

export const tableSemanticHandler: SemanticNodeHandler = (node, ctx) => {
  const rows: TableCellsRow[] = [];
  let hasMerges = false;

  node.forEach((row) => {
    const cells: TableCell[] = [];
    row.forEach((cell) => {
      const gridSpan = readGridSpan(cell);
      const vMerge = readVMerge(cell);
      if (gridSpan !== 1 || vMerge !== "none") hasMerges = true;
      cells.push({
        // Keep structured cell text consistent with the unit's mark-aware text
        // (for example, pending tracked deletions must not leak into embeddings).
        text: ctx.toText(cell),
        gridSpan,
        vMerge,
        header: cell.type.name === "tableHeader",
      });
    });
    rows.push({ cells });
  });

  // Empty string is an explicit "no markdown" signal: the walker keeps it (?? only
  // falls back on nullish) and then omits a zero-length markdown field.
  return hasMerges
    ? { type: "table", cells: { rows }, markdown: "" }
    : { type: "table", cells: { rows } };
};
