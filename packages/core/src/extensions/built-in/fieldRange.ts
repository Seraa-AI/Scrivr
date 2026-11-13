import { Plugin, PluginKey, TextSelection, type Command, type Transaction } from "prosemirror-state";
import type { Mark, MarkType, Node as PmNode } from "prosemirror-model";
import { Mapping } from "prosemirror-transform";
import { COLLAB_SYNC_META } from "./UniqueId";
import { fieldRoleColor } from "./fieldKinds";
import type { MarkDecorator } from "../types";
import type { PdfMarkHandler } from "../../exports/pdf";

/** What an author fills in as text: free text, or a date written as text. */
export type FieldRangeKind = "text" | "date";

export interface InsertFieldRangeOptions {
  kind: FieldRangeKind;
  /** Shown until the author types — Word's placeholder text. */
  prompt: string;
}

/** One field's text, as it lies in the document. */
interface FieldSpan {
  id: string;
  from: number;
  to: number;
  mark: Mark;
}

const idOf = (mark: Mark): string | null => {
  const id = mark.attrs["nodeId"];
  return typeof id === "string" && id.length > 0 ? id : null;
};

/**
 * Each field's contiguous runs of inline content — text and the line breaks
 * inside it — by id. Two runs under one id are a copy.
 */
function fieldSpans(doc: PmNode, type: MarkType): Map<string, FieldSpan[]> {
  const spans = new Map<string, FieldSpan[]>();
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    const mark = type.isInSet(node.marks);
    const id = mark ? idOf(mark) : null;
    if (!mark || id === null) return true;
    const runs = spans.get(id) ?? [];
    const last = runs.at(-1);
    if (last && last.to === pos) last.to = pos + node.nodeSize;
    else runs.push({ id, from: pos, to: pos + node.nodeSize, mark });
    spans.set(id, runs);
    return true;
  });
  return spans;
}

/** Whether any step touched text carrying a field, before or after. */
function touchesField(transactions: readonly Transaction[], type: MarkType): boolean {
  return transactions.some((tr) =>
    tr.steps.some((step, i) => {
      const before = tr.docs[i]!;
      const after = i + 1 < tr.docs.length ? tr.docs[i + 1]! : tr.doc;
      let touched = false;
      step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
        const clamp = (doc: PmNode, pos: number) => Math.max(0, Math.min(doc.content.size, pos));
        touched ||=
          before.rangeHasMark(clamp(before, oldStart - 1), clamp(before, oldEnd + 1), type) ||
          after.rangeHasMark(clamp(after, newStart - 1), clamp(after, newEnd + 1), type);
      });
      return touched;
    }),
  );
}

/** A field whose text was edited away entirely — and nothing around it — gets its placeholder back. */
function restorePlaceholders(
  tr: Transaction,
  before: Map<string, FieldSpan[]>,
  after: Map<string, FieldSpan[]>,
  mapping: Mapping,
  type: MarkType,
): void {
  for (const [id, runs] of before) {
    if (after.has(id)) continue;
    const { from, to, mark } = runs[0]!;
    const start = mapping.mapResult(from, -1);
    const end = mapping.mapResult(to, 1);
    if (start.deletedBefore || end.deletedAfter) continue;
    const prompt = String(mark.attrs["prompt"]);
    const at = tr.mapping.map(start.pos);
    tr.insertText(prompt, at, at);
    tr.addMark(at, at + prompt.length, type.create({ ...mark.attrs, placeholder: true }));
  }
}

/**
 * Keeps a field coherent through edits, as Word keeps a content control:
 * typed-over placeholder text becomes the value, emptied text becomes the
 * placeholder again, and a copy is a new field with an id of its own.
 */
function normalizeFields(
  transactions: readonly Transaction[],
  oldDoc: PmNode,
  newDoc: PmNode,
  type: MarkType,
  newTr: () => Transaction,
): Transaction | null {
  if (!touchesField(transactions, type)) return null;
  const mapping = new Mapping();
  for (const t of transactions) mapping.appendMapping(t.mapping);
  const before = fieldSpans(oldDoc, type);
  const after = fieldSpans(newDoc, type);
  const tr = newTr();

  for (const [id, runs] of after) {
    // The run holding the original's first character keeps the id.
    const origin = before.get(id)?.[0];
    const home = origin ? mapping.map(origin.from, -1) : runs[0]!.from;
    const keeper = runs.find((r) => r.from <= home && home < r.to) ?? runs[0]!;
    for (const run of runs) {
      const placeholder =
        run.mark.attrs["placeholder"] === true && newDoc.textBetween(run.from, run.to) === run.mark.attrs["prompt"];
      const nodeId = run === keeper ? id : crypto.randomUUID();
      if (nodeId === id && placeholder === run.mark.attrs["placeholder"]) continue;
      tr.addMark(run.from, run.to, type.create({ ...run.mark.attrs, nodeId, placeholder }));
    }
    if (origin?.mark.attrs["placeholder"] === true && runs.length === 1) {
      replacePlaceholder(tr, origin, keeper, mapping, type);
    }
  }
  restorePlaceholders(tr, before, after, mapping, type);
  return tr.docChanged ? tr : null;
}

/**
 * An edit to a placeholder replaces all of it, as in Word: what was typed
 * becomes the value, and a deletion that typed nothing leaves the prompt.
 */
function replacePlaceholder(tr: Transaction, origin: FieldSpan, run: FieldSpan, mapping: Mapping, type: MarkType): void {
  // Where each character of the prompt the edit left standing now is.
  const kept: number[] = [];
  for (let pos = origin.from; pos < origin.to; pos++) {
    const result = mapping.mapResult(pos, 1);
    if (!result.deletedAfter) kept.push(result.pos);
  }
  const typedNothing = kept.length === run.to - run.from;
  if (typedNothing && kept.length === origin.to - origin.from) return;
  if (typedNothing) {
    const prompt = String(run.mark.attrs["prompt"]);
    const from = tr.mapping.map(run.from);
    tr.insertText(prompt, from, tr.mapping.map(run.to));
    tr.addMark(from, from + prompt.length, type.create({ ...run.mark.attrs, placeholder: true }));
    return;
  }
  for (const pos of kept.reverse()) tr.delete(tr.mapping.map(pos), tr.mapping.map(pos + 1));
}

/** The placeholder a collapsed caret sits strictly inside, if any. */
function placeholderAround(doc: PmNode, pos: number, type: MarkType): { from: number; to: number } | null {
  const $pos = doc.resolve(pos);
  const mark = $pos.nodeAfter && $pos.nodeBefore ? type.isInSet($pos.nodeAfter.marks) : undefined;
  if (!mark || mark.attrs["placeholder"] !== true || !type.isInSet($pos.nodeBefore!.marks)) return null;
  const id = idOf(mark);
  const run = id === null ? undefined : fieldSpans(doc, type).get(id)?.find((r) => r.from < pos && pos < r.to);
  return run ? { from: run.from, to: run.to } : null;
}

export const fieldRangePluginKey = new PluginKey("fieldRange");

export function fieldRangePlugin(type: MarkType): Plugin {
  return new Plugin({
    key: fieldRangePluginKey,
    appendTransaction(transactions, oldState, newState) {
      // A collaborator's edit was normalized by its author already.
      if (transactions.some((t) => t.getMeta(COLLAB_SYNC_META))) return null;
      if (transactions.some((t) => t.docChanged)) {
        return normalizeFields(transactions, oldState.doc, newState.doc, type, () => newState.tr);
      }
      // A placeholder is taken whole, as Word selects it on click.
      const { selection } = newState;
      if (!selection.empty) return null;
      const around = placeholderAround(newState.doc, selection.from, type);
      return around ? newState.tr.setSelection(TextSelection.create(newState.doc, around.from, around.to)) : null;
    },
  });
}

/** Insert a placeholder at the caret, or turn the selected text into a filled field. */
export function insertFieldRange({ kind, prompt }: InsertFieldRangeOptions): Command {
  return (state, dispatch) => {
    const type = state.schema.marks["fieldRange"];
    if (!type || prompt.length === 0) return false;
    const { from, to, empty } = state.selection;
    if (!state.selection.$from.sameParent(state.selection.$to)) return false;
    if (!dispatch) return true;
    const mark = (placeholder: boolean) =>
      type.create({ nodeId: crypto.randomUUID(), kind, prompt, placeholder });
    const tr = state.tr;
    if (empty) {
      tr.insertText(prompt, from, to).addMark(from, from + prompt.length, mark(true));
    } else {
      tr.addMark(from, to, mark(false));
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Step out of a field at its end, so what is typed next is plain text — the
 * caret leaving a content control in Word. Bound to ArrowRight.
 */
export const exitFieldRange: Command = (state, dispatch) => {
  const type = state.schema.marks["fieldRange"];
  const { selection } = state;
  if (!type || !selection.empty) return false;
  const $pos = selection.$from;
  const marks = state.storedMarks ?? $pos.marks();
  if (!type.isInSet(marks)) return false;
  if ($pos.nodeAfter && type.isInSet($pos.nodeAfter.marks)) return false;
  if (dispatch) dispatch(state.tr.setStoredMarks(type.removeFromSet(marks)));
  return true;
};

/**
 * A prompt still showing is a blank, drawn in quiet ink like every field: its
 * text faint (a colour the author chose still wins), over a dotted rule in the
 * colour of a field the author fills. Filled, the text is the document's own.
 */
export const fieldRangeDecorator: MarkDecorator = {
  decorateDefaultFill(rect, theme) {
    return rect.markAttrs["placeholder"] === true ? theme.imagePlaceholderText : undefined;
  },
  decoratePost(ctx, rect) {
    if (rect.markAttrs["placeholder"] !== true) return;
    ctx.save();
    ctx.strokeStyle = fieldRoleColor(null);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(rect.x, rect.y + 2);
    ctx.lineTo(rect.x + rect.width, rect.y + 2);
    ctx.stroke();
    ctx.restore();
  },
};

export const fieldRangePdf: PdfMarkHandler = (mark, ctx) =>
  mark.attrs["placeholder"] === true
    ? { defaultColor: ctx.theme.imagePlaceholderText, underline: true, underlineColor: fieldRoleColor(null) }
    : {};
