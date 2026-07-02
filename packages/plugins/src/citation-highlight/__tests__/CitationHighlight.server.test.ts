/**
 * CitationHighlight state is plain ProseMirror plugin state, so every
 * behaviour except the actual canvas painting works on a headless
 * `ServerEditor` — commands set the ranges, edits remap them, deletions
 * drop them, and none of it touches undo history.
 */
import { describe, it, expect } from "vitest";
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
