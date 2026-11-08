/**
 * AiToolkitAPI must be reachable on a headless `ServerEditor`.
 *
 * Every AiToolkitAPI method only touches `IBaseEditor` surface
 * (getState / applyTransaction / getMarkdown / schema), so the toolkit is
 * registered in `onEditorReady` — which fires in both the browser `Editor`
 * and `ServerEditor`. Only the overlay-painting sub-extensions are view-only.
 */
import { describe, it, expect } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TrackChanges, TrackChangesStatus } from "@scrivr/plugins";
import { aiCaretPluginKey } from "../AiCaret";
import { AiToolkit } from "../AiToolkit";
import { getAiToolkit } from "../aiToolkitRegistry";
import { moveFirstBlockToEnd } from "../../ai-suggestion/__tests__/helpers";

function serverEditorWithToolkit() {
  return new ServerEditor({
    extensions: [StarterKit, AiToolkit],
    // Persisted nodeIds — a real server doc carries the ids the client's
    // UniqueId already assigned. ServerEditor preserves them and never
    // fabricates new ones on load (deterministic addressing).
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { nodeId: "b1" }, content: [{ type: "text", text: "First block." }] },
        { type: "paragraph", attrs: { nodeId: "b2" }, content: [{ type: "text", text: "Second block." }] },
      ],
    },
  });
}

describe("AiToolkit on ServerEditor", () => {
  it("exposes the toolkit API on a headless ServerEditor", () => {
    const editor = serverEditorWithToolkit();
    const ai = getAiToolkit(editor);
    expect(ai).not.toBeNull();
  });

  it("getBlocks returns every nodeId-stamped block", () => {
    const editor = serverEditorWithToolkit();
    const ai = getAiToolkit(editor);
    const blocks = ai!.getBlocks();

    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.text)).toEqual(["First block.", "Second block."]);
    expect(blocks.every((b) => typeof b.nodeId === "string" && b.nodeId.length > 0)).toBe(true);
  });

  it("clears the toolkit from the registry on destroy", () => {
    const editor = serverEditorWithToolkit();
    expect(getAiToolkit(editor)).not.toBeNull();
    editor.destroy();
    expect(getAiToolkit(editor)).toBeNull();
  });
});

describe("streaming after a block with a pending move", () => {
  /** "moved" goes to the end as a tracked move; its deleted copy stays first. */
  const movedDown = () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled }), AiToolkit],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { nodeId: "b1" }, content: [{ type: "text", text: "moved" }] },
          { type: "paragraph", attrs: { nodeId: "b2" }, content: [{ type: "text", text: "stays" }] },
        ],
      },
    });
    moveFirstBlockToEnd(editor);
    const ai = getAiToolkit(editor);
    if (!ai) throw new Error("no toolkit");
    return { editor, ai };
  };

  async function* chunks(...parts: string[]) {
    for (const part of parts) yield part;
  }

  it("puts the AI caret after the moved block, not the copy it left behind", async () => {
    const { editor, ai } = movedDown();
    await ai.streamGhostText("b1", chunks("more"));

    expect(aiCaretPluginKey.getState(editor.getState())?.position).toBe(editor.getState().doc.content.size);
  });

  it("inserts the generated text after the moved block, not the copy it left behind", async () => {
    const { editor, ai } = movedDown();
    await ai.generateSuggestion("b1", chunks("generated"));

    const texts: string[] = [];
    editor.getState().doc.forEach((node) => texts.push(node.textContent));
    expect(texts.slice(-2)).toEqual(["moved", "generated"]);
  });
});
