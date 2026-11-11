/** A redline is not an agreement: a document with open suggestions does not seal. */
import { describe, expect, it } from "vitest";
import { Field, ServerEditor, StarterKit, createSnapshot } from "@scrivr/core";
import { TextSelection } from "@scrivr/core/pm";
import { TrackChanges, TrackChangesStatus } from "../index";

describe("sealing a document under review", () => {
  it("is refused while a typed suggestion is pending", async () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, Field, TrackChanges.configure({ userID: "alice", initialStatus: TrackChangesStatus.enabled })],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Net 30." }] }] },
    });
    const state = editor.getState();
    editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, 5)));
    editor.applyTransaction(editor.getState().tr.insertText("6"));

    const result = await createSnapshot(editor.getState().doc, { assignedRoles: [] });

    expect(result).toEqual({ ok: false, refusal: { reason: "pending-tracked-changes", count: 1 } });
  });
});
