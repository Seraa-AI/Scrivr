/**
 * Accepting a suggestion scoped to a span, not a whole block.
 *
 * `accept(blockId)` applies every op the block carries, so a finding that only
 * meant to change one sentence rewrites the clause around it too. The span has
 * to be resolved against the live document at accept time: a span that has
 * drifted since the suggestion was written is not the span the model meant,
 * and applying it anyway is the failure this exists to prevent.
 */
import { describe, it, expect } from "vitest";
import { AiTestEditor, doc, p, markedText } from "./helpers";
// Through the package barrel: a host annotates against these, so one dropped
// from `index.ts` fails here rather than there.
import type { AiSuggestionData as AiSuggestion, AcceptedSpan } from "../../index";

const ACCEPTED = "One stays. Two changes. Three stays.";

/** Two independent groups in one block, each scoped to its own sentence. */
function twoSentences(nodeId: string): AiSuggestion {
  return {
    blocks: [
      {
        nodeId,
        acceptedText: ACCEPTED,
        ops: [
          { type: "keep", text: "One " },
          { type: "delete", text: "stays", groupId: "g1" },
          { type: "insert", text: "held", groupId: "g1" },
          { type: "keep", text: ". Two " },
          { type: "delete", text: "changes", groupId: "g2" },
          { type: "insert", text: "moved", groupId: "g2" },
          { type: "keep", text: ". Three stays." },
        ],
      },
    ],
  };
}

const editorWith = (text: string) => new AiTestEditor(doc(p(text, "b1")));

describe("accepting a range within a block", () => {
  it("applies only what the range covers", () => {
    const editor = editorWith(ACCEPTED);
    editor.showSuggestion(twoSentences("b1"));

    // "Two changes" — the second sentence only.
    editor.apply({ blockId: "b1", range: { from: 11, to: 24, acceptedText: ACCEPTED }, mode: "direct" });

    expect(editor.text).toBe("One stays. Two moved. Three stays.");
  });

  it("leaves the rest of the block pending, not settled", () => {
    // Asserted by what the remaining proposal still says, not by group id:
    // settling rebases the block, which re-mints the ids of what is left.
    const editor = editorWith(ACCEPTED);
    editor.showSuggestion(twoSentences("b1"));

    editor.apply({ blockId: "b1", range: { from: 11, to: 24, acceptedText: ACCEPTED }, mode: "direct" });

    const pending = editor.suggestionState?.suggestion?.blocks.flatMap((b) => b.ops) ?? [];
    expect(pending.filter((op) => op.type === "insert").map((op) => op.text)).toEqual(["held"]);
    expect(pending.filter((op) => op.type === "delete").map((op) => op.text)).toEqual(["stays"]);
  });

  it("applies a group only when the range contains the whole of it", () => {
    // Half a replacement is not a smaller replacement — it is a different one.
    // A group the range only clips is left for the reader to accept whole.
    const editor = editorWith(ACCEPTED);
    editor.showSuggestion(twoSentences("b1"));

    editor.apply({ blockId: "b1", range: { from: 11, to: 20, acceptedText: ACCEPTED }, mode: "direct" });

    expect(editor.text).toBe(ACCEPTED);
  });

  it("can take the whole block, and then matches an unscoped accept", () => {
    const scoped = editorWith(ACCEPTED);
    scoped.showSuggestion(twoSentences("b1"));
    scoped.apply({ blockId: "b1", range: { from: 0, to: ACCEPTED.length, acceptedText: ACCEPTED }, mode: "direct" });

    const whole = editorWith(ACCEPTED);
    whole.showSuggestion(twoSentences("b1"));
    whole.apply({ blockId: "b1", mode: "direct" });

    expect(scoped.text).toBe(whole.text);
  });

  it("refuses a range whose text has drifted since the suggestion was written", () => {
    // The offsets describe a snapshot. Once the reader has edited the block,
    // they address different words, and applying them lands the change on
    // text the model never saw.
    const editor = editorWith("Something else entirely here now.");
    editor.showSuggestion(twoSentences("b1"));
    const before = editor.text;

    const applied = editor.apply({ blockId: "b1", range: { from: 11, to: 24, acceptedText: ACCEPTED }, mode: "direct" });

    expect(applied).toBe(false);
    expect(editor.text).toBe(before);
  });

  it("says whether it wrote anything", () => {
    const editor = editorWith(ACCEPTED);
    editor.showSuggestion(twoSentences("b1"));

    // A range covering only unchanged text has no group to apply.
    expect(editor.apply({ blockId: "b1", range: { from: 24, to: 36, acceptedText: ACCEPTED }, mode: "direct" })).toBe(false);
    expect(editor.apply({ blockId: "b1", range: { from: 11, to: 24, acceptedText: ACCEPTED }, mode: "direct" })).toBe(true);
  });

  it("needs a block to scope to", () => {
    const editor = editorWith(ACCEPTED);
    editor.showSuggestion(twoSentences("b1"));

    expect(() => editor.apply({ range: { from: 0, to: 5, acceptedText: ACCEPTED }, mode: "direct" })).toThrow(
      /blockId/,
    );
  });

  it("records the accepted span as tracked, like an unscoped accept", () => {
    const editor = editorWith(ACCEPTED);
    editor.showSuggestion(twoSentences("b1"));

    editor.apply({ blockId: "b1", range: { from: 11, to: 24, acceptedText: ACCEPTED }, mode: "tracked" });

    // The words, and the review state of them — `toContain("moved")` alone is
    // true in direct mode too, so it would not have tested the mode at all.
    expect(markedText(editor, "trackedInsert")).toBe("moved");
    expect(markedText(editor, "trackedDelete")).toBe("changes");
  });
});

describe("acceptRange through the subscription", () => {
  it("is reachable by a host that only holds the card actions", async () => {
    const { subscribeToAiSuggestions } = await import("../subscribeToAiSuggestions");
    const editor = editorWith(ACCEPTED);
    editor.showSuggestion(twoSentences("b1"));

    let applied: boolean | null = null;
    const stop = subscribeToAiSuggestions(editor, (_cards, actions) => {
      if (applied === null) {
        applied = actions.acceptRange("b1", { from: 11, to: 24, acceptedText: ACCEPTED }, "direct");
      }
    });

    expect(applied).toBe(true);
    expect(editor.text).toBe("One stays. Two moved. Three stays.");
    stop();
  });
});

// ── The defects this feature shipped with ────────────────────────────────────

const THREE = "One stays. Two changes. Three alters.";

/** Three independent groups, one per sentence. */
function threeSentences(nodeId: string): AiSuggestion {
  return {
    blocks: [{
      nodeId,
      acceptedText: THREE,
      ops: [
        { type: "keep", text: "One " },
        { type: "delete", text: "stays", groupId: "g1" },
        { type: "insert", text: "held", groupId: "g1" },
        { type: "keep", text: ". Two " },
        { type: "delete", text: "changes", groupId: "g2" },
        { type: "insert", text: "moved", groupId: "g2" },
        { type: "keep", text: ". Three " },
        { type: "delete", text: "alters", groupId: "g3" },
        { type: "insert", text: "shifts", groupId: "g3" },
        { type: "keep", text: "." },
      ],
    }],
  };
}

const threeEditor = () => {
  const editor = new AiTestEditor(doc(p(THREE, "b1")));
  editor.showSuggestion(threeSentences("b1"));
  return editor;
};

const pendingInserts = (editor: AiTestEditor) =>
  (editor.suggestionState?.suggestion?.blocks.flatMap((b) => b.ops) ?? [])
    .filter((op) => op.type === "insert")
    .map((op) => op.text);

describe("a span covering more than one group", () => {
  it("leaves the groups it did not cover still pending", () => {
    // Settling used to be told about one group at a time, while the pass had
    // already written them all — so the first settle read its own writes as
    // reader drift and discarded the whole block's remaining proposal.
    const editor = threeEditor();

    editor.apply({ blockId: "b1", range: { from: 0, to: 23, acceptedText: THREE }, mode: "direct" });

    expect(editor.text).toBe("One held. Two moved. Three alters.");
    expect(pendingInserts(editor)).toEqual(["shifts"]);
  });

  it("leaves no tracked mark without a proposal to settle it from", () => {
    // Worse in tracked mode: the marks landed in the document and the cards
    // that would accept or reject them vanished.
    const editor = threeEditor();

    editor.apply({ blockId: "b1", range: { from: 0, to: 23, acceptedText: THREE }, mode: "tracked" });

    expect(editor.suggestionState?.suggestion).not.toBeNull();
    expect(pendingInserts(editor)).toEqual(["shifts"]);
  });
});

describe("a span measured against a stale snapshot", () => {
  it("is refused, because those offsets now name different words", () => {
    // A host derives its sentence ranges once when the card renders. Every
    // accept rewrites the block, so by the second click those numbers address
    // somewhere else — and settling refreshes `acceptedText`, so comparing the
    // document against the block could never notice.
    const editor = threeEditor();
    const thirdSentence = { from: 24, to: 37, acceptedText: THREE };

    editor.apply({ blockId: "b1", range: { from: 0, to: 10, acceptedText: THREE }, mode: "direct" });
    const afterFirst = editor.text;
    const wrote = editor.apply({ blockId: "b1", range: thirdSentence, mode: "direct" });

    expect(wrote).toBe(false);
    expect(editor.text).toBe(afterFirst);
  });

  it("is accepted once the host re-reads the span against the live block", () => {
    const editor = threeEditor();
    editor.apply({ blockId: "b1", range: { from: 0, to: 10, acceptedText: THREE }, mode: "direct" });

    const live = editor.suggestionState!.suggestion!.blocks[0]!.acceptedText;
    const wrote = editor.apply({
      blockId: "b1",
      range: { from: live.indexOf("Three"), to: live.length, acceptedText: live },
      mode: "direct",
    });

    expect(wrote).toBe(true);
    expect(editor.text).toBe("One held. Two changes. Three shifts.");
  });
});

describe("a span and a group both naming what to accept", () => {
  it("refuses rather than letting one win silently", () => {
    const editor = threeEditor();

    expect(() =>
      editor.apply({
        blockId: "b1",
        groupId: "g1",
        range: { from: 11, to: 23, acceptedText: THREE },
        mode: "direct",
      }),
    ).toThrow(/groupId/);
  });
});

describe("a span whose bounds say nothing coherent", () => {
  const cases: Array<[string, Omit<AcceptedSpan, "acceptedText">]> = [
    ["inverted", { from: 23, to: 11 }],
    ["collapsed", { from: 11, to: 11 }],
    ["starting before the block", { from: -5, to: 23 }],
    ["ending past the block", { from: 11, to: 9999 }],
  ];

  for (const [name, bounds] of cases) {
    it(`refuses a ${name} span rather than guessing`, () => {
      const editor = threeEditor();

      const wrote = editor.apply({
        blockId: "b1",
        range: { ...bounds, acceptedText: THREE },
        mode: "direct",
      });

      expect(wrote).toBe(false);
      expect(editor.text).toBe(THREE);
    });
  }
});
