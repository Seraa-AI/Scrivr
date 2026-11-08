import { EditorState, Fragment, Node as PMNode, Plugin, PluginKey, ReplaceStep, Transaction } from "@scrivr/core/pm";

import type { ChangeSet } from "../ChangeSet";
import { findChanges } from "../findChanges";
import { genId } from "../helpers";
import { updateChangeAttrs } from "../engine/updateAttributes";
import { CHANGE_OPERATION } from "../types";

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

/**
 * Pasting back what one cut is moving it. Decided before the paste is tracked,
 * so what it inserts is recorded as the move's destination from the start, and
 * not merged with anything typed beside it. Only the author's own pending cut
 * counts, and a cut moves once. Returns the move's id, or null.
 */
export function moveIdForPaste(paste: Transaction, cut: Cut, doc: PMNode, authorID: string): string | null {
  if (cut.authorID !== authorID) return null;
  const pasted = paste.steps.map(step => step instanceof ReplaceStep ? contentKey(step.slice.content) : "").join("");
  return pasted === cut.content && cutStillPending(doc, cut).length ? genId() : null;
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
