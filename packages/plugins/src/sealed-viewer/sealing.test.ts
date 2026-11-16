/** A redline is not an agreement: a document with open suggestions does not seal. */
import { describe, expect, it } from "vitest";
import { BUILT_IN_FIELD_KINDS, Field, ServerEditor, StarterKit, createSnapshot } from "@scrivr/core";
import { TextSelection } from "@scrivr/core/pm";
import { TrackChanges, TrackChangesStatus } from "../index";

describe("sealing a document under review", () => {
  const reviewing = () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, Field, TrackChanges.configure({ userID: "alice", initialStatus: TrackChangesStatus.enabled })],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Net 30." }] }] },
    });
    const select = (from: number, to = from) => {
      const state = editor.getState();
      editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
    };
    const sealing = () => createSnapshot(editor.getState().doc, { kinds: BUILT_IN_FIELD_KINDS, assignedRoles: [] });
    return { editor, select, sealing };
  };
  const refusedFor = (count: number) => ({ ok: false, refusal: { reason: "pending-tracked-changes", count } });

  it("is refused while a typed suggestion is pending", async () => {
    const { editor, select, sealing } = reviewing();
    select(5);
    editor.applyTransaction(editor.getState().tr.insertText("6"));

    expect(await sealing()).toEqual(refusedFor(1));
  });

  it("is refused while a suggested deletion is pending", async () => {
    const { editor, select, sealing } = reviewing();
    select(5, 7);
    editor.applyTransaction(editor.getState().tr.deleteSelection());

    expect(await sealing()).toEqual(refusedFor(1));
  });

  it("is refused while a suggested formatting change is pending", async () => {
    const { editor, select, sealing } = reviewing();
    select(1, 4);
    editor.commands.toggleBold();

    expect(await sealing()).toEqual(refusedFor(1));
  });
});
