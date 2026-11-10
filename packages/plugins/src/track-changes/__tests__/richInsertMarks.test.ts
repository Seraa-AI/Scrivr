/**
 * A rich insert keeps each run's own formatting, and is one change: reviewing
 * it decides all of it, breaks included.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { applyRichDiffAsSuggestion } from "../lib/applyRichDiffAsSuggestion";
import { TrackChanges } from "../TrackChanges";
import { TrackChangesStatus } from "../types";
import { trackChangesPluginKey } from "../engine/trackChangesPlugin";
import { Fragment, Slice } from "@scrivr/core/pm";

function build(text: string) {
  return new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
    content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "p1" }, content: [{ type: "text", text }] }] },
  });
}
const apply = (editor: ServerEditor, spans: { text: string; marks: { type: string }[] }[]) =>
  applyRichDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), { edits: [{ nodeId: "p1", spans }], authorID: "AI" });

describe("a rich insert", () => {
  it("keeps each run's formatting", () => {
    const editor = build("x");
    apply(editor, [{ text: "x", marks: [] }, { text: "A", marks: [{ type: "bold" }] }, { text: "B", marks: [{ type: "italic" }] }]);
    const runs: string[] = [];
    // The proposed text: what is not proposed for deletion.
    editor.getState().doc.firstChild!.forEach((node) => {
      if (node.marks.some((m) => m.type.name === "trackedDelete")) return;
      runs.push(`${node.text}:${node.marks.map((m) => m.type.name).filter((n) => !n.startsWith("tracked")).join("+")}`);
    });
    expect(runs).toEqual(["x:", "A:bold", "B:italic"]);
  });

  it("is one change, its break included", () => {
    const editor = build("one");
    const before = editor.getState().doc.toJSON();
    apply(editor, [{ text: "one\ntwo\nthree", marks: [] }]);
    const [first] = trackChangesPluginKey.getState(editor.getState())!.changeSet.pending;
    editor.commands.setChangeStatuses("rejected", [first!.id]);
    expect(editor.getState().doc.toJSON()).toEqual(before);
  });

  it("is withdrawn, breaks and all, when its author restates the original", () => {
    const editor = build("alpha beta");
    const before = editor.getState().doc.toJSON();
    apply(editor, [{ text: "alpha\nbeta", marks: [] }]);
    apply(editor, [{ text: "alpha\nbeta", marks: [] }]);
    apply(editor, [{ text: "alpha beta", marks: [] }]);
    expect(editor.getState().doc.toJSON()).toEqual(before);
  });

  it("keeps each run's formatting when pasted in suggestion mode", () => {
    const editor = build("x");
    const { schema } = editor;
    const runs = Fragment.fromArray([
      schema.text("A", [schema.marks["bold"]!.create()]),
      schema.text("B", [schema.marks["italic"]!.create()]),
    ]);
    editor.applyTransaction(editor.getState().tr.replace(2, 2, new Slice(runs, 0, 0)).setMeta("uiEvent", "paste"));
    const proposed: string[] = [];
    editor.getState().doc.firstChild!.forEach((node) => {
      proposed.push(`${node.text}:${node.marks.map((m) => m.type.name).filter((n) => !n.startsWith("tracked")).join("+")}`);
    });
    expect(proposed).toEqual(["x:", "A:bold", "B:italic"]);
  });
});
