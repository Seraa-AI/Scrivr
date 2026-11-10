/**
 * Review changes are placed in the text they belong to, whoever contributes
 * them: a mark handler for text, `nodeChanges` for a node's own records.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import type { SemanticHandlers } from "@scrivr/core";
import { toSemanticUnits, unitRichHash } from "../index";

const doc = {
  type: "doc",
  content: [
    { type: "paragraph", attrs: { nodeId: "a" }, content: [{ type: "text", text: "Alpha" }] },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", attrs: { nodeId: "i1" }, content: [{ type: "text", text: "one" }] }] },
        { type: "listItem", content: [{ type: "paragraph", attrs: { nodeId: "i2" }, content: [{ type: "text", text: "two" }] }] },
      ],
    },
  ],
};

const flagged = (nodeId: string): SemanticHandlers => ({
  nodeChanges: (node) => node.attrs["nodeId"] === nodeId
    ? [
      { change: { type: "suggestedAttrs", text: "", id: "c" }, place: "covers" },
      { change: { type: "suggestedDelete", text: "\n", id: "j" }, place: "after" },
    ]
    : [],
});

describe("node changes", () => {
  it("cover a block's text, or sit after it", () => {
    const editor = new ServerEditor({ extensions: [StarterKit], content: doc });
    const [unit] = toSemanticUnits(editor, { groupBlocks: false, overrides: flagged("a") });
    expect(unit?.changes).toEqual([
      { type: "suggestedAttrs", text: "", id: "c", at: 0, length: 5 },
      { type: "suggestedDelete", text: "\n", id: "j", at: 5, length: 0 },
    ]);
  });

  it("inside a container are placed in the part and again in the unit", () => {
    const editor = new ServerEditor({ extensions: [StarterKit], content: doc });
    const list = toSemanticUnits(editor, { groupBlocks: false, overrides: flagged("i2") })[1];
    expect(list?.text).toBe("one\ntwo");
    expect(list?.parts?.[1]?.changes?.map((c) => [c.at, c.length])).toEqual([[0, 3], [3, 0]]);
    expect(list?.changes?.map((c) => [c.at, c.length])).toEqual([[4, 3], [7, 0]]);
  });

  it("leave a change-free unit's hash as it was", () => {
    const editor = new ServerEditor({ extensions: [StarterKit], content: doc });
    const [plain] = toSemanticUnits(editor, { groupBlocks: false });
    const [withChanges] = toSemanticUnits(editor, { groupBlocks: false, overrides: flagged("a") });
    if (!plain || !withChanges) throw new Error("no unit");
    expect(unitRichHash({ ...plain, changes: [] })).toBe(unitRichHash(plain));
    expect(unitRichHash(withChanges)).not.toBe(unitRichHash(plain));
  });
});
