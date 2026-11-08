/**
 * The semantic view is the proposed one: an object proposed for deletion is
 * left out, as deleted text is, though it carries no text for a mark to drop.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { toSemanticUnits } from "@scrivr/export-semantic";
import { TrackChanges } from "../TrackChanges";
import { TrackChangesStatus } from "../types";

describe("an image proposed for deletion", () => {
  it("is left out of the view, so its paragraph is no longer an image", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u", initialStatus: TrackChangesStatus.enabled })],
      content: { type: "doc", content: [
        { type: "paragraph", attrs: { nodeId: "fig" }, content: [{ type: "image", attrs: { src: "https://example.com/a.png" } }] },
        { type: "paragraph", attrs: { nodeId: "b" }, content: [{ type: "text", text: "after" }] },
      ] },
    });
    expect(toSemanticUnits(editor, { groupBlocks: false })[0]?.type).toBe("image");

    editor.applyTransaction(editor.getState().tr.delete(1, 2));
    const unit = toSemanticUnits(editor, { groupBlocks: false })[0];
    expect(unit?.type).toBe("paragraph");
    expect(unit?.image).toBeUndefined();
  });
});

describe("a paragraph whose text is proposed for deletion around an image", () => {
  it("reads as the image alone", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u", initialStatus: TrackChangesStatus.enabled })],
      content: { type: "doc", content: [
        { type: "paragraph", attrs: { nodeId: "fig" }, content: [
          { type: "text", text: "Figure:" },
          { type: "image", attrs: { src: "https://example.com/a.png" } },
        ] },
      ] },
    });
    expect(toSemanticUnits(editor, { groupBlocks: false })[0]?.type).toBe("paragraph");

    editor.applyTransaction(editor.getState().tr.delete(1, 8));
    expect(toSemanticUnits(editor, { groupBlocks: false })[0]?.type).toBe("image");
  });
});
