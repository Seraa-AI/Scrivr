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
import { AiToolkit } from "../AiToolkit";
import { getAiToolkit } from "../aiToolkitRegistry";

function serverEditorWithToolkit() {
  return new ServerEditor({
    extensions: [StarterKit, AiToolkit],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First block." }] },
        { type: "paragraph", content: [{ type: "text", text: "Second block." }] },
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
