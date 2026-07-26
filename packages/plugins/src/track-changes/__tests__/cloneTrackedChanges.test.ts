import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TrackChanges } from "../TrackChanges";

describe("TrackChanges document clone", () => {
  it("re-keys change ids and preserves reference, move, and group links", () => {
    const content = {
      type: "doc",
      content: [{
        type: "paragraph",
        attrs: {
          nodeId: "p1",
          dataTracked: [{ id: "change-a", operation: "node_split", referenceId: "change-b", moveNodeId: "move-a" }],
        },
        content: [
          { type: "text", text: "one", marks: [{ type: "trackedInsert", attrs: { dataTracked: { id: "change-b", groupId: "group-a" } } }] },
          { type: "text", text: "two", marks: [{ type: "trackedInsert", attrs: { dataTracked: { id: "change-b", groupId: "group-a", moveNodeId: "move-a" } } }] },
        ],
      }],
    };

    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges],
      content,
      clone: { generate: ({ kind, typeName, oldId }) => `${kind}:${typeName}:${oldId}:clone` },
    });
    const paragraph = editor.getState().doc.firstChild!;
    const nodeChange = paragraph.attrs["dataTracked"][0] as Record<string, string>;
    const firstMark = paragraph.child(0).marks[0]!.attrs["dataTracked"] as Record<string, string>;
    const secondMark = paragraph.child(1).marks[0]!.attrs["dataTracked"] as Record<string, string>;

    expect(nodeChange.id).not.toBe("change-a");
    expect(nodeChange.referenceId).toBe(firstMark.id);
    expect(firstMark.id).toBe(secondMark.id);
    expect(firstMark.groupId).toBe(secondMark.groupId);
    expect(nodeChange.moveNodeId).toBe(secondMark.moveNodeId);
    expect(editor.cloneIdMap!.get("change-b")).toBe(firstMark.id);
    expect(editor.cloneIdMap!.getByType("change-b", "trackChange", "custom")).toBe(firstMark.id);
    expect(firstMark.id).toBe("custom:trackChange:change-b:clone");
    expect(content.content[0]!.attrs.dataTracked[0]!.id).toBe("change-a");
  });
});
