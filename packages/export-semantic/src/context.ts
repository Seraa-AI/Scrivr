import { describeInlineMark, stableStringify } from "@scrivr/core";
import type {
  IBaseEditor,
  InlineMark,
  InlineSpan,
  SemanticChange,
  SemanticRun,
  UnitCtx,
} from "@scrivr/core";
import type { Mark as PmMark, Node as PmNode } from "@scrivr/core/pm";
import type { ResolvedHandlers } from "./collectHandlers";

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

/** What reads a node's text and its review changes. */
type Readers = Pick<ResolvedHandlers, "marks" | "removers" | "nodeChangers" | "markRemovers">;

/**
 * Formatting marks on a run — every mark EXCEPT those the semantic seam handles
 * (tracked changes, surfaced separately in `changes`) and those the proposed
 * view takes off. Order is the node's mark order, so spans are deterministic.
 */
function formattingMarks(marks: readonly PmMark[], readers: Readers): InlineMark[] {
  return marks
    .filter((m) => !(m.type.name in readers.marks) && !readers.markRemovers.some((removed) => removed(m)))
    .map(describeInlineMark);
}

const NEWLINE_SPAN: InlineSpan = { text: "\n", marks: [] };

/** A node's spans and the review changes in them, placed by offset into their text. */
interface Extracted {
  spans: InlineSpan[];
  changes: SemanticChange[];
}

const textOf = (spans: readonly InlineSpan[]) => spans.map((s) => s.text).join("");

const isLineBreak = (node: PmNode) => node.type.name === "hardBreak";

const endOf = (change: SemanticChange) => (change.at ?? 0) + (change.length ?? 0);

/**
 * Which change a piece joins: its act and type. A formatting change also keys
 * on the marks its text had, since each change states those.
 */
const actKey = (change: SemanticChange) => {
  if (change.id === undefined) return undefined;
  const key = `${change.type}:${change.id}`;
  return change.type === "suggestedAttrs" ? `${key}:${stableStringify(change.oldAttrs ?? null)}` : key;
};

/** Two pieces of one change, read in document order. */
function joinPieces(prev: SemanticChange, next: SemanticChange, separator: string): SemanticChange {
  const text = prev.text && next.text ? prev.text + separator + next.text : prev.text + next.text;
  const image = prev.image ?? next.image;
  // A deletion is not in the proposed text: it stays where its first piece stood.
  if (prev.type === "suggestedDelete") return { ...prev, text, length: 0, ...(image ? { image } : {}) };
  const at = Math.min(prev.at ?? 0, next.at ?? 0);
  return { ...prev, text, at, length: Math.max(endOf(prev), endOf(next)) - at, ...(image ? { image } : {}) };
}

/**
 * One change per act and type: an act's pieces join wherever they fall — split
 * across formatting runs, around another author's change, a block and its
 * text — and pieces from different blocks keep `separator`, the break between
 * them. A formatting change joins only touching runs that had the same marks.
 * An insertion with no text of its own (a moved block, a line break) reads the
 * text it spans.
 */
function mergeActs(changes: readonly SemanticChange[], text: string, separator: string): SemanticChange[] {
  const out: SemanticChange[] = [];
  const indexOfAct = new Map<string, number>();
  for (const change of changes) {
    const key = actKey(change);
    const index = key === undefined ? undefined : indexOfAct.get(key);
    const prev = index === undefined ? undefined : out[index];
    const touches = prev !== undefined && (change.type !== "suggestedAttrs" || change.at === endOf(prev));
    if (prev && index !== undefined && touches) {
      out[index] = joinPieces(prev, change, separator);
      continue;
    }
    if (key !== undefined) indexOfAct.set(key, out.length);
    out.push(change);
  }
  return out.map((change) =>
    change.type === "suggestedInsert" && change.text === "" && (change.length ?? 0) > 0
      ? { ...change, text: text.slice(change.at ?? 0, endOf(change)) }
      : change,
  );
}

/**
 * Join children's spans — with `separator` between non-empty ones, for block
 * children — and place their changes in the joined text.
 */
function joinExtracted(parts: readonly Extracted[], separator: InlineSpan | null): Extracted {
  const spans: InlineSpan[] = [];
  const changes: SemanticChange[] = [];
  let offset = 0;
  for (const part of parts) {
    if (separator && part.spans.length > 0 && spans.length > 0) {
      spans.push(separator);
      offset += separator.text.length;
    }
    changes.push(...part.changes.map((c) => ({ ...c, at: (c.at ?? 0) + offset })));
    spans.push(...part.spans);
    offset += textOf(part.spans).length;
  }
  return { spans, changes: mergeActs(changes, textOf(spans), separator?.text ?? "") };
}

/**
 * Walk a node into inline formatting runs (`spans`) plus review `changes`. The
 * semantic mark handlers are folded over each text run: a handler may drop the
 * run (excluded from spans) or retain structured changes. `spans` reconstruct
 * the plain text exactly, so `toText` derives from them, and every change is
 * placed by offset into that text.
 */
function extractSemantic(node: PmNode, readers: Readers, ctx: UnitCtx): Extracted {
  const content = extractContent(node, readers, ctx);
  const own = readers.nodeChangers.flatMap((changesOf) => changesOf(node, ctx));
  if (own.length === 0) return content;
  const text = textOf(content.spans);
  const covers: SemanticChange[] = [];
  const after: SemanticChange[] = [];
  for (const { change, place } of own) {
    if (place === "after") after.push({ ...change, at: text.length, length: 0 });
    else if (change.type === "suggestedDelete") {
      // A deleted line break has no span left to read it by.
      covers.push({ ...change, text: change.text || (isLineBreak(node) ? "\n" : ""), at: 0, length: 0 });
    } else covers.push({ ...change, at: 0, length: text.length });
  }
  return { spans: content.spans, changes: mergeActs([...covers, ...content.changes, ...after], text, "") };
}

function extractContent(node: PmNode, readers: Readers, ctx: UnitCtx): Extracted {
  if (node.isText) {
    let run: SemanticRun | null = { text: node.text ?? "" };
    for (const mark of node.marks) {
      const handler = readers.marks[mark.type.name];
      if (!handler) continue;
      run = handler(run, mark, ctx);
      if (run === null) return { spans: [], changes: [] };
    }
    const length = run.text.length;
    const changes = (run.changes ?? []).map((c) => ({ ...c, at: 0, length }));
    const spans = length > 0 ? [{ text: run.text, marks: formattingMarks(node.marks, readers) }] : [];
    return { spans, changes };
  }

  // Preserve the semantic boundary of an explicit line break, unless the
  // proposed view leaves it out. Other inline leaf nodes (e.g. images) have no
  // intrinsic plain text.
  if (isLineBreak(node)) return { spans: ctx.isRemoved(node) ? [] : [NEWLINE_SPAN], changes: [] };

  const parts: Extracted[] = [];
  node.forEach((child) => {
    parts.push(extractSemantic(child, readers, ctx));
  });

  // A textblock (paragraph, heading) concatenates its inline runs; a block
  // container (list, table, cell) joins its block children with newlines.
  return joinExtracted(parts, node.isTextblock ? null : NEWLINE_SPAN);
}

/**
 * Build the producer context: the bridge to the editor's markdown serializer
 * (reuse, don't reinvent) plus the mark-aware inline extractor.
 */
export function createUnitCtx(editor: IBaseEditor, handlers: Partial<Readers> = {}): UnitCtx {
  const doc = editor.getState().doc;
  const schema = doc.type.schema;
  const serializer = editor.getMarkdownSerializer();
  const readers: Readers = {
    marks: handlers.marks ?? {},
    removers: handlers.removers ?? [],
    nodeChangers: handlers.nodeChangers ?? [],
    markRemovers: handlers.markRemovers ?? [],
  };

  const extractAll = (nodes: PmNode | readonly PmNode[]): Extracted => {
    const list = Array.isArray(nodes) ? nodes : [nodes];
    return joinExtracted(list.map((n) => extractSemantic(n, readers, ctx)), NEWLINE_SPAN);
  };

  const ctx: UnitCtx = {
    schema,
    doc,
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
      return readers.removers.some((removed) => removed(node));
    },
    physicalColumns,
  };

  return ctx;
}
