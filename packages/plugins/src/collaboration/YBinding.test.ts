import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { TextSelection } from "prosemirror-state";
import { ServerEditor } from "@scrivr/core";
import { YBinding } from "./YBinding";

// ── Helpers ───────────────────────────────────────────────────────────────────
//
// Tests drive a real `ServerEditor` (BaseEditor) — its `getState`, `subscribe`,
// and `applyTransaction` are the same surface YBinding consumes in production.
// No `as unknown as IEditor` fake editor shape.

function makeEditor(text: string, cursorPos?: number): ServerEditor {
  const editor = new ServerEditor({
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: text ? [{ type: "text", text }] : [] },
      ],
    },
  });
  if (cursorPos !== undefined) {
    const state = editor.getState();
    editor.applyTransaction(
      state.tr.setSelection(TextSelection.create(state.doc, cursorPos)),
    );
  }
  return editor;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("YBinding — markSynced cursor placement", () => {
  it("preserves cursor at start of document after first sync", () => {
    // typeObserver clamps cursor to Math.min(head, maxPos) — for an initial
    // empty-doc cursor at pos 2, this leaves it at pos 2 (start of content).
    const editor = makeEditor("Hello world from the server", 2);
    expect(editor.getState().selection.head).toBe(2);

    const ydoc    = new Y.Doc();
    const type    = ydoc.getXmlFragment("prosemirror");
    const binding = new YBinding(editor, ydoc, type);
    binding.bind();

    binding.markSynced();

    // Cursor stays where typeObserver left it — at the start of the content
    expect(editor.getState().selection.head).toBe(2);

    binding.destroy();
  });

  it("preserves cursor position across reconnects", () => {
    const editor = makeEditor("Hello world", 2);

    const ydoc    = new Y.Doc();
    const type    = ydoc.getXmlFragment("prosemirror");
    const binding = new YBinding(editor, ydoc, type);
    binding.bind();

    binding.markSynced();

    // User moves cursor to middle
    const midPos = 4;
    const beforeMove = editor.getState();
    editor.applyTransaction(
      beforeMove.tr.setSelection(TextSelection.create(beforeMove.doc, midPos)),
    );
    expect(editor.getState().selection.head).toBe(midPos);

    // Reconnect — markSynced does not move cursor
    binding.markSynced();
    expect(editor.getState().selection.head).toBe(midPos);

    binding.destroy();
  });

  it("cursor remains within document bounds after sync", () => {
    const editor = makeEditor("Some text here", 2);

    const ydoc    = new Y.Doc();
    const type    = ydoc.getXmlFragment("prosemirror");
    const binding = new YBinding(editor, ydoc, type);
    binding.bind();
    binding.markSynced();

    const state   = editor.getState();
    const sel     = state.selection;
    const docSize = state.doc.content.size;
    expect(sel.head).toBeGreaterThan(0);
    expect(sel.head).toBeLessThanOrEqual(docSize);

    binding.destroy();
  });
});
