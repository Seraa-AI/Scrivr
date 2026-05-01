import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { schema } from "../model/schema";
import { defaultFloatingMenuShouldShow } from "./createFloatingMenu";

function stateWithDoc(doc: ReturnType<typeof schema.node>, cursorPos: number): EditorState {
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, cursorPos),
  });
}

describe("defaultFloatingMenuShouldShow", () => {
  it("shows for a structurally empty root text block", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, []),
    ]);

    expect(defaultFloatingMenuShouldShow(stateWithDoc(doc, 1))).toBe(true);
  });

  it("does not show for an anchor-only floating image paragraph", () => {
    const image = schema.nodes["image"]!.create({
      src: "",
      width: 100,
      height: 80,
      wrapMode: "square",
    });
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [image]),
    ]);

    expect(defaultFloatingMenuShouldShow(stateWithDoc(doc, 1))).toBe(false);
  });

  it("does not show for text content", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("hello")]),
    ]);

    expect(defaultFloatingMenuShouldShow(stateWithDoc(doc, 1))).toBe(false);
  });
});
