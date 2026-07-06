import type { BaseEditor, SemanticMarkHandler, SemanticRun, UnitCtx } from "@scrivr/core";
import type { Node as PmNode } from "prosemirror-model";

function readGridSpan(cell: PmNode): number {
  const raw = cell.attrs["gridSpan"];
  return typeof raw === "number" && raw >= 1 ? raw : 1;
}

/**
 * Physical column count = max over rows of Σ gridSpan. `TableMap.width` trusts
 * `table.attrs.grid`, which can be shorter than the rows actually are — so the
 * summed span is the safe basis. Mirrors `core`'s `maxPhysicalColumns`.
 */
function physicalColumns(table: PmNode): number {
  let max = 0;
  table.forEach((row) => {
    let w = 0;
    row.forEach((cell) => {
      w += readGridSpan(cell);
    });
    if (w > max) max = w;
  });
  return max;
}

/**
 * Plain text for embedding. Walks inline text nodes and folds the semantic mark
 * handlers over each run — a handler returning `null` drops the run (this is how
 * `trackedDelete` keeps deleted content out of embeddings). Block boundaries
 * join with a newline; inline content within a textblock concatenates.
 */
function extractText(
  node: PmNode,
  markHandlers: Record<string, SemanticMarkHandler>,
  ctx: UnitCtx,
): string {
  if (node.isText) {
    let run: SemanticRun | null = { text: node.text ?? "" };
    for (const mark of node.marks) {
      const handler = markHandlers[mark.type.name];
      if (!handler) continue;
      run = handler(run, mark, ctx);
      if (run === null) return "";
    }
    return run.text;
  }

  const parts: string[] = [];
  node.forEach((child) => {
    parts.push(extractText(child, markHandlers, ctx));
  });

  // A textblock (paragraph, heading) concatenates its inline runs; a block
  // container (list, table, cell) joins its block children with newlines.
  if (node.isTextblock) return parts.join("");
  return parts.filter((p) => p.length > 0).join("\n");
}

/**
 * Build the producer context: the bridge to the editor's markdown serializer
 * (reuse, don't reinvent) plus the mark-aware text extractor.
 */
export function createUnitCtx(
  editor: BaseEditor,
  markHandlers: Record<string, SemanticMarkHandler>,
): UnitCtx {
  const schema = editor.getState().doc.type.schema;
  const serializer = editor.getMarkdownSerializer();

  const ctx: UnitCtx = {
    schema,
    toMarkdown(nodes) {
      const list = Array.isArray(nodes) ? nodes : [nodes];
      // Wrap the block(s) in a fresh doc so the serializer renders them as
      // top-level blocks (list markers, headings, etc. come out correct).
      const wrapper = schema.topNodeType.create(null, list);
      try {
        return serializer.serialize(wrapper).replace(/\n+$/, "");
      } catch {
        // markdown is best-effort: a node or mark without a serializer rule
        // (pageBreak, tracked marks, custom nodes) yields no markdown rather
        // than crashing the whole emit. The load-bearing `text` field is
        // produced independently and stays correct.
        return "";
      }
    },
    toText(nodes) {
      const list = Array.isArray(nodes) ? nodes : [nodes];
      return list
        .map((n) => extractText(n, markHandlers, ctx))
        .filter((t) => t.length > 0)
        .join("\n");
    },
    physicalColumns,
  };

  return ctx;
}
