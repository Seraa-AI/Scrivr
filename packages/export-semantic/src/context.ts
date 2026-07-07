import type {
  IBaseEditor,
  InlineMark,
  InlineSpan,
  SemanticChange,
  SemanticMarkHandler,
  SemanticRun,
  UnitCtx,
} from "@scrivr/core";
import type { Mark as PmMark, Node as PmNode } from "prosemirror-model";

/** Block attrs that are identity/level bookkeeping, not user styling. */
const NON_STYLING_ATTRS = new Set(["nodeId", "dataTracked", "level"]);

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

/** Describe a mark as `{ type, attrs? }`, dropping null attrs and `dataTracked`. */
function describeMark(mark: PmMark): InlineMark {
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mark.attrs)) {
    if (key === "dataTracked" || value === null || value === undefined) continue;
    attrs[key] = value;
  }
  return Object.keys(attrs).length > 0 ? { type: mark.type.name, attrs } : { type: mark.type.name };
}

/**
 * Formatting marks on a run — every mark EXCEPT those the semantic seam handles
 * (i.e. tracked changes, surfaced separately in `changes`). Order is the node's
 * mark order, so spans are deterministic.
 */
function formattingMarks(
  marks: readonly PmMark[],
  markHandlers: Record<string, SemanticMarkHandler>,
): InlineMark[] {
  return marks.filter((m) => !(m.type.name in markHandlers)).map(describeMark);
}

/** A block's non-default styling attrs, or undefined when it carries none. */
function describeAttrs(node: PmNode): Record<string, unknown> | undefined {
  const spec = node.type.spec.attrs;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node.attrs)) {
    if (NON_STYLING_ATTRS.has(key) || value === null || value === undefined) continue;
    const deflt = spec?.[key]?.default;
    if (value === deflt || JSON.stringify(value) === JSON.stringify(deflt)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const NEWLINE_SPAN: InlineSpan = { text: "\n", marks: [] };

/** Join per-block span groups with a newline span, dropping empty groups. */
function joinGroups(groups: InlineSpan[][]): InlineSpan[] {
  const out: InlineSpan[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    if (out.length > 0) out.push(NEWLINE_SPAN);
    out.push(...group);
  }
  return out;
}

/**
 * Walk a node into inline formatting runs (`spans`) plus review `changes`. The
 * semantic mark handlers are folded over each text run: a handler may drop the
 * run (excluded from spans) or retain structured changes. `spans` reconstruct
 * the plain text exactly, so `toText` derives from them.
 */
function extractSemantic(
  node: PmNode,
  markHandlers: Record<string, SemanticMarkHandler>,
  ctx: UnitCtx,
): { spans: InlineSpan[]; changes: SemanticChange[] } {
  if (node.isText) {
    let run: SemanticRun | null = { text: node.text ?? "" };
    for (const mark of node.marks) {
      const handler = markHandlers[mark.type.name];
      if (!handler) continue;
      run = handler(run, mark, ctx);
      if (run === null) return { spans: [], changes: [] };
    }
    const changes = run.changes ?? [];
    const spans = run.text.length > 0 ? [{ text: run.text, marks: formattingMarks(node.marks, markHandlers) }] : [];
    return { spans, changes };
  }

  // Preserve the semantic boundary of an explicit line break. Other inline leaf
  // nodes (e.g. images) have no intrinsic plain text.
  if (node.type.name === "hardBreak") return { spans: [NEWLINE_SPAN], changes: [] };

  const parts: { spans: InlineSpan[]; changes: SemanticChange[] }[] = [];
  node.forEach((child) => {
    parts.push(extractSemantic(child, markHandlers, ctx));
  });
  const changes = parts.flatMap((p) => p.changes);

  // A textblock (paragraph, heading) concatenates its inline runs; a block
  // container (list, table, cell) joins its block children with newlines.
  const spans = node.isTextblock
    ? parts.flatMap((p) => p.spans)
    : joinGroups(parts.map((p) => p.spans));
  return { spans, changes };
}

/**
 * Build the producer context: the bridge to the editor's markdown serializer
 * (reuse, don't reinvent) plus the mark-aware inline extractor.
 */
export function createUnitCtx(
  editor: IBaseEditor,
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
        // than crashing the whole emit. `text`/`spans`/`attrs` are the source
        // of truth for styling and are produced independently.
        return "";
      }
    },
    toSpans(nodes) {
      const list = Array.isArray(nodes) ? nodes : [nodes];
      return joinGroups(list.map((n) => extractSemantic(n, markHandlers, ctx).spans));
    },
    toText(nodes) {
      return ctx.toSpans(nodes).map((s) => s.text).join("");
    },
    toChanges(nodes) {
      const list = Array.isArray(nodes) ? nodes : [nodes];
      return list.flatMap((node) => extractSemantic(node, markHandlers, ctx).changes);
    },
    attrsOf(node) {
      return describeAttrs(node);
    },
    physicalColumns,
  };

  return ctx;
}
