/**
 * subscribeToAiSuggestions tests.
 *
 * Verifies: immediate callback on subscribe, plugin-state identity skip,
 * card derivation (kind, label, summary), focus/blur transitions, actions.
 */

import { describe, it, expect, vi } from "vitest";
import { TestAiEditor, doc, p } from "./helpers";
import { subscribeToAiSuggestions } from "../subscribeToAiSuggestions";
import { AI_SUGGESTION_SET_ACTIVE } from "../AiSuggestionPlugin";
import type { AiSuggestion } from "../types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function rewriteSuggestion(nodeId: string): AiSuggestion {
  return {
    blocks: [
      {
        nodeId,
        acceptedText: "Hello world",
        ops: [
          { type: "keep",   text: "Hello " },
          { type: "delete", text: "world",    groupId: "g1" },
          { type: "insert", text: "universe", groupId: "g1" },
        ],
      },
    ],
  };
}

function insertOnlySuggestion(nodeId: string): AiSuggestion {
  return {
    blocks: [
      {
        nodeId,
        acceptedText: "Hello",
        ops: [
          { type: "keep",   text: "Hello" },
          { type: "insert", text: " world", groupId: "g1" },
        ],
      },
    ],
  };
}

function deleteOnlySuggestion(nodeId: string): AiSuggestion {
  return {
    blocks: [
      {
        nodeId,
        acceptedText: "Hello world",
        ops: [
          { type: "keep",   text: "Hello" },
          { type: "delete", text: " world", groupId: "g1" },
        ],
      },
    ],
  };
}

// ── Immediate callback ────────────────────────────────────────────────────────

describe("subscribeToAiSuggestions — initial call", () => {
  it("fires callback immediately with empty cards when no suggestion is set", () => {
    const editor = new TestAiEditor(doc(p("hello", "n1")));
    const cb = vi.fn();

    subscribeToAiSuggestions(editor, cb);

    expect(cb).toHaveBeenCalledOnce();
    const [cards] = cb.mock.calls[0]!;
    expect(cards).toHaveLength(0);
  });

  it("fires callback immediately with current cards when suggestion is already set", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    const cb = vi.fn();
    subscribeToAiSuggestions(editor, cb);

    expect(cb).toHaveBeenCalledOnce();
    const [cards] = cb.mock.calls[0]!;
    expect(cards).toHaveLength(1);
    expect(cards[0].blockId).toBe("n1");
  });
});

// ── Plugin-state identity skip ────────────────────────────────────────────────

describe("subscribeToAiSuggestions — identity optimization", () => {
  it("does NOT re-call callback when unrelated transaction fires", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    const cb = vi.fn();
    subscribeToAiSuggestions(editor, cb);
    const callsBefore = cb.mock.calls.length;

    // A plain text insert has no AI meta — plugin state reference unchanged
    editor._applyTransaction(editor.getState().tr.insertText("!"));

    expect(cb.mock.calls.length).toBe(callsBefore);
  });

  it("re-calls callback when suggestion changes", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1")));
    const cb = vi.fn();
    subscribeToAiSuggestions(editor, cb);
    const callsBefore = cb.mock.calls.length;

    editor.showSuggestion(rewriteSuggestion("n1"));

    expect(cb.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

// ── Card derivation — kind ────────────────────────────────────────────────────

describe("subscribeToAiSuggestions — card.kind", () => {
  it("kind is 'rewrite' when block has both delete and insert", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    const cb = vi.fn();
    subscribeToAiSuggestions(editor, cb);

    const [cards] = cb.mock.calls.at(-1)!;
    expect(cards[0].kind).toBe("rewrite");
  });

  it("kind is 'insert' when block has only inserts", () => {
    const editor = new TestAiEditor(doc(p("Hello", "n1")));
    editor.showSuggestion(insertOnlySuggestion("n1"));

    const cb = vi.fn();
    subscribeToAiSuggestions(editor, cb);

    const [cards] = cb.mock.calls.at(-1)!;
    expect(cards[0].kind).toBe("insert");
  });

  it("kind is 'delete' when block has only deletes", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1")));
    editor.showSuggestion(deleteOnlySuggestion("n1"));

    const cb = vi.fn();
    subscribeToAiSuggestions(editor, cb);

    const [cards] = cb.mock.calls.at(-1)!;
    expect(cards[0].kind).toBe("delete");
  });
});

// ── Card derivation — label / summary ────────────────────────────────────────

describe("subscribeToAiSuggestions — card.label and card.summary", () => {
  it("uses summary as label when block.summary is set", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1")));
    editor.showSuggestion({
      blocks: [
        {
          nodeId: "n1",
          acceptedText: "Hello world",
          summary: "Simplified the opening",
          ops: [
            { type: "delete", text: "Hello world", groupId: "g1" },
            { type: "insert", text: "Hi",          groupId: "g1" },
          ],
        },
      ],
    });

    const cb = vi.fn();
    subscribeToAiSuggestions(editor, cb);

    const [cards] = cb.mock.calls.at(-1)!;
    expect(cards[0].label).toContain("Simplified the opening");
    expect(cards[0].summary).toBe("Simplified the opening");
  });

  it("falls back to auto-derived label when no summary", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    const cb = vi.fn();
    subscribeToAiSuggestions(editor, cb);

    const [cards] = cb.mock.calls.at(-1)!;
    expect(typeof cards[0].label).toBe("string");
    expect(cards[0].label.length).toBeGreaterThan(0);
    expect(cards[0].summary).toBeUndefined();
  });
});

// ── isActive / isHovered ──────────────────────────────────────────────────────

describe("subscribeToAiSuggestions — isActive", () => {
  it("card.isActive is false initially", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    const cb = vi.fn();
    subscribeToAiSuggestions(editor, cb);

    const [cards] = cb.mock.calls.at(-1)!;
    expect(cards[0].isActive).toBe(false);
  });

  it("card.isActive becomes true when activeBlockId is set to that block", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    const cb = vi.fn();
    subscribeToAiSuggestions(editor, cb);

    editor._applyTransaction(
      editor.getState().tr.setMeta(AI_SUGGESTION_SET_ACTIVE, "n1"),
    );

    const [cards] = cb.mock.calls.at(-1)!;
    expect(cards[0].isActive).toBe(true);
  });
});

// ── onFocus / onBlur transitions ──────────────────────────────────────────────

describe("subscribeToAiSuggestions — onFocus / onBlur", () => {
  it("calls onFocus when activeBlockId transitions from null to a block id", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    const onFocus = vi.fn();
    subscribeToAiSuggestions(editor, vi.fn(), { onFocus });

    editor._applyTransaction(
      editor.getState().tr.setMeta(AI_SUGGESTION_SET_ACTIVE, "n1"),
    );

    expect(onFocus).toHaveBeenCalledOnce();
    expect(onFocus).toHaveBeenCalledWith("n1");
  });

  it("calls onBlur when activeBlockId transitions from a block id to null", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    const onBlur = vi.fn();
    subscribeToAiSuggestions(editor, vi.fn(), { onBlur });

    // Activate
    editor._applyTransaction(
      editor.getState().tr.setMeta(AI_SUGGESTION_SET_ACTIVE, "n1"),
    );
    // Deactivate
    editor._applyTransaction(
      editor.getState().tr.setMeta(AI_SUGGESTION_SET_ACTIVE, null),
    );

    expect(onBlur).toHaveBeenCalledOnce();
    expect(onBlur).toHaveBeenCalledWith("n1");
  });

  it("calls onBlur for old block and onFocus for new block on direct transition", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1"), p("Foo", "n2")));
    editor.showSuggestion({
      blocks: [
        {
          nodeId: "n1",
          acceptedText: "Hello world",
          ops: [{ type: "delete", text: "Hello world", groupId: "g1" }, { type: "insert", text: "Hi", groupId: "g1" }],
        },
        {
          nodeId: "n2",
          acceptedText: "Foo",
          ops: [{ type: "delete", text: "Foo", groupId: "g2" }, { type: "insert", text: "Bar", groupId: "g2" }],
        },
      ],
    });

    const onFocus = vi.fn();
    const onBlur  = vi.fn();
    subscribeToAiSuggestions(editor, vi.fn(), { onFocus, onBlur });

    editor._applyTransaction(
      editor.getState().tr.setMeta(AI_SUGGESTION_SET_ACTIVE, "n1"),
    );
    // Transition directly from n1 → n2
    editor._applyTransaction(
      editor.getState().tr.setMeta(AI_SUGGESTION_SET_ACTIVE, "n2"),
    );

    expect(onBlur).toHaveBeenCalledWith("n1");
    expect(onFocus).toHaveBeenCalledWith("n2");
  });

  it("does NOT call onFocus or onBlur for unrelated transactions", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    const onFocus = vi.fn();
    const onBlur  = vi.fn();
    subscribeToAiSuggestions(editor, vi.fn(), { onFocus, onBlur });

    editor._applyTransaction(editor.getState().tr.insertText("!"));

    expect(onFocus).not.toHaveBeenCalled();
    expect(onBlur).not.toHaveBeenCalled();
  });
});

// ── Unsubscribe ───────────────────────────────────────────────────────────────

describe("subscribeToAiSuggestions — unsubscribe", () => {
  it("stops calling callback after unsubscribe", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1")));
    const cb = vi.fn();

    const unsub = subscribeToAiSuggestions(editor, cb);
    const callsBefore = cb.mock.calls.length;

    unsub();
    editor.showSuggestion(rewriteSuggestion("n1"));

    expect(cb.mock.calls.length).toBe(callsBefore);
  });
});

// ── actions ───────────────────────────────────────────────────────────────────

describe("subscribeToAiSuggestions — actions", () => {
  it("actions.accept removes the block from plugin state", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    let capturedActions: ReturnType<typeof subscribeToAiSuggestions> extends never ? never : unknown;
    const unsub = subscribeToAiSuggestions(editor, (_cards, actions) => {
      capturedActions = actions;
    });

    (capturedActions as { accept: (id: string, mode: string) => void }).accept("n1", "direct");

    expect(editor.suggestionState!.suggestion).toBeNull();
    unsub();
  });

  it("actions.reject removes the block from plugin state", () => {
    const editor = new TestAiEditor(doc(p("Hello world", "n1")));
    editor.showSuggestion(rewriteSuggestion("n1"));

    let capturedActions: ReturnType<typeof subscribeToAiSuggestions> extends never ? never : unknown;
    const unsub = subscribeToAiSuggestions(editor, (_cards, actions) => {
      capturedActions = actions;
    });

    (capturedActions as { reject: (id: string) => void }).reject("n1");

    expect(editor.suggestionState!.suggestion).toBeNull();
    unsub();
  });
});
