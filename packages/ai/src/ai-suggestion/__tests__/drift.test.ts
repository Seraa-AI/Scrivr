/**
 * A proposal describes a block's text as it was when the model saw it.
 *
 * Once the reader has edited that block, the ops address characters that have
 * moved or gone — so accepting lands the model's words somewhere it never
 * looked. Every accept path has to refuse, and the card has to be able to say
 * why rather than offering a button that silently does nothing.
 */
import { describe, it, expect } from "vitest";
import { AiTestEditor, doc, p } from "./helpers";
import { subscribeToAiSuggestions } from "../subscribeToAiSuggestions";
import type { AiSuggestionData as AiSuggestion } from "../../index";

const ONE = "The quick fox";
const TWO = "Hello world";

/** One group per block, so each block can be accepted on its own. */
const twoBlocks = (): AiSuggestion => ({
  blocks: [
    {
      nodeId: "b1",
      acceptedText: ONE,
      ops: [
        { type: "keep", text: "The " },
        { type: "delete", text: "quick", groupId: "g1" },
        { type: "insert", text: "slow", groupId: "g1" },
        { type: "keep", text: " fox" },
      ],
    },
    {
      nodeId: "b2",
      acceptedText: TWO,
      ops: [
        { type: "keep", text: "Hello " },
        { type: "delete", text: "world", groupId: "g2" },
        { type: "insert", text: "universe", groupId: "g2" },
      ],
    },
  ],
});

const editorWith = () => {
  const editor = new AiTestEditor(doc(p(ONE, "b1"), p(TWO, "b2")));
  editor.showSuggestion(twoBlocks());
  return editor;
};

/** Type into the first block, so its proposal no longer describes it. */
function editFirstBlock(editor: AiTestEditor): void {
  const state = editor.getState();
  editor.applyTransaction(state.tr.insertText("!", 1));
}

const pendingBlockIds = (editor: AiTestEditor) =>
  (editor.suggestionState?.suggestion?.blocks ?? []).map((b) => b.nodeId);

describe("accepting a block the reader has since edited", () => {
  it("is refused, and says so", () => {
    const editor = editorWith();
    editFirstBlock(editor);
    const before = editor.text;

    const wrote = editor.apply({ blockId: "b1", mode: "direct" });

    expect(wrote).toBe(false);
    expect(editor.text).toBe(before);
  });

  it("leaves the proposal pending, so the reader can ask again", () => {
    const editor = editorWith();
    editFirstBlock(editor);

    editor.apply({ blockId: "b1", mode: "direct" });

    expect(pendingBlockIds(editor)).toContain("b1");
  });

  it("refuses a group inside it too", () => {
    const editor = editorWith();
    editFirstBlock(editor);
    const before = editor.text;

    expect(editor.apply({ groupId: "g1", mode: "direct" })).toBe(false);
    expect(editor.text).toBe(before);
  });

  it("refuses in tracked mode as well, writing no marks", () => {
    const editor = editorWith();
    editFirstBlock(editor);
    const before = editor.text;

    expect(editor.apply({ blockId: "b1", mode: "tracked" })).toBe(false);
    expect(editor.text).toBe(before);
  });
});

describe("accepting everything when one block has drifted", () => {
  it("applies the blocks that still match and leaves the drifted one", () => {
    // Skipping the whole batch would punish the reader for an edit that has
    // nothing to do with the other blocks.
    const editor = editorWith();
    editFirstBlock(editor);

    const wrote = editor.apply({ mode: "direct" });

    expect(wrote).toBe(true);
    expect(editor.text).toContain("universe");
    expect(editor.text).toContain("quick");
    expect(pendingBlockIds(editor)).toEqual(["b1"]);
  });

  it("clears the suggestion when every block was accepted", () => {
    const editor = editorWith();

    editor.apply({ mode: "direct" });

    expect(editor.suggestionState?.suggestion).toBeNull();
  });
});

describe("a card for a drifted block", () => {
  const cardsOf = (editor: AiTestEditor) => {
    let seen: Array<{ blockId: string; isStale: boolean }> = [];
    const stop = subscribeToAiSuggestions(editor, (cards) => {
      seen = cards.map((c) => ({ blockId: c.blockId, isStale: c.isStale }));
    });
    stop();
    return seen;
  };

  it("reports it stale, so the UI can explain the refusal", () => {
    // Derived from the document, not from plugin state nothing writes — the
    // flag was permanently false, so a reader got a dead button and no reason.
    const editor = editorWith();
    editFirstBlock(editor);

    expect(cardsOf(editor)).toEqual([
      { blockId: "b1", isStale: true },
      { blockId: "b2", isStale: false },
    ]);
  });

  it("reports nothing stale when the document still matches", () => {
    expect(cardsOf(editorWith()).every((c) => !c.isStale)).toBe(true);
  });
});
