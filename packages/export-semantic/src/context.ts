import { describeInlineMark } from "@scrivr/core";
import type {
  IBaseEditor,
  InlineMark,
  InlineSpan,
  SemanticChange,
  SemanticHandlers,
  SemanticMarkHandler,
  SemanticRun,
  UnitCtx,
} from "@scrivr/core";
import type { Mark as PmMark, Node as PmNode } from "@scrivr/core/pm";

/**
 * Attrs excluded from `attrsOf` — not user styling. Identity/level bookkeeping
 * (`nodeId`, `dataTracked`, `level`), and table structure that is either its own
 * field on the unit/cell (`gridSpan`, `vMerge`) or pure layout (`grid`, `hMerge`).
 */
const NON_STYLING_ATTRS = new Set([
  "nodeId",
  "dataTracked",
  "level",
  "grid",
  "gridSpan",
  "vMerge",
  "hMerge",
]);

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
 * Formatting marks on a run — every mark EXCEPT those the semantic seam handles
 * (i.e. tracked changes, surfaced separately in `changes`). Order is the node's
 * mark order, so spans are deterministic.
 */
function formattingMarks(
  marks: readonly PmMark[],
  markHandlers: Record<string, SemanticMarkHandler>,
): InlineMark[] {
  return marks.filter((m) => !(m.type.name in markHandlers)).map(describeInlineMark);
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

type NodeChanges = NonNullable<SemanticHandlers["nodeChanges"]>;

/** A node's spans and the review changes in them, placed by offset into their text. */
interface Extracted {
  spans: InlineSpan[];
  changes: SemanticChange[];
}

const textOf = (spans: readonly InlineSpan[]) => spans.map((s) => s.text).join("");

const shifted = (changes: readonly SemanticChange[], by: number): SemanticChange[] =>
  changes.map((c) => ({ ...c, at: (c.at ?? 0) + by }));

/**
 * One record reads as one change. Pieces that touch join, as a deletion split
 * across formatting runs does; a piece inside a record covering a whole node is
 * already part of it, as a new paragraph's text is part of the new paragraph.
 */
function mergePieces(changes: readonly SemanticChange[]): SemanticChange[] {
  const out: SemanticChange[] = [];
  for (const change of changes) {
    const prev = out[out.length - 1];
    if (prev && prev.id !== undefined && prev.id === change.id && prev.type === change.type) {
      const start = prev.at ?? 0;
      const end = start + (prev.length ?? 0);
      const at = change.at ?? 0;
      const changeEnd = at + (change.length ?? 0);
      if (at === end) {
        out[out.length - 1] = { ...prev, text: prev.text + change.text, length: changeEnd - start };
        continue;
      }
      if (at >= start && changeEnd <= end) continue;
    }
    out.push(change);
  }
  return out;
}

/** Join block children with a newline, dropping empty ones, and place their changes in the result. */
function joinExtracted(parts: readonly Extracted[]): Extracted {
  const spans: InlineSpan[] = [];
  const changes: SemanticChange[] = [];
  let offset = 0;
  for (const part of parts) {
    if (part.spans.length > 0 && spans.length > 0) {
      spans.push(NEWLINE_SPAN);
      offset += 1;
    }
    changes.push(...shifted(part.changes, offset));
    spans.push(...part.spans);
    offset += textOf(part.spans).length;
  }
  return { spans, changes: mergePieces(changes) };
}

/**
 * Walk a node into inline formatting runs (`spans`) plus review `changes`. The
 * semantic mark handlers are folded over each text run: a handler may drop the
 * run (excluded from spans) or retain structured changes. `spans` reconstruct
 * the plain text exactly, so `toText` derives from them, and every change is
 * placed by offset into that text.
 */
function extractSemantic(
  node: PmNode,
  markHandlers: Record<string, SemanticMarkHandler>,
  nodeChangers: readonly NodeChanges[],
  ctx: UnitCtx,
): Extracted {
  // A node's own records are read before its content's, so a contributor sees
  // a container before what it contains.
  const own = nodeChangers.flatMap((changesOf) => changesOf(node, ctx));
  const content = extractContent(node, markHandlers, nodeChangers, ctx);
  const text = textOf(content.spans);
  if (own.length === 0) return content;
  const covers: SemanticChange[] = [];
  const after: SemanticChange[] = [];
  for (const { change, place } of own) {
    if (place === "after") after.push({ ...change, at: text.length, length: 0 });
    else covers.push({ ...change, ...(change.type === "suggestedInsert" ? { text } : {}), at: 0, length: text.length });
  }
  return { spans: content.spans, changes: mergePieces([...covers, ...content.changes, ...after]) };
}

function extractContent(
  node: PmNode,
  markHandlers: Record<string, SemanticMarkHandler>,
  nodeChangers: readonly NodeChanges[],
  ctx: UnitCtx,
): Extracted {
  if (node.isText) {
    let run: SemanticRun | null = { text: node.text ?? "" };
    for (const mark of node.marks) {
      const handler = markHandlers[mark.type.name];
      if (!handler) continue;
      run = handler(run, mark, ctx);
      if (run === null) return { spans: [], changes: [] };
    }
    const length = run.text.length;
    const changes = (run.changes ?? []).map((c) => ({ ...c, at: 0, length }));
    const spans = length > 0 ? [{ text: run.text, marks: formattingMarks(node.marks, markHandlers) }] : [];
    return { spans, changes };
  }

  // Preserve the semantic boundary of an explicit line break. Other inline leaf
  // nodes (e.g. images) have no intrinsic plain text.
  if (node.type.name === "hardBreak") return { spans: [NEWLINE_SPAN], changes: [] };

  const parts: Extracted[] = [];
  node.forEach((child) => {
    parts.push(extractSemantic(child, markHandlers, nodeChangers, ctx));
  });

  // A textblock (paragraph, heading) concatenates its inline runs; a block
  // container (list, table, cell) joins its block children with newlines.
  if (!node.isTextblock) return joinExtracted(parts);
  const changes: SemanticChange[] = [];
  let offset = 0;
  for (const part of parts) {
    changes.push(...shifted(part.changes, offset));
    offset += textOf(part.spans).length;
  }
  return { spans: parts.flatMap((p) => p.spans), changes: mergePieces(changes) };
}

/**
 * Build the producer context: the bridge to the editor's markdown serializer
 * (reuse, don't reinvent) plus the mark-aware inline extractor.
 */
export function createUnitCtx(
  editor: IBaseEditor,
  markHandlers: Record<string, SemanticMarkHandler>,
  removers: ReadonlyArray<(node: PmNode) => boolean> = [],
  nodeChangers: readonly NodeChanges[] = [],
): UnitCtx {
  const schema = editor.getState().doc.type.schema;
  const serializer = editor.getMarkdownSerializer();

  const extractAll = (nodes: PmNode | readonly PmNode[]): Extracted => {
    const list = Array.isArray(nodes) ? nodes : [nodes];
    return joinExtracted(list.map((n) => extractSemantic(n, markHandlers, nodeChangers, ctx)));
  };

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
        // (pageBreak, custom nodes) yields no markdown rather
        // than crashing the whole emit. `text`/`spans`/`attrs` are the source
        // of truth for styling and are produced independently.
        return "";
      }
    },
    toSpans(nodes) {
      return extractAll(nodes).spans;
    },
    toText(nodes) {
      return textOf(ctx.toSpans(nodes));
    },
    toChanges(nodes) {
      return extractAll(nodes).changes;
    },
    attrsOf(node) {
      return describeAttrs(node);
    },
    isRemoved(node) {
      return removers.some((removed) => removed(node));
    },
    physicalColumns,
  };

  return ctx;
}
