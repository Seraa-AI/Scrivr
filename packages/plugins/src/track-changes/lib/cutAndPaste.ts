import { EditorState, Fragment, Node as PMNode, Plugin, PluginKey, ReplaceStep, Slice, Transaction } from "@scrivr/core/pm";
import { blockIdOf, findNodeById } from "@scrivr/core";

import type { ChangeSet } from "../ChangeSet";
import { findChanges } from "../findChanges";
import { genId } from "../helpers";
import { updateChangeAttrs } from "../engine/updateAttributes";
import { CHANGE_OPERATION } from "../types";
import { isShadowNode, type ShadowRange } from "../liveNode";

/** What a cut took and the deletion it proposed. */
export interface Cut {
  authorID: string;
  content: string;
  deletionIds: string[];
}

/**
 * Content as a reader sees it: its text and the objects in it, in order, with
 * a break between blocks. Formatting and ids do not reliably survive a trip
 * through the clipboard, so they are left out, and so are breaks at either
 * end, which come from where the content was cut rather than what it is.
 */
function contentKey(content: Fragment): string {
  let key = "";
  let started = false;
  content.descendants(node => {
    if (node.isText) {
      key += node.text;
      started = true;
    } else if (node.isTextblock) {
      if (started) key += "\n";
    } else if (node.isLeaf) {
      key += `\u0000${node.type.name}:${String(node.attrs.src ?? "")}\u0000`;
      started = true;
    }
    return true;
  });
  return key.replace(/^\n+|\n+$/g, "");
}

const newRecords = (doc: PMNode, before: ChangeSet) => {
  const known = new Set(before.changes.map(change => change.id));
  return findChanges(EditorState.create({ doc })).pending.filter(change => !known.has(change.id));
};

/** The cut a tracked cut transaction made, when it proposed deleting anything. */
export function cutOf(tx: Transaction, before: ChangeSet, after: PMNode, authorID: string): Cut | null {
  const content = tx.steps
    .map((step, i) => step instanceof ReplaceStep && step.from < step.to
      ? contentKey(tx.docs[i]!.slice(step.from, step.to).content)
      : "")
    .join("");
  // A deleted break is part of what was cut, as much as the text either side.
  const cutOperations: string[] = [CHANGE_OPERATION.delete, CHANGE_OPERATION.node_join];
  const deletionIds = newRecords(after, before)
    .filter(change => cutOperations.includes(change.dataTracked.operation) && change.dataTracked.authorID === authorID)
    .map(change => change.id);
  return content && deletionIds.length ? { authorID, content, deletionIds } : null;
}

const cutStillPending = (doc: PMNode, cut: Cut) => {
  const ids = new Set(cut.deletionIds);
  return findChanges(EditorState.create({ doc })).pending.filter(change =>
    (ids.has(change.id) || ids.has(change.dataTracked.continuesId ?? "")) && !change.dataTracked.moveId);
};

/** A paste recorded as the destination of the move its cut began. */
export interface PastedMove {
  id: string;
  cut: Cut;
}

/**
 * Where the cut's content still waits, proposed for deletion, to be moved. A
 * block lies inside only when the cut took it whole; a deleted break leaves
 * both blocks it joined in place.
 */
export const cutRanges = (doc: PMNode, cut: Cut): ShadowRange[] =>
  cutStillPending(doc, cut)
    .filter(change => change.dataTracked.operation === CHANGE_OPERATION.delete)
    .map((change): ShadowRange => [change.from, change.to]);

/** Ids of the blocks a slice holds whole. One cut open at its edge is joined to what is there, not written. */
function wholeBlockIds(slice: Slice): string[] {
  const ids: string[] = [];
  const visit = (content: Fragment, openStart: number, openEnd: number) => {
    content.forEach((node, _offset, index) => {
      const startOpen = index === 0 ? openStart : 0;
      const endOpen = index === content.childCount - 1 ? openEnd : 0;
      const id = blockIdOf(node);
      if (id !== null && startOpen === 0 && endOpen === 0) ids.push(id);
      visit(node.content, Math.max(startOpen - 1, 0), Math.max(endOpen - 1, 0));
    });
  };
  visit(slice.content, slice.openStart, slice.openEnd);
  return ids;
}

/**
 * Pasting back what one cut is moving it. Decided before the paste is tracked,
 * so what it inserts is recorded as the move's destination from the start, and
 * not merged with anything typed beside it. Only the author's own pending cut
 * counts, and a cut moves once. Returns the move's id, or null.
 */
export function moveIdForPaste(paste: Transaction, cut: Cut, doc: PMNode, authorID: string): string | null {
  if (cut.authorID !== authorID) return null;
  const pasted = paste.steps.map(step => step instanceof ReplaceStep ? contentKey(step.slice.content) : "").join("");
  if (pasted !== cut.content || cutStillPending(doc, cut).length === 0) return null;
  // Text cannot tell the cut from a copy of another block that reads the same.
  // A whole block pasted under the id of a block the cut left in place can.
  const taken = cutRanges(paste.before, cut);
  const copiesLiveBlock = paste.steps.some(step => step instanceof ReplaceStep &&
    wholeBlockIds(step.slice).some(id => findNodeById(paste.before, id, (node, pos) => !isShadowNode(node, pos, taken))));
  return copiesLiveBlock ? null : genId();
}

/** Links the cut's deletion to the move its paste was recorded as, once that paste recorded something. */
export function markCutMoved(tr: Transaction, cut: Cut, moveId: string) {
  const pending = findChanges(EditorState.create({ doc: tr.doc })).pending;
  if (!pending.some(change => change.dataTracked.moveId === moveId)) return;
  for (const change of cutStillPending(tr.doc, cut)) {
    updateChangeAttrs(tr, change, { ...change.dataTracked, moveId }, tr.doc.type.schema);
  }
}

export const lastCutKey = new PluginKey<Cut | null>("track-changes-last-cut");

/** Sets the cut a round made, or null when it proposed deleting nothing. */
export const rememberCut = (tr: Transaction, cut: Cut | null) => tr.setMeta(lastCutKey, cut);

const isCut = (value: unknown): value is Cut | null =>
  value === null || (typeof value === "object" && "deletionIds" in value && Array.isArray(value.deletionIds));

/**
 * Holds the last tracked cut. Kept after it is pasted back: the document says
 * whether it is still waiting to move, so undoing the paste lets it move again.
 */
export const lastCutPlugin = () => new Plugin<Cut | null>({
  key: lastCutKey,
  state: {
    init: () => null,
    apply: (tr, cut) => {
      const next: unknown = tr.getMeta(lastCutKey);
      return isCut(next) ? next : cut;
    },
  },
});
