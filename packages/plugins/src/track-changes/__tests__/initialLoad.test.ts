/**
 * Loading a document is not an authored edit.
 *
 * Track changes decides that from transaction metadata, and a load touches the
 * whole document — so getting it wrong does not produce a small error. It
 * rewrites the outgoing document as one deletion and the incoming one as one
 * insertion, which is both wrong and, for a doc node with a single content
 * expression, invalid.
 *
 * The metadata can arrive on the transaction itself or on one a plugin appends
 * in response to it. ProseMirror records the original on the appended one as
 * `appendedTransaction`, so both have to be read.
 */

import { describe, it, expect } from "vitest";
import { EditorState, Plugin } from "@scrivr/core/pm";
import type { Transaction } from "@scrivr/core/pm";
import { doc, p, schema } from "./helpers";
import { TrackChangesAction } from "../actions";
import { trackChangesPlugin } from "../engine/trackChangesPlugin";
import { TrackChangesStatus } from "../types";

/** A plugin that edits the document in response to every change, as pagination and collab bookkeeping do. */
const appendsAnEdit = new Plugin({
  appendTransaction(transactions, _oldState, newState) {
    if (!transactions.some((tr) => tr.docChanged)) return null;
    if (newState.doc.textContent.includes("[appended]")) return null;
    return newState.tr.insertText("[appended]", newState.doc.content.size - 1);
  },
});

function editorWith(text: string): EditorState {
  return EditorState.create({
    doc: doc(p(text)),
    plugins: [
      appendsAnEdit,
      trackChangesPlugin({ userID: "user1", initialStatus: TrackChangesStatus.enabled }),
    ],
  });
}

function trackedMarks(state: EditorState): string[] {
  const names: string[] = [];
  state.doc.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type === schema.marks["trackedInsert"] || mark.type === schema.marks["trackedDelete"]) {
        names.push(mark.type.name);
      }
    }
  });
  return names;
}

describe("a document load under track changes", () => {
  it("tracks an appended edit that followed an authored one", () => {
    const state = editorWith("hello");
    const after = state.apply(state.tr.insertText("!", 6));

    // The control: nothing about an appended transaction is exempt by itself.
    expect(trackedMarks(after)).not.toEqual([]);
    expect(after.doc.textContent).toContain("[appended]");
  });

  it("tracks nothing when the load marker is on the transaction itself", () => {
    const state = editorWith("hello");
    const tr: Transaction = state.tr.insertText("!", 6).setMeta("initialContent", true);

    expect(trackedMarks(state.apply(tr))).toEqual([]);
  });

  it("tracks nothing on the transaction a plugin appended to the load", () => {
    const state = editorWith("hello");
    const after = state.apply(state.tr.insertText("!", 6).setMeta("initialContent", true));

    // The appended edit is a separate transaction, carrying the load only as
    // `appendedTransaction`. Reading just the transaction in hand misses it.
    expect(after.doc.textContent).toContain("[appended]");
    expect(trackedMarks(after)).toEqual([]);
  });
});

/**
 * `@scrivr/docx` sets this key when it applies an imported document, and it
 * cannot import the constant — depending on this package would point the
 * dependency the wrong way. The string is the contract between them, so
 * renaming it here has to fail here rather than quietly stop skipping there.
 */
it("keeps the skip action's wire name, which other packages spell out", () => {
  expect(TrackChangesAction.skipTrack).toBe("track-changes-skip-tracking");
});
