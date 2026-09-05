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
import { cellGridSpan, cellVMerge } from "./attrs";

export const tableSemanticHandler: SemanticNodeHandler = (node, ctx) => {
  const rows: TableCellsRow[] = [];
  let hasMerges = false;

  node.forEach((row) => {
    const cells: TableCell[] = [];
    row.forEach((cell) => {
      const gridSpan = cellGridSpan(cell);
      const vMerge = cellVMerge(cell);
      const changes = ctx.toChanges(cell);
      const attrs = ctx.attrsOf(cell);
      const spans = ctx.toSpans(cell);
      if (gridSpan !== 1 || vMerge !== "none") hasMerges = true;
      cells.push({
        // Keep structured cell text consistent with the unit's mark-aware text
        // (for example, pending tracked deletions must not leak into embeddings).
        text: ctx.toText(cell),
        ...(attrs ? { attrs } : {}),
        ...(spans.some((s) => s.marks.length > 0) ? { spans } : {}),
        ...(changes.length > 0 ? { changes } : {}),
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
