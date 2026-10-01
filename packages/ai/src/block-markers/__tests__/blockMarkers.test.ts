/**
 * A marker on a block that proposes no edit.
 *
 * A review finding can be a Pass, or a decision a person has to make. The
 * suggestion overlay is a diff, and a finding with no change is not a diff —
 * `computeAiSuggestion` drops a block whose proposed text matches what is
 * already there, correctly. This is the other layer to put those on.
 */
import { describe, it, expect } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TextSelection } from "@scrivr/core/pm";
import { BlockMarkers } from "../BlockMarkers";
import {
  setBlockMarkers,
  clearBlockMarkers,
  getBlockMarkers,
  activeBlockMarkers,
} from "../markers";
import type { BlockMarker } from "../types";

const editorWith = (...texts: string[]) =>
  new ServerEditor({
    extensions: [StarterKit, BlockMarkers],
    content: {
      type: "doc",
      content: texts.map((text, i) => ({
        type: "paragraph",
        attrs: { nodeId: `b${i + 1}` },
        content: [{ type: "text", text }],
      })),
    },
  });

const marker = (nodeId: string, kind = "pass", summary = "Reads as intended"): BlockMarker => ({
  nodeId,
  kind,
  summary,
});

describe("block markers", () => {
  it("has none until something sets one", () => {
    expect(getBlockMarkers(editorWith("a"))).toEqual([]);
  });

  it("hangs a marker on a block by id, with no change to describe", () => {
    const editor = editorWith("a", "b");
    setBlockMarkers(editor, "review", [marker("b2")]);

    expect(getBlockMarkers(editor)).toEqual([
      { source: "review", nodeId: "b2", kind: "pass", summary: "Reads as intended" },
    ]);
  });

  it("leaves the document alone", () => {
    const editor = editorWith("a");
    const before = editor.getState().doc;

    setBlockMarkers(editor, "review", [marker("b1")]);

    expect(editor.getState().doc).toBe(before);
  });

  it("lets a writer replace its own markers without touching another's", () => {
    // The review bridge and the chat bridge both write here and neither owns
    // the layer. A set that replaced everything would make the last writer win.
    const editor = editorWith("a", "b");
    setBlockMarkers(editor, "review", [marker("b1", "pass")]);
    setBlockMarkers(editor, "chat", [marker("b2", "question")]);

    setBlockMarkers(editor, "review", [marker("b1", "human-review")]);

    expect(getBlockMarkers(editor).map((m) => [m.source, m.kind])).toEqual([
      ["review", "human-review"],
      ["chat", "question"],
    ]);
  });

  it("clears one writer's markers and leaves the others", () => {
    const editor = editorWith("a", "b");
    setBlockMarkers(editor, "review", [marker("b1")]);
    setBlockMarkers(editor, "chat", [marker("b2")]);

    clearBlockMarkers(editor, "review");

    expect(getBlockMarkers(editor).map((m) => m.source)).toEqual(["chat"]);
  });

  it("keeps a writer's markers in the order it gave them", () => {
    const editor = editorWith("a", "b");
    setBlockMarkers(editor, "review", [marker("b2"), marker("b1")]);

    expect(getBlockMarkers(editor).map((m) => m.nodeId)).toEqual(["b2", "b1"]);
  });

  it("lets one block carry markers of different kinds", () => {
    const editor = editorWith("a");
    setBlockMarkers(editor, "review", [marker("b1", "pass"), marker("b1", "human-review")]);

    expect(getBlockMarkers(editor)).toHaveLength(2);
  });

  it("drops a marker whose block has left the document", () => {
    // A marker names a block. Once that block is gone there is nothing to
    // anchor to, and a reader should not be told about a finding on text
    // that no longer exists.
    const editor = editorWith("a", "b");
    setBlockMarkers(editor, "review", [marker("b1"), marker("b2")]);

    const state = editor.getState();
    const first = state.doc.child(0);
    editor.applyTransaction(state.tr.delete(0, first.nodeSize));

    expect(getBlockMarkers(editor).map((m) => m.nodeId)).toEqual(["b2"]);
  });

  it("survives an edit that leaves the block in place", () => {
    const editor = editorWith("hello");
    setBlockMarkers(editor, "review", [marker("b1")]);

    const state = editor.getState();
    editor.applyTransaction(state.tr.insertText("!", 6));

    expect(getBlockMarkers(editor)).toHaveLength(1);
  });

  it("is not reachable without the extension", () => {
    const editor = new ServerEditor({ extensions: [StarterKit], content: "a" });

    expect(getBlockMarkers(editor)).toEqual([]);
  });
});

describe("activeBlockMarkers", () => {
  const caretIn = (editor: ServerEditor, blockIndex: number) => {
    const state = editor.getState();
    let pos = 1;
    for (let i = 0; i < blockIndex; i++) pos += state.doc.child(i).nodeSize;
    editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  };

  it("answers the markers on the block holding the cursor", () => {
    const editor = editorWith("first", "second");
    setBlockMarkers(editor, "review", [marker("b1", "pass"), marker("b2", "human-review")]);

    caretIn(editor, 1);

    expect(activeBlockMarkers(editor).map((m) => m.kind)).toEqual(["human-review"]);
  });

  it("is empty when the cursor is in an unmarked block", () => {
    const editor = editorWith("first", "second");
    setBlockMarkers(editor, "review", [marker("b2")]);

    caretIn(editor, 0);

    expect(activeBlockMarkers(editor)).toEqual([]);
  });

  it("answers every writer's marker on that block, not just the first", () => {
    const editor = editorWith("first");
    setBlockMarkers(editor, "review", [marker("b1", "pass")]);
    setBlockMarkers(editor, "chat", [marker("b1", "question")]);

    caretIn(editor, 0);

    expect(activeBlockMarkers(editor).map((m) => m.source)).toEqual(["review", "chat"]);
  });
});
