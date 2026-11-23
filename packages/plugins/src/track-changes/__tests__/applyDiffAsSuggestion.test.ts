/**
 * A plain-text proposal lands on the block its id names. A pending move leaves
 * a deleted copy under the same id, first in the document when the block moved
 * down; the proposal belongs on the copy that is still there.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
// Through the package barrel, as a host imports them.
import { applyDiffAsSuggestion, applyMultiBlockDiff, findChanges, TrackChanges, TrackChangesStatus, type MultiBlockDiffResult } from "../index";

/** "The quick fox" moved to the end as a tracked move; its deleted copy stays first. */
function movedDown() {
  const editor = new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled })],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { nodeId: "b1" }, content: [{ type: "text", text: "The quick fox" }] },
        { type: "paragraph", attrs: { nodeId: "b2" }, content: [{ type: "text", text: "tail" }] },
      ],
    },
  });
  const first = editor.getState().doc.child(0);
  const tr = editor.getState().tr.delete(0, first.nodeSize);
  editor.applyTransaction(tr.insert(tr.doc.content.size, first));
  return editor;
}

const lastBlockText = (editor: ServerEditor) => {
  const { doc } = editor.getState();
  return doc.child(doc.childCount - 1).textContent;
};

describe("a proposal for a block with a pending move", () => {
  it("is suggested on the moved block, not the copy it left behind", () => {
    const editor = movedDown();
    const result = applyDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), {
      nodeId: "b1", proposedText: "The slow fox", authorID: "ai",
    });

    expect(result.applied).toBe(true);
    expect(lastBlockText(editor)).toContain("slow");
  });

  it("is suggested on the moved block when it comes with others", () => {
    const editor = movedDown();
    const result = applyMultiBlockDiff(editor.getState(), (tr) => editor.applyTransaction(tr), {
      blocks: [{ nodeId: "b1", proposedText: "The slow fox" }, { nodeId: "b2", proposedText: "tail end" }],
      authorID: "ai",
    });

    expect(result.applied).toBe(true);
    expect(lastBlockText(editor)).toContain("slow");
  });

  it("replaces the author's earlier proposal on the moved block", () => {
    const editor = movedDown();
    const dispatch = (tr: Parameters<ServerEditor["applyTransaction"]>[0]) => editor.applyTransaction(tr);
    applyDiffAsSuggestion(editor.getState(), dispatch, { nodeId: "b1", proposedText: "The slow fox", authorID: "ai" });
    applyDiffAsSuggestion(editor.getState(), dispatch, { nodeId: "b1", proposedText: "The fast fox", authorID: "ai" });

    expect(lastBlockText(editor)).toContain("fast");
    expect(lastBlockText(editor)).not.toContain("slow");
  });

  it("replaces the author's earlier proposal on the moved block when it comes with others", () => {
    const editor = movedDown();
    const dispatch = (tr: Parameters<ServerEditor["applyTransaction"]>[0]) => editor.applyTransaction(tr);
    const propose = (text: string) => applyMultiBlockDiff(editor.getState(), dispatch, {
      blocks: [{ nodeId: "b1", proposedText: text }, { nodeId: "b2", proposedText: "tail end" }],
      authorID: "ai",
    });
    propose("The slow fox");
    propose("The fast fox");

    expect(lastBlockText(editor)).toContain("fast");
    expect(lastBlockText(editor)).not.toContain("slow");
  });
});

describe("a small proposal in a long paragraph", () => {
  it("changes the word it names and keeps the clause's formatting", () => {
    const words = Array.from({ length: 150 }, (_, i) => `term${i}`);
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
      content: { type: "doc", content: [
        { type: "paragraph", attrs: { nodeId: "b1" }, content: [{ type: "text", text: words.join(" "), marks: [{ type: "bold" }] }] },
      ] },
    });
    const proposed = words.map((w, i) => (i === 75 ? "clause" : w)).join(" ");
    const result = applyDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), {
      nodeId: "b1", proposedText: proposed, authorID: "ai",
    });
    expect(result.applied).toBe(true);
    expect(result.editDensity).toBeLessThan(0.05);

    editor.commands.setChangeStatuses("accepted", findChanges(editor.getState()).pending.map((c) => c.id));
    const paragraph = editor.getState().doc.child(0);
    expect(paragraph.textContent).toBe(proposed);
    paragraph.forEach((child) => expect(child.marks.map((m) => m.type.name)).toContain("bold"));
  });
});

describe("a call that names one block twice", () => {
  const twoBlocks = () => new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled })],
    content: { type: "doc", content: [
      { type: "paragraph", attrs: { nodeId: "b1" }, content: [{ type: "text", text: "teh cat sat" }] },
      { type: "paragraph", attrs: { nodeId: "b2" }, content: [{ type: "text", text: "a dgo ran" }] },
    ] },
  });

  it("reports a block it cannot find as missing, not repeated", () => {
    const editor = twoBlocks();
    const result: MultiBlockDiffResult = applyMultiBlockDiff(editor.getState(), (tr) => editor.applyTransaction(tr), {
      blocks: [{ nodeId: "gone", proposedText: "x" }, { nodeId: "gone", proposedText: "y" }, { nodeId: "b2", proposedText: "a dog ran" }],
      authorID: "ai",
    });
    expect(result.rejected).toEqual([]);
    expect(result.applied).toBe(true);
  });

  it("leaves that block alone and reports it, and still applies the rest", () => {
    const editor = twoBlocks();
    const result = applyMultiBlockDiff(editor.getState(), (tr) => editor.applyTransaction(tr), {
      blocks: [
        { nodeId: "b1", proposedText: "the cat sat" },
        { nodeId: "b2", proposedText: "a dog ran" },
        { nodeId: "b1", proposedText: "teh dog sat" },
      ],
      authorID: "ai",
    });

    expect(result.applied).toBe(true);
    expect(result.rejected).toEqual(["b1"]);
    expect(editor.getState().doc.child(0).textContent).toBe("teh cat sat");
    expect(findChanges(editor.getState()).pending.length).toBeGreaterThan(0);
  });
});

describe("new words in a plain proposal take formatting as typing does", () => {
  const accepted = (content: unknown[], proposedText: string) => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
      content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "b1" }, content }] },
    });
    applyDiffAsSuggestion(editor.getState(), (tr) => editor.applyTransaction(tr), { nodeId: "b1", proposedText, authorID: "ai" });
    editor.commands.setChangeStatuses("accepted", findChanges(editor.getState()).pending.map((c) => c.id));
    const runs: Array<[string, string[]]> = [];
    editor.getState().doc.child(0).forEach((child) => runs.push([child.text ?? "", child.marks.map((m) => m.type.name)]));
    return runs;
  };

  it("a replaced word takes the formatting of the word it replaces", () => {
    expect(accepted([{ type: "text", text: "a " }, { type: "text", text: "quick", marks: [{ type: "italic" }] }, { type: "text", text: " fox" }], "a slow fox"))
      .toEqual([["a ", []], ["slow", ["italic"]], [" fox", []]]);
  });

  it("an insertion takes the formatting of the text before it", () => {
    expect(accepted([{ type: "text", text: "a " }, { type: "text", text: "b", marks: [{ type: "bold" }] }], "a b c"))
      .toEqual([["a ", []], ["b c", ["bold"]]]);
  });

  it("an insertion inside a link stays in the link", () => {
    const link = { type: "link", attrs: { href: "https://example.com" } };
    expect(accepted([{ type: "text", text: "go " }, { type: "text", text: "big site", marks: [link] }, { type: "text", text: " now" }], "go big new site now"))
      .toEqual([["go ", []], ["big new site", ["link"]], [" now", []]]);
  });

  it("an insertion at the start of a line takes the line's formatting", () => {
    const b = [{ type: "bold" }];
    expect(accepted([{ type: "text", text: "ab", marks: b }, { type: "hardBreak" }, { type: "text", text: "cd", marks: b }], "ab\nNew cd"))
      .toEqual([["ab", ["bold"]], ["", []], ["New cd", ["bold"]]]);
  });

  it("an insertion after a link does not grow the link", () => {
    const link = { type: "link", attrs: { href: "https://example.com" } };
    expect(accepted([{ type: "text", text: "see " }, { type: "text", text: "site", marks: [link] }], "see site now"))
      .toEqual([["see ", []], ["site", ["link"]], [" now", []]]);
  });
});
