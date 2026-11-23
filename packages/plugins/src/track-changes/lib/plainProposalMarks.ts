import { sameMark, stableStringify, type InlineMark, type InlineSpan } from "@scrivr/core";
import type { Node as PMNode, Schema } from "@scrivr/core/pm";
import { bridgeable, buildAcceptedTextMap, collectAccepted, type AcceptedChar } from "./acceptedTextMap";
import { diffText, phraseReplacements, type PairedDiffOp } from "./diffText";

/**
 * The formatting of each character of a block's accepted text, a line break
 * included. The one reader of it: every offset a proposal is diffed and
 * compared at is an index into this sequence.
 */
export function acceptedMarksAt(block: PMNode, schema: Schema): InlineMark[][] {
  return collectAccepted(block, 0, schema).map((char) => char.marks);
}

/**
 * The formatting each character of a plain-text proposal takes, indexed by its
 * offset in the proposal, as typing does in Word: kept text keeps its own, a
 * replacement takes the formatting of the first character it replaces, and an
 * insertion takes the text's before it — or after it, at the start of the
 * block or a line. A mark that does not grow at its edge, such as a link, is
 * carried only into the inside of a run that has it.
 *
 * For a host writing a plain proposal itself, so its new words carry what the
 * tracked lanes would give them. `ops` are the block's accepted text diffed
 * against the proposal, as `phraseReplacements` gives them.
 */
export function plainProposalMarks(ops: readonly PairedDiffOp[], block: PMNode, schema: Schema): InlineMark[][] {
  const chars = collectAccepted(block, 0, schema);
  const grows = (mark: InlineMark) => schema.marks[mark.type]?.spec.inclusive !== false;
  const marksAt: InlineMark[][] = [];
  let accepted = 0;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.type === "keep") {
      for (let k = 0; k < op.text.length; k++) marksAt.push(chars[accepted + k]?.marks ?? []);
      accepted += op.text.length;
      continue;
    }
    // A phrase: this op and those after it, up to the next keep.
    let end = i;
    while (end + 1 < ops.length && ops[end + 1]!.type !== "keep") end++;
    const phrase = ops.slice(i, end + 1);
    const removed = phrase.reduce((sum, o) => sum + (o.type === "delete" ? o.text.length : 0), 0);
    const marks = replacedMarks(chars, accepted, removed) ?? insertedMarks(chars, accepted, grows);
    for (const o of phrase) {
      if (o.type === "delete") accepted += o.text.length;
      else for (let k = 0; k < o.text.length; k++) marksAt.push(marks);
    }
    i = end;
  }
  return marksAt;
}

/** The first character a replacement takes over, past any line break; none for an insertion. */
function replacedMarks(chars: readonly AcceptedChar[], from: number, removed: number): InlineMark[] | undefined {
  for (let k = from; k < from + removed; k++) if (chars[k] && !isBreak(chars[k])) return chars[k]!.marks;
  return undefined;
}

/** What text written at `at` takes: the text before it, or after it at a block or line start. */
function insertedMarks(chars: readonly AcceptedChar[], at: number, grows: (mark: InlineMark) => boolean): InlineMark[] {
  const before = chars[at - 1] && !isBreak(chars[at - 1]) ? chars[at - 1]!.marks : undefined;
  const after = chars[at] && !isBreak(chars[at]) ? chars[at]!.marks : undefined;
  const has = (side: readonly InlineMark[] | undefined, mark: InlineMark) => side?.some((m) => sameMark(m, mark)) ?? false;
  return (before ?? after ?? []).filter((mark) => grows(mark) || (has(before, mark) && has(after, mark)));
}

function isBreak(char: AcceptedChar | undefined): boolean {
  return char?.char === "\n";
}

/**
 * `text` as a block's new wording in runs, formatted by the plain-proposal
 * rule above: what an edit given only as words means for a block that already
 * has formatting.
 */
export function plainTextSpans(doc: PMNode, found: { node: PMNode; pos: number }, text: string, schema: Schema): InlineSpan[] {
  const { acceptedText, map } = buildAcceptedTextMap(found.node, found.pos, schema);
  const ops = phraseReplacements(diffText(acceptedText, text), (from, to) => bridgeable(doc, map, from, to));
  return groupToSpans(text, plainProposalMarks(ops, found.node, schema), 0, text.length);
}

/**
 * Group a slice of proposed text back into `InlineSpan`s for `spansToFragment`,
 * merging runs whose marks read the same. A newline stays: inside one block it
 * is a line break, never a block boundary.
 */
export function groupToSpans(text: string, charMarks: readonly InlineMark[][], start: number, end: number): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let i = start;
  while (i < end) {
    const marks = charMarks[i] ?? [];
    const signature = marksKey(marks);
    let j = i + 1;
    while (j < end && marksKey(charMarks[j] ?? []) === signature) j++;
    spans.push({ text: text.slice(i, j), marks });
    i = j;
  }
  return spans;
}

function marksKey(marks: readonly InlineMark[]): string {
  return marks.map((m) => `${m.type}:${stableStringify(m.attrs ?? {})}`).sort().join("|");
}
