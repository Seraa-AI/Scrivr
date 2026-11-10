/**
 * Whether tracked changes are painted on the canvas is the host's call. A host
 * that draws its own review UI turns the colours off; the changes are still
 * recorded, reviewed and exported.
 */
import { describe, expect, it } from "vitest";
import { StarterKit } from "@scrivr/core";
import { TrackChanges, TrackChangesStatus } from "../index";
import { ViewEditorDouble } from "../../__tests__/viewEditorDouble";

function mounted(trackChanges: ReturnType<typeof TrackChanges.configure>): ViewEditorDouble {
  const editor = new ViewEditorDouble({
    extensions: [StarterKit, trackChanges],
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] },
  });
  editor.mountView();
  return editor;
}

describe("TrackChanges renderMode", () => {
  it("paints tracked changes by default", () => {
    expect(mounted(TrackChanges.configure({ userID: "u1" })).painters).toHaveLength(1);
  });

  it("paints nothing with renderMode: \"none\"", () => {
    expect(mounted(TrackChanges.configure({ userID: "u1", renderMode: "none" })).painters).toEqual([]);
  });

  it("still records changes with nothing painted", () => {
    const editor = mounted(TrackChanges.configure({ userID: "u1", renderMode: "none", initialStatus: TrackChangesStatus.enabled }));
    editor.applyTransaction(editor.getState().tr.insertText("new ", 1));
    let tracked = false;
    editor.getState().doc.descendants((node) => {
      if (node.marks.some((mark) => mark.type.name === "trackedInsert")) tracked = true;
    });
    expect(tracked).toBe(true);
  });
});
