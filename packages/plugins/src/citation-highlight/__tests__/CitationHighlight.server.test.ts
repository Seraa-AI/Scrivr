/**
 * CitationHighlight state is plain ProseMirror plugin state, so every
 * behaviour except the actual canvas painting works on a headless
 * `ServerEditor` — commands set the ranges, edits remap them, deletions
 * drop them, and none of it touches undo history.
 */
import { describe, it, expect } from "vitest";
import { TextSelection } from "@scrivr/core/pm";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { CitationHighlight, citationHighlightPluginKey } from "../CitationHighlight";

function makeEditor() {
  return new ServerEditor({
    extensions: [StarterKit, CitationHighlight],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First block." }] },
        { type: "paragraph", content: [{ type: "text", text: "Second block." }] },
      ],
    },
  });
}

function citations(editor: ServerEditor) {
  return citationHighlightPluginKey.getState(editor.getState())?.citations ?? [];
}

describe("CitationHighlight on ServerEditor", () => {
  it("setCitationHighlights stores the given ranges", () => {
    const editor = makeEditor();
    editor.commands.setCitationHighlights([{ id: "c1", from: 1, to: 6 }]);

    expect(citations(editor)).toEqual([{ id: "c1", from: 1, to: 6 }]);
  });

  it("setCitationHighlights replaces the previous set", () => {
    const editor = makeEditor();
    editor.commands.setCitationHighlights([{ id: "c1", from: 1, to: 6 }]);
    editor.commands.setCitationHighlights([{ id: "c2", from: 15, to: 21 }]);

    expect(citations(editor)).toEqual([{ id: "c2", from: 15, to: 21 }]);
  });

  it("clearCitationHighlights empties the set", () => {
    const editor = makeEditor();
    editor.commands.setCitationHighlights([{ id: "c1", from: 1, to: 6 }]);
    editor.commands.clearCitationHighlights();

    expect(citations(editor)).toEqual([]);
  });

  it("drops empty or inverted ranges instead of storing them", () => {
    const editor = makeEditor();
    editor.commands.setCitationHighlights([
      { id: "empty", from: 3, to: 3 },
      { id: "inverted", from: 6, to: 1 },
      { id: "ok", from: 1, to: 6 },
    ]);

    expect(citations(editor)).toEqual([{ id: "ok", from: 1, to: 6 }]);
  });

  it("remaps ranges when text is inserted before them", () => {
    const editor = makeEditor();
    editor.commands.setCitationHighlights([{ id: "c1", from: 15, to: 21 }]);

    editor.applyTransaction(editor.getState().tr.insertText("abc", 1));

    expect(citations(editor)).toEqual([{ id: "c1", from: 18, to: 24 }]);
  });

  it("does not absorb text typed at the range boundaries", () => {
    const editor = makeEditor();
    editor.commands.setCitationHighlights([{ id: "c1", from: 1, to: 6 }]);

    // Typing at `from` pushes the range right; typing at `to` leaves it alone.
    editor.applyTransaction(editor.getState().tr.insertText("X", 1));
    expect(citations(editor)).toEqual([{ id: "c1", from: 2, to: 7 }]);

    editor.applyTransaction(editor.getState().tr.insertText("Y", 7));
    expect(citations(editor)).toEqual([{ id: "c1", from: 2, to: 7 }]);
  });

  it("drops a citation when its cited text is deleted", () => {
    const editor = makeEditor();
    editor.commands.setCitationHighlights([
      { id: "gone", from: 1, to: 6 },
      { id: "stays", from: 15, to: 21 },
    ]);

    editor.applyTransaction(editor.getState().tr.delete(1, 6));

    expect(citations(editor).map((c) => c.id)).toEqual(["stays"]);
  });

  it("addCitationHighlight upserts without disturbing the rest of the set", () => {
    const editor = makeEditor();
    editor.commands.setCitationHighlights([
      { id: "c1", from: 1, to: 6 },
      { id: "c2", from: 15, to: 21 },
    ]);

    // New id → appended.
    editor.commands.addCitationHighlight({ id: "c3", from: 7, to: 13 });
    expect(citations(editor).map((c) => c.id)).toEqual(["c1", "c2", "c3"]);

    // Existing id → range replaced in place, others untouched.
    editor.commands.addCitationHighlight({ id: "c2", from: 16, to: 20 });
    expect(citations(editor)).toEqual([
      { id: "c1", from: 1, to: 6 },
      { id: "c3", from: 7, to: 13 },
      { id: "c2", from: 16, to: 20 },
    ]);
  });

  it("removeCitationHighlight removes one citation by id, leaving the rest", () => {
    const editor = makeEditor();
    editor.commands.setCitationHighlights([
      { id: "c1", from: 1, to: 6 },
      { id: "c2", from: 15, to: 21 },
    ]);

    editor.commands.removeCitationHighlight("c1");
    expect(citations(editor)).toEqual([{ id: "c2", from: 15, to: 21 }]);

    // Unknown id is a harmless no-op.
    editor.commands.removeCitationHighlight("nope");
    expect(citations(editor)).toEqual([{ id: "c2", from: 15, to: 21 }]);
  });

  it("citeSelection highlights the currently selected text", () => {
    const editor = makeEditor();
    const state = editor.getState();
    editor.applyTransaction(
      state.tr.setSelection(TextSelection.create(state.doc, 1, 6)),
    );

    editor.commands.citeSelection();
    expect(citations(editor)).toEqual([{ id: "cite-1-6", from: 1, to: 6 }]);
  });

  it("citeSelection with a caret cites the enclosing block", () => {
    const editor = makeEditor();
    const state = editor.getState();
    // Caret inside "Second block." (content range 15..28), no range selected.
    editor.applyTransaction(
      state.tr.setSelection(TextSelection.create(state.doc, 17)),
    );

    editor.commands.citeSelection();
    expect(citations(editor)).toEqual([{ id: "cite-15-28", from: 15, to: 28 }]);
  });

  it("citeSelection is a no-op when the caret sits in an empty block", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, CitationHighlight],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });

    editor.commands.citeSelection();
    expect(citations(editor)).toEqual([]);
  });

  it("citeNode cites a block by its nodeId", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, CitationHighlight],
      // Persisted nodeIds — ServerEditor preserves them and never fabricates
      // ids on load, so block addressing is deterministic.
      content: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { nodeId: "b1" }, content: [{ type: "text", text: "First block." }] },
          { type: "paragraph", attrs: { nodeId: "b2" }, content: [{ type: "text", text: "Second block." }] },
        ],
      },
    });

    editor.commands.citeNode("b2");
    expect(citations(editor)).toEqual([
      { id: "b2", from: 15, to: 28 },
    ]);

    // Unknown nodeId → command fails, state untouched.
    editor.commands.citeNode("no-such-node");
    expect(citations(editor)).toHaveLength(1);
  });

  it("stays out of undo history", () => {
    const editor = makeEditor();
    editor.applyTransaction(editor.getState().tr.insertText("abc", 1));
    editor.commands.setCitationHighlights([{ id: "c1", from: 18, to: 24 }]);

    editor.commands.undo();

    // Undo reverted the text edit, not the highlight — which remapped back.
    expect(editor.getState().doc.textContent).toBe("First block.Second block.");
    expect(citations(editor)).toEqual([{ id: "c1", from: 15, to: 21 }]);
  });
});
