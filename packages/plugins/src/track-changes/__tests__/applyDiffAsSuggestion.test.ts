/**
 * A plain-text proposal lands on the block its id names. A pending move leaves
 * a deleted copy under the same id, first in the document when the block moved
 * down; the proposal belongs on the copy that is still there.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
// Through the package barrel, as a host imports them.
import { applyDiffAsSuggestion, applyMultiBlockDiff, TrackChanges, TrackChangesStatus } from "../index";

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
