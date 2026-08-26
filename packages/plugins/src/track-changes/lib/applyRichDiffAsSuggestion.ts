/**
 * applyRichDiffAsSuggestion — the write half of Rich Semantic Merge.
 *
 * `applyDiffAsSuggestion` is plain-text in, plain-text out: the agent can't see
 * or express formatting. This is the rich counterpart. Each `RichBlockEdit`
 * carries the agent's intended inline runs (`spans`) and/or block styling
 * (`attrs`); the merge reconciles them against the LIVE document and lands the
 * differences as tracked-change suggestions (accept/reject), preserving
 * untouched formatting.
 *
 * Three kinds of change, all hand-built under `skipTracking` (the automatic
 * mark/attr trackers do NOT fire in a skip-tracked transaction):
 *   1. text insert/delete — same tracked marks as the plain path; inserted text
 *      carries the agent's intended formatting marks.
 *   2. mark add/remove on RETAINED text — the flagship "highlight this clause,
 *      no text change" case. `diffText`'s char-offset KEEP regions are aligned
 *      to the doc's and the agent's per-character mark sets; where they differ,
 *      a tracked mark add (insert op) or remove (delete op) is emitted.
 *   3. block `attrs` (align, indent) — a tracked `set_node_attributes`.
 *
 * Agent output is untrusted: marks pass through `resolveInlineMark` (unknown
 * type dropped, `link.href` sanitized), so a malformed edit never crashes the
 * merge or poisons the document. Multiple edits apply bottom-to-top so earlier
 * applications never invalidate later positions.
 */

import { Fragment, type Mark, type Node as PMNode, type Schema } from "@scrivr/core/pm";
import type { EditorState, Transaction } from "@scrivr/core/pm";
import {
  findNodeById,
  resolveInlineMark,
  sameMark,
  spansToFragment,
  stableStringify,
  type InlineMark,
  type InlineSpan,
} from "@scrivr/core";
import {
  addTrackIdIfDoesntExist,
  createNewDeleteAttrs,
  createNewInsertAttrs,
  createNewPendingAttrs,
  createNewUpdateAttrs,
  getBlockInlineTrackedData,
  type NewEmptyAttrs,
} from "../helpers";
import { CHANGE_STATUS } from "../types";
import { acceptedRangeToDocRange, type PosMapEntry } from "./acceptedTextMap";
import { clearAuthorPendingMarks } from "./applyDiffAsSuggestion";
import { diffText, expandCharLevel, pairReplacements } from "./diffText";
import { applyTrackedDelete } from "./splitRangeForNewMark";
import { setAction, skipTracking, TrackChangesAction } from "../actions";

// ── Public types ──────────────────────────────────────────────────────────────

/** One block's rich edit — the agent's intended inline runs and/or styling. */
export interface RichBlockEdit {
  /** Stable `nodeId` of the target block. */
  nodeId: string;
  /** New inline content as rich runs. Omit to leave inline content untouched. */
  spans?: InlineSpan[];
  /** New block styling (`align`, `indent`, `textIndent`). Omit to leave as-is. */
  attrs?: Record<string, unknown>;
  /**
   * The rich hash of the unit the agent edited. The stale-edit guard lives in
   * the caller (it owns the hash fn); this field is carried for that check and
   * ignored here.
   */
  expectedContentHash?: string;
}

export interface RichDiffOptions {
  edits: RichBlockEdit[];
  /** Author ID to attribute all suggestions to (e.g. "AI Assistant"). */
  authorID: string;
  /** Reports each dropped mark (unknown type / unsafe url) once per message. */
  onWarn?: (message: string) => void;
}

export interface RichDiffResult {
  /** true if at least one tracked change was applied and dispatched. */
  applied: boolean;
  /** nodeIds whose block was not found in the document. */
  notFound: string[];
  /**
   * nodeIds that resolved to a non-leaf node (a list/table container). Rich
   * inline edits address a single leaf textblock; a container target is
   * rejected untouched — edit its inner leaves by their own nodeId instead.
   */
  rejected: string[];
}

/** Block styling the agent may set in v1. Structural/type edits are v2. */
const ALLOWED_ATTRS = ["align", "indent", "textIndent"] as const;
const VALID_ALIGN = new Set(["left", "center", "right", "justify"]);

// ── Public API ──────────────────────────────────────────────────────────────

export function applyRichDiffAsSuggestion(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  { edits, authorID, onWarn }: RichDiffOptions,
): RichDiffResult {
  const notFound: string[] = [];
  const rejected: string[] = [];
  const resolved = edits.flatMap((edit) => {
    const found = findNodeById(state.doc, edit.nodeId);
    if (!found) {
      notFound.push(edit.nodeId);
      return [];
    }
    // Leaf-only: rich inline edits target a single textblock. A container
    // (list, table, cell wrapper) is rejected untouched — its inner leaves are
    // addressed individually by their own nodeId (see SemanticUnit.parts).
    if (!found.node.isTextblock) {
      rejected.push(edit.nodeId);
      onWarn?.(`[applyRichDiffAsSuggestion] nodeId "${edit.nodeId}" is a ${found.node.type.name}, not an editable leaf — skipped`);
      return [];
    }
    return [{ edit, pos: found.pos }];
  });

  if (resolved.length === 0) return { applied: false, notFound, rejected };

  // Bottom-to-top: process the lowest block first so inserts never shift the
  // positions of blocks above it that haven't been processed yet.
  resolved.sort((a, b) => b.pos - a.pos);

  const tr = state.tr;
  let applied = false;
  for (const { edit } of resolved) {
    if (applyRichBlockToTr(state.schema, tr, edit, authorID, onWarn)) applied = true;
  }

  if (!applied) return { applied: false, notFound, rejected };

  skipTracking(tr);
  setAction(tr, TrackChangesAction.refreshChanges, true);
  dispatch(tr);
  return { applied: true, notFound, rejected };
}

// ── Per-block workhorse ───────────────────────────────────────────────────────

function applyRichBlockToTr(
  schema: Schema,
  tr: Transaction,
  edit: RichBlockEdit,
  authorID: string,
  onWarn?: (message: string) => void,
): boolean {
  // Replacing inline intent supersedes this author's earlier inline suggestion.
  // Attribute-only edits are independent and must preserve pending text edits.
  const found = findNodeById(tr.doc, edit.nodeId);
  if (!found) return false;
  if (edit.spans) {
    clearAuthorPendingMarks(tr, found.pos, found.pos + found.node.nodeSize, authorID, schema);
  }

  const updated = findNodeById(tr.doc, edit.nodeId);
  if (!updated) return false;

  const now = Date.now();
  const base = (): NewEmptyAttrs => createNewPendingAttrs(now, authorID);
  let applied = false;

  // 1. Block attrs first — setNodeMarkup keeps the node's size, so inline
  //    positions computed below stay valid.
  if (edit.attrs && applyAttrsChange(tr, updated.pos, updated.node, edit.attrs, base())) {
    applied = true;
  }

  // 2. Inline content (text + marks).
  if (edit.spans && applyInlineChange(schema, tr, edit.nodeId, edit.spans, base, onWarn)) {
    applied = true;
  }

  return applied;
}

// ── Block attrs → tracked set_node_attributes ─────────────────────────────────

function applyAttrsChange(
  tr: Transaction,
  nodeFrom: number,
  node: PMNode,
  editAttrs: Record<string, unknown>,
  base: NewEmptyAttrs,
): boolean {
  const picked: Record<string, unknown> = {};
  let changed = false;
  for (const key of ALLOWED_ATTRS) {
    if (!(key in editAttrs) || !(key in node.attrs)) continue;
    const next = editAttrs[key];
    if (!isValidAttr(key, next) || next === node.attrs[key]) continue;
    picked[key] = next;
    changed = true;
  }
  if (!changed) return false;

  const existing = getBlockInlineTrackedData(node) ?? [];
  const dataTracked = [...existing, addTrackIdIfDoesntExist(createNewUpdateAttrs(base, node.attrs))];
  tr.setNodeMarkup(nodeFrom, undefined, { ...node.attrs, ...picked, dataTracked }, node.marks);
  return true;
}

function isValidAttr(key: string, value: unknown): boolean {
  if (key === "align") return typeof value === "string" && VALID_ALIGN.has(value);
  // indent / textIndent — a finite, non-negative number.
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// ── Inline content → tracked insert/delete/mark-change ────────────────────────

function applyInlineChange(
  schema: Schema,
  tr: Transaction,
  nodeId: string,
  spans: InlineSpan[],
  base: () => NewEmptyAttrs,
  onWarn?: (message: string) => void,
): boolean {
  const found = findNodeById(tr.doc, nodeId);
  if (!found) return false;

  const { acceptedText, map, charMarks } = buildAcceptedRichMap(found.node, found.pos, schema);
  const { text: proposedText, charMarks: proposedMarks } = expandSpans(spans);

  // Nothing to do when text and every char's mark set already match.
  const rawOps = diffText(acceptedText, proposedText);
  // diffText emits one keep op per token. Merge adjacent keeps so a formatting
  // change over a retained region is emitted as ONE mark-add (one tracking id)
  // spanning the whole region — correct even when the region is interleaved
  // with a pending trackedInsert that stops the text nodes from fusing.
  const ops = coalesceKeeps(expandCharLevel(pairReplacements(rawOps)));

  const insertType = schema.marks.trackedInsert;
  let aOff = 0; // cursor into acceptedText
  let pOff = 0; // cursor into proposedText
  let insertedChars = 0; // net doc offset from inserts made so far in this block
  let applied = false;

  for (const op of ops) {
    const len = op.text.length;

    if (op.type === "keep") {
      if (emitKeepMarkChanges(tr, schema, map, charMarks, proposedMarks, aOff, pOff, len, insertedChars, base, onWarn)) {
        applied = true;
      }
      aOff += len;
      pOff += len;
    } else if (op.type === "delete") {
      const range = acceptedRangeToDocRange(map, aOff, aOff + len);
      if (range) {
        const dataTracked = addTrackIdIfDoesntExist(createNewDeleteAttrs(base()));
        applyTrackedDelete(tr, range.from + insertedChars, range.to + insertedChars, dataTracked, schema);
        applied = true;
      }
      aOff += len;
    } else {
      // insert — text carrying the agent's intended marks at this proposed slice
      const range =
        acceptedRangeToDocRange(map, aOff, aOff) ??
        (acceptedText.length === 0 && aOff === 0 ? { from: found.pos + 1, to: found.pos + 1 } : null);
      if (range && insertType) {
        const subSpans = groupToSpans(proposedText, proposedMarks, pOff, pOff + len);
        const fragment = spansToFragment(subSpans, schema, onWarn ? { onWarn } : {});
        if (fragment.size > 0) {
          const at = range.from + insertedChars;
          const dataTracked = addTrackIdIfDoesntExist(createNewInsertAttrs(base()));
          tr.insert(at, addMarkToFragment(fragment, insertType.create({ dataTracked })));
          insertedChars += fragment.size;
          applied = true;
        }
      }
      pOff += len;
    }
  }

  return applied;
}

function addMarkToFragment(fragment: Fragment, mark: Mark): Fragment {
  const nodes: PMNode[] = [];
  fragment.forEach((node) => {
    if (node.isText) {
      nodes.push(node.mark(mark.addToSet(node.marks)));
      return;
    }
    nodes.push(node.copy(addMarkToFragment(node.content, mark)));
  });
  return Fragment.fromArray(nodes);
}

/**
 * On a retained (KEEP) region, emit a tracked mark add/remove wherever the
 * doc's per-char mark set differs from the agent's. Consecutive chars sharing
 * the same add/remove signature are coalesced into one range.
 */
function emitKeepMarkChanges(
  tr: Transaction,
  schema: Schema,
  map: PosMapEntry[],
  docMarks: InlineMark[][],
  proposedMarks: InlineMark[][],
  aOff: number,
  pOff: number,
  len: number,
  insertedChars: number,
  base: () => NewEmptyAttrs,
  onWarn?: (message: string) => void,
): boolean {
  let applied = false;
  let k = 0;
  while (k < len) {
    const added = diffMarks(proposedMarks[pOff + k] ?? [], docMarks[aOff + k] ?? []);
    const removed = diffMarks(docMarks[aOff + k] ?? [], proposedMarks[pOff + k] ?? []);
    const signature = markSignature(added, removed);

    let j = k + 1;
    while (
      j < len &&
      markSignature(
        diffMarks(proposedMarks[pOff + j] ?? [], docMarks[aOff + j] ?? []),
        diffMarks(docMarks[aOff + j] ?? [], proposedMarks[pOff + j] ?? []),
      ) === signature
    ) {
      j++;
    }

    if (added.length > 0 || removed.length > 0) {
      const range = acceptedRangeToDocRange(map, aOff + k, aOff + j);
      if (range) {
        const from = range.from + insertedChars;
        const to = range.to + insertedChars;
        for (const m of added) if (addTrackedMark(tr, schema, from, to, m, "insert", base(), onWarn)) applied = true;
        for (const m of removed) if (addTrackedMark(tr, schema, from, to, m, "delete", base(), onWarn)) applied = true;
      }
    }
    k = j;
  }
  return applied;
}

/** Re-create `mark` with tracking data and apply it (exclusion replaces the plain mark). */
function addTrackedMark(
  tr: Transaction,
  schema: Schema,
  from: number,
  to: number,
  inline: InlineMark,
  operation: "insert" | "delete",
  base: NewEmptyAttrs,
  onWarn?: (message: string) => void,
): boolean {
  const real = resolveInlineMark(inline, schema, onWarn);
  if (!real) return false;
  const dt = operation === "insert" ? createNewInsertAttrs(base) : createNewDeleteAttrs(base);
  const tracked = real.type.create({ ...real.attrs, dataTracked: [addTrackIdIfDoesntExist(dt)] });
  tr.addMark(from, to, tracked);
  return true;
}

// ── Mark-set helpers ──────────────────────────────────────────────────────────

/** Marks in `a` that are not in `b` (by attr-normalized equality). */
function diffMarks(a: InlineMark[], b: InlineMark[]): InlineMark[] {
  return a.filter((m) => !b.some((other) => sameMark(m, other)));
}

/** Order-independent key for an (added, removed) mark-change signature. */
function markSignature(added: InlineMark[], removed: InlineMark[]): string {
  const key = (m: InlineMark) => `${m.type}:${stableStringify(m.attrs ?? {})}`;
  return `+${added.map(key).sort().join("|")}#-${removed.map(key).sort().join("|")}`;
}

// ── Per-character views ───────────────────────────────────────────────────────

interface AcceptedRichMap {
  acceptedText: string;
  map: PosMapEntry[];
  /** Formatting marks on each accepted character (tracked-change marks excluded). */
  charMarks: InlineMark[][];
}

/** One accepted-view character: its doc position and the formatting marks on it. */
interface AcceptedChar {
  char: string;
  docPos: number;
  marks: InlineMark[];
}

/**
 * Reproduce the accepted-view text of a single LEAF textblock the agent was
 * shown by the semantic emitter, WITH each character's doc position and
 * formatting marks. Must mirror export-semantic's inline extraction exactly, or
 * a verbatim echo diffs as a full rewrite (whole-block churn):
 *  - text node → its chars, minus tracked-change marks (trackedDelete text
 *    excluded entirely, matching the review view);
 *  - hard break → a newline;
 *  - other inline leaf (e.g. image) → no intrinsic text.
 * Leaf-only by construction: containers are rejected upstream and their inner
 * leaves are edited by their own nodeId, so this never recurses across blocks.
 */
function collectAccepted(node: PMNode, nodeStart: number, schema: Schema): AcceptedChar[] {
  const deleteType = schema.marks.trackedDelete;

  if (node.isText) {
    if (deleteType && node.marks.some((m) => m.type === deleteType)) return [];
    const marks = formattingMarksOf(node.marks);
    const text = node.text ?? "";
    const out: AcceptedChar[] = [];
    for (let i = 0; i < text.length; i++) out.push({ char: text[i]!, docPos: nodeStart + i, marks });
    return out;
  }
  if (node.type.name === "hardBreak") return [{ char: "\n", docPos: nodeStart, marks: [] }];
  if (node.isLeaf) return []; // other inline leaf (e.g. image) — no intrinsic text

  // A leaf textblock: concatenate its inline runs in document order.
  const out: AcceptedChar[] = [];
  let offset = nodeStart + 1; // skip the node's opening token
  node.forEach((child) => {
    out.push(...collectAccepted(child, offset, schema));
    offset += child.nodeSize;
  });
  return out;
}

function buildAcceptedRichMap(node: PMNode, nodeStartPos: number, schema: Schema): AcceptedRichMap {
  const cells = collectAccepted(node, nodeStartPos, schema);
  const chars: string[] = [];
  const map: PosMapEntry[] = [];
  const charMarks: InlineMark[][] = [];
  for (const cell of cells) {
    map.push({ acceptedOffset: chars.length, docPos: cell.docPos });
    chars.push(cell.char);
    charMarks.push(cell.marks);
  }
  return { acceptedText: chars.join(""), map, charMarks };
}

/** PM marks → formatting `InlineMark`s: drop tracked-change marks + `dataTracked`/null attrs. */
function formattingMarksOf(marks: readonly Mark[]): InlineMark[] {
  const out: InlineMark[] = [];
  for (const mark of marks) {
    if (mark.type.name.startsWith("tracked")) continue;
    const attrs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(mark.attrs)) {
      if (key === "dataTracked" || value === null || value === undefined) continue;
      attrs[key] = value;
    }
    out.push(Object.keys(attrs).length > 0 ? { type: mark.type.name, attrs } : { type: mark.type.name });
  }
  return out;
}

/** Merge consecutive `keep` ops into one so a retained region isn't split per token. */
function coalesceKeeps<T extends { type: string; text: string }>(ops: T[]): T[] {
  const out: T[] = [];
  for (const op of ops) {
    const prev = out[out.length - 1];
    if (op.type === "keep" && prev && prev.type === "keep") {
      out[out.length - 1] = { ...prev, text: prev.text + op.text };
    } else {
      out.push(op);
    }
  }
  return out;
}

/** Expand spans to per-character text + marks (UTF-16 units, matching diffText offsets). */
function expandSpans(spans: InlineSpan[]): { text: string; charMarks: InlineMark[][] } {
  let text = "";
  const charMarks: InlineMark[][] = [];
  for (const span of spans) {
    for (let i = 0; i < span.text.length; i++) {
      text += span.text[i];
      charMarks.push(span.marks);
    }
  }
  return { text, charMarks };
}

/**
 * Group a proposed-text slice back into `InlineSpan`s for `spansToFragment`,
 * merging runs of identical marks. Newlines become spaces — a single-block
 * unit's inserted text can't introduce block breaks.
 */
function groupToSpans(
  text: string,
  charMarks: InlineMark[][],
  start: number,
  end: number,
): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let i = start;
  while (i < end) {
    const marks = charMarks[i] ?? [];
    const signature = markSignature(marks, []);
    let j = i + 1;
    while (j < end && markSignature(charMarks[j] ?? [], []) === signature) j++;
    spans.push({ text: text.slice(i, j).replace(/\n/g, " "), marks });
    i = j;
  }
  return spans;
}
