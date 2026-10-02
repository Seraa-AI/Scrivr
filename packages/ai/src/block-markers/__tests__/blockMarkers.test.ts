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
// Through the package barrel: a host reaches these by name, so one dropped
// from `index.ts` fails here rather than there.
import {
  BlockMarkers,
  BLOCK_MARKERS_SET,
  setBlockMarkers,
  clearBlockMarkers,
  getBlockMarkers,
  activeBlockMarkers,
  blockMarkersPluginKey,
  type BlockMarker,
} from "../../index";

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

describe("a marker whose block contains another marked block", () => {
  const nested = () =>
    new ServerEditor({
      extensions: [StarterKit, BlockMarkers],
      content: {
        type: "doc",
        content: [{
          type: "bulletList",
          attrs: { nodeId: "list1" },
          content: [{
            type: "listItem",
            attrs: { nodeId: "item1" },
            content: [{
              type: "paragraph",
              attrs: { nodeId: "para1" },
              content: [{ type: "text", text: "hello" }],
            }],
          }],
        }],
      },
    });

  const caretInParagraph = (editor: ServerEditor) => {
    const state = editor.getState();
    let pos = -1;
    state.doc.descendants((node, at) => {
      if (node.attrs["nodeId"] === "para1") pos = at;
    });
    editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, pos + 2)));
  };

  it("answers only the innermost block, so the anchor is the text the reader is in", () => {
    // Every ancestor contains the cursor. Answering all of them left a
    // paragraph's finding painted at the top of the whole list.
    const editor = nested();
    setBlockMarkers(editor, "review", [
      { nodeId: "list1", kind: "outer", summary: "on the list" },
      { nodeId: "para1", kind: "inner", summary: "on the paragraph" },
    ]);
    caretInParagraph(editor);

    expect(activeBlockMarkers(editor).map((m) => m.kind)).toEqual(["inner"]);
  });

  it("still answers an ancestor's marker when nothing inside it is marked", () => {
    const editor = nested();
    setBlockMarkers(editor, "review", [{ nodeId: "list1", kind: "outer", summary: "on the list" }]);
    caretInParagraph(editor);

    expect(activeBlockMarkers(editor).map((m) => m.kind)).toEqual(["outer"]);
  });
});

describe("a payload the layer does not recognise", () => {
  const dispatch = (editor: ServerEditor, markers: unknown) => {
    editor.applyTransaction(
      editor.getState().tr.setMeta(BLOCK_MARKERS_SET, { source: "evil", markers }),
    );
  };

  it("refuses the whole payload rather than applying half of a writer's intent", () => {
    // `BLOCK_MARKERS_SET` is public, so a host can dispatch it inside its own
    // transaction, and state typed as markers has to hold markers. All or
    // nothing: a half-applied set is a set the writer never asked for.
    const editor = editorWith("a", "b");
    setBlockMarkers(editor, "review", [marker("b1")]);

    dispatch(editor, [{ source: "evil", nodeId: "b2", kind: "pass", summary: "real" }, 42]);

    expect(getBlockMarkers(editor).map((m) => m.source)).toEqual(["review"]);
  });

  it("refuses a marker naming no block, which would bind to an unstamped one", () => {
    // `findNodeById` compares `attrs.nodeId === nodeId`, and a block the
    // editor never stamped holds `null` — so a null id matched arbitrary text.
    const editor = editorWith("a");

    dispatch(editor, [{ source: "evil", nodeId: null, kind: "pass", summary: "x" }]);

    expect(getBlockMarkers(editor)).toEqual([]);
  });

  it("ignores a payload that is not a marker list at all", () => {
    const editor = editorWith("a");
    setBlockMarkers(editor, "review", [marker("b1")]);
    editor.applyTransaction(
      editor.getState().tr.setMeta(BLOCK_MARKERS_SET, { source: "review", markers: "nope" }),
    );

    expect(getBlockMarkers(editor)).toHaveLength(1);
  });
});

describe("clearing a source that never wrote", () => {
  it("leaves the layer's state untouched, so nothing repaints", () => {
    const editor = editorWith("a");
    setBlockMarkers(editor, "review", [marker("b1")]);
    const before = blockMarkersPluginKey.getState(editor.getState());

    clearBlockMarkers(editor, "never-wrote");

    expect(blockMarkersPluginKey.getState(editor.getState())).toBe(before);
  });
});
