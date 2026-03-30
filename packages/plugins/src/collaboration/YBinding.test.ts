import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { Schema } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import type { IEditor } from "@inscribe/core";
import { YBinding } from "./YBinding";

// Minimal schema — no y-prosemirror DOM conversion needed
const schema = new Schema({
  nodes: {
    doc:       { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text:      { group: "inline" },
  },
  marks: {},
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockEditor(initialState: EditorState): IEditor & { state: EditorState } {
  const mock = {
    state: initialState,
    getState: () => mock.state,
    subscribe: vi.fn(() => () => {}),
    _applyTransaction: (tr: Transaction) => { mock.state = mock.state.apply(tr); },
  } as unknown as IEditor & { state: EditorState };
  return mock;
}

function stateWithText(text: string, cursorPos?: number): EditorState {
  const para = schema.nodes["paragraph"]!.create(null, text ? schema.text(text) : undefined);
  const doc  = schema.nodes["doc"]!.create(null, para);
  const base = EditorState.create({ schema, doc });
  if (cursorPos !== undefined) {
    return base.apply(base.tr.setSelection(TextSelection.create(base.doc, cursorPos)));
  }
  return base;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("YBinding — markSynced cursor placement", () => {
  it("preserves cursor at start of document after first sync", () => {
    // typeObserver clamps cursor to Math.min(head, maxPos) — for an initial
    // empty-doc cursor at pos 2, this leaves it at pos 2 (start of content).
    const state = stateWithText("Hello world from the server", 2);
    expect(state.selection.head).toBe(2);

    const editor  = makeMockEditor(state);
    const ydoc    = new Y.Doc();
    const type    = ydoc.getXmlFragment("prosemirror");
    const binding = new YBinding(editor, ydoc, type);
    binding.bind();

    binding.markSynced();

    // Cursor stays where typeObserver left it — at the start of the content
    expect(editor.state.selection.head).toBe(2);

    binding.destroy();
  });

  it("preserves cursor position across reconnects", () => {
    const state  = stateWithText("Hello world", 2);
    const editor = makeMockEditor(state);

    const ydoc    = new Y.Doc();
    const type    = ydoc.getXmlFragment("prosemirror");
    const binding = new YBinding(editor, ydoc, type);
    binding.bind();

    binding.markSynced();

    // User moves cursor to middle
    const midPos = 4;
    editor._applyTransaction(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, midPos)),
    );
    expect(editor.state.selection.head).toBe(midPos);

    // Reconnect — markSynced does not move cursor
    binding.markSynced();
    expect(editor.state.selection.head).toBe(midPos);

    binding.destroy();
  });

  it("cursor remains within document bounds after sync", () => {
    const state  = stateWithText("Some text here", 2);
    const editor = makeMockEditor(state);

    const ydoc    = new Y.Doc();
    const type    = ydoc.getXmlFragment("prosemirror");
    const binding = new YBinding(editor, ydoc, type);
    binding.bind();
    binding.markSynced();

    const sel     = editor.state.selection;
    const docSize = editor.state.doc.content.size;
    expect(sel.head).toBeGreaterThan(0);
    expect(sel.head).toBeLessThanOrEqual(docSize);

    binding.destroy();
  });
});
