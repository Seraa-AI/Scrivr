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
 * Three kinds of change, each written as the plain edit a person would make,
 * under `trackAsSuggestion`; the engine records them:
 *   1. text insert/delete — as the plain path; inserted text carries the
 *      agent's intended formatting marks.
 *   2. mark add/remove on RETAINED text — the flagship "highlight this clause,
 *      no text change" case. `diffText`'s char-offset KEEP regions are aligned
 *      to the doc's and the agent's per-character mark sets; where they differ,
 *      the mark is added or removed.
 *   3. block `attrs` (align, indent) — `setNodeMarkup`. `level` sets a
 *      heading's level; 0 makes it a paragraph, 1–6 makes a paragraph a
 *      heading, which the engine records with the old type so a reject
 *      restores it.
 *
 * Agent output is untrusted: marks pass through `resolveInlineMark` (unknown
 * type dropped, `link.href` sanitized), so a malformed edit never crashes the
 * merge or poisons the document.
 */

import type { NodeType, Node as PMNode, Schema } from "@scrivr/core/pm";
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
import { excludes, untracked, type FoundPiece } from "../formatSuggestions";
import { findLiveNodeById } from "../liveNode";
import { acceptedRangeToDocRange, bridgeable, buildAcceptedTextMap, collectAccepted, type PosMapEntry } from "./acceptedTextMap";
import { clearAuthorPendingMarks, namedMoreThanOnce } from "./applyDiffAsSuggestion";
import { diffText, phraseReplacements } from "./diffText";
import { groupToSpans } from "./plainProposalMarks";
import { writeProposal } from "./writeProposal";
import { dispatchSuggestion } from "../suggestionBlocked";

// ── Public types ──────────────────────────────────────────────────────────────

/** One block's rich edit — the agent's intended inline runs and/or styling. */
export interface RichBlockEdit {
  /** Stable `nodeId` of the target block. */
  nodeId: string;
  /** New inline content as rich runs. Omit to leave inline content untouched. */
  spans?: InlineSpan[];
  /** New block styling (`align`, `indent`, `textIndent`, `level`). Omit to leave as-is. */
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
  /** The host's name for this suggestion, stored on every change it writes. */
  operationId?: string;
}

export interface RichDiffResult {
  /** true if at least one tracked change was applied and dispatched. */
  applied: boolean;
  /** nodeIds whose block was not found in the document. */
  notFound: string[];
  /**
   * nodeIds whose edit changed nothing: a container (list, table) rather than
   * a leaf textblock, a block proposed for deletion, a block the call named
   * more than once, or an edit that matched the block already or asked only
   * for what an agent may not set.
   */
  rejected: string[];
}

/** Block styling the agent may set. */
const ALLOWED_ATTRS: ReadonlyArray<string> = ["align", "indent", "textIndent"];
const VALID_ALIGN = new Set(["left", "center", "right", "justify"]);

/**
 * The block attrs an agent is allowed to set, keeping only well-formed values.
 *
 * Agent output is untrusted and its `attrs` is an open record, so this is the
 * one place that decides what may reach a node. Identity and review bookkeeping
 * (`nodeId`, `dataTracked`) are not on the list and cannot be: a forged
 * `nodeId` collides with the ids the protocol addresses by, and forged
 * `dataTracked` invents a review history.
 */
export function pickAgentAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of ALLOWED_ATTRS) {
    if (!(key in attrs)) continue;
    const value = attrs[key];
    if (isValidAttr(key, value)) picked[key] = value;
  }
  return picked;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function applyRichDiffAsSuggestion(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  { edits, authorID, onWarn, operationId }: RichDiffOptions,
): RichDiffResult {
  const notFound: string[] = [];
  const rejected: string[] = [];
  const repeated = namedMoreThanOnce(edits, state.doc);
  rejected.push(...repeated);
  const resolved = edits.flatMap((edit, index) => {
    if (repeated.includes(edit.nodeId)) return [];
    // A missing block named twice is reported missing once.
    if (edits.findIndex((other) => other.nodeId === edit.nodeId) !== index) return [];
    const found = findLiveNodeById(state.doc, edit.nodeId);
    if (!found) {
      // Held only by content proposed for deletion: there, but not editable.
      if (findNodeById(state.doc, edit.nodeId)) rejected.push(edit.nodeId);
      else notFound.push(edit.nodeId);
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
    return [edit];
  });

  if (resolved.length === 0) return { applied: false, notFound, rejected };

  const tr = state.tr;
  let applied = false;
  for (const edit of resolved) {
    if (applyRichBlockToTr(state.schema, tr, edit, authorID, onWarn)) applied = true;
    else rejected.push(edit.nodeId);
  }

  if (!applied) return { applied: false, notFound, rejected };

  return { applied: dispatchSuggestion(state, tr, authorID, dispatch, operationId), notFound, rejected };
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
  const found = findLiveNodeById(tr.doc, edit.nodeId);
  if (!found) return false;
  // An edit is taken whole or not at all: attrs it cannot apply refuse its text too.
  if (edit.attrs && !attrsApplicable(tr, found.pos, found.node, edit.attrs)) return false;
  const stepsBefore = tr.steps.length;
  if (edit.spans) {
    clearAuthorPendingMarks(tr, found.pos, found.pos + found.node.nodeSize, authorID, schema);
  }
  // Restating the original withdraws the author's earlier suggestion: a change.
  let applied = tr.steps.length > stepsBefore;

  const updated = findLiveNodeById(tr.doc, edit.nodeId);
  if (!updated) return applied;

  // 1. Block attrs first — setNodeMarkup keeps the node's size, so inline
  //    positions computed below stay valid.
  if (edit.attrs && applyAttrsChange(tr, updated.pos, updated.node, edit.attrs)) {
    applied = true;
  }

  // 2. Inline content (text + marks).
  if (edit.spans && applyInlineChange(schema, tr, edit.nodeId, edit.spans, onWarn)) {
    applied = true;
  }

  return applied;
}

// ── Block attrs ───────────────────────────────────────────────────────────────

/** Every key is one an agent may set, with a value the block can take. */
function attrsApplicable(tr: Transaction, nodeFrom: number, node: PMNode, editAttrs: Record<string, unknown>): boolean {
  const { level, ...styling } = editAttrs;
  if (!Object.entries(styling).every(([key, value]) => ALLOWED_ATTRS.includes(key) && isValidAttr(key, value))) return false;
  return level === undefined || typeAt(tr, nodeFrom, node, level) !== undefined;
}

/** The type `level` makes this block, where its parent allows that type. */
function typeAt(tr: Transaction, nodeFrom: number, node: PMNode, level: unknown): NodeType | undefined {
  const type = level === undefined ? node.type : typeForLevel(node, level);
  const $node = tr.doc.resolve(nodeFrom);
  return type && $node.parent.canReplaceWith($node.index(), $node.index() + 1, type) ? type : undefined;
}

function applyAttrsChange(
  tr: Transaction,
  nodeFrom: number,
  node: PMNode,
  editAttrs: Record<string, unknown>,
): boolean {
  const { level } = editAttrs;
  const type = typeAt(tr, nodeFrom, node, level);
  if (!type) return false;

  const typeAttrs = Object.keys(type.spec.attrs ?? {});
  const picked: Record<string, unknown> = { ...pickAgentAttrs(editAttrs), ...(level !== undefined && type.name === "heading" ? { level } : {}) };
  const next = Object.fromEntries(typeAttrs.flatMap((key) =>
    key in picked ? [[key, picked[key]]] : key in node.attrs ? [[key, node.attrs[key]]] : []));
  if (type === node.type && typeAttrs.every((key) => next[key] === node.attrs[key])) return false;

  tr.setNodeMarkup(nodeFrom, type, next, node.marks);
  return true;
}

/** The block a `level` asks for: a heading at 1–6, a paragraph at 0. Only those two change. */
function typeForLevel(node: PMNode, level: unknown): NodeType | undefined {
  const { heading, paragraph } = node.type.schema.nodes;
  if (node.type !== heading && node.type !== paragraph) return undefined;
  if (level === 0) return paragraph;
  return Number.isInteger(level) && typeof level === "number" && level >= 1 && level <= 6 ? heading : undefined;
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
  onWarn?: (message: string) => void,
): boolean {
  const found = findLiveNodeById(tr.doc, nodeId);
  if (!found) return false;

  const { acceptedText, map } = buildAcceptedTextMap(found.node, found.pos, schema);
  const charMarks = collectAccepted(found.node, found.pos, schema).map((cell) => cell.marks);
  const { text: proposedText, charMarks: proposedMarks } = expandSpans(spans);

  // Nothing to do when text and every char's mark set already match.
  const rawOps = diffText(acceptedText, proposedText);
  // diffText emits keeps per token (or one whole-text keep when nothing
  // changed). Merge adjacent keeps so a formatting change over a retained
  // region is ONE mark step spanning the whole region — correct even when the
  // region is interleaved with a pending insertion that stops text nodes fusing.
  const ops = coalesceKeeps(phraseReplacements(rawOps, (from, to) => bridgeable(tr.doc, map, from, to)));

  // Formatting first: a mark step moves nothing, so `map` stays true for the text.
  let applied = false;
  let aOff = 0;
  let pOff = 0;
  for (const op of ops) {
    const len = op.text.length;
    if (op.type === "keep" && changeKeptMarks(tr, schema, map, charMarks, proposedMarks, aOff, pOff, len, onWarn)) applied = true;
    if (op.type !== "insert") aOff += len;
    if (op.type !== "delete") pOff += len;
  }

  const contentFor = (from: number, to: number) =>
    spansToFragment(groupToSpans(proposedText, proposedMarks, from, to), schema, { parentType: found.node.type, ...(onWarn ? { onWarn } : {}) });
  if (writeProposal(tr, map, tr.steps.length, ops, contentFor, found.pos + 1)) applied = true;
  return applied;
}

/**
 * On a retained (KEEP) region, add or remove marks wherever the doc's per-char
 * mark set differs from the agent's. Consecutive chars sharing the same
 * add/remove signature are coalesced into one range.
 */
function changeKeptMarks(
  tr: Transaction,
  schema: Schema,
  map: PosMapEntry[],
  docMarks: InlineMark[][],
  proposedMarks: InlineMark[][],
  aOff: number,
  pOff: number,
  len: number,
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
        const { from, to } = range;
        // An added mark that takes a removed one off (red over blue) replaces it in
        // one step, which the engine records with what rejecting it restores.
        const takenOff = new Set<InlineMark>();
        for (const m of added) {
          const real = resolveInlineMark(m, schema, onWarn);
          if (!real) continue;
          for (const r of removed) {
            const other = resolveInlineMark(r, schema);
            if (other && excludes(real, other)) takenOff.add(r);
          }
          tr.addMark(from, to, real);
          applied = true;
        }
        for (const m of removed) {
          const real = takenOff.has(m) ? null : resolveInlineMark(m, schema, onWarn);
          if (!real) continue;
          // Taken off as the text carries it, records and all; text that does not
          // carry it (another author's deletion inside the range) is left alone.
          for (const piece of inlinePieces(tr.doc, from, to)) {
            const carried = piece.marks.find((mark) => untracked(mark).eq(untracked(real)));
            if (carried) tr.removeMark(piece.from, piece.to, carried);
          }
          applied = true;
        }
      }
    }
    k = j;
  }
  return applied;
}

/** The inline content between `from` and `to`, piece by piece, with its marks. */
function inlinePieces(doc: PMNode, from: number, to: number): FoundPiece[] {
  const pieces: FoundPiece[] = [];
  doc.nodesBetween(from, to, (node, at) => {
    if (node.isInline) pieces.push({ from: Math.max(at, from), to: Math.min(at + node.nodeSize, to), marks: node.marks });
  });
  return pieces;
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

