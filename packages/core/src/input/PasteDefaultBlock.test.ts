/**
 * Pasted text becomes the schema's default block, whatever it is called. This
 * schema has no `paragraph`: its plain block is a `line`, declared outside core.
 */
import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { Document, Extension } from "../index";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { PasteTransformer } from "./PasteTransformer";

const Line = Extension.create({
  name: "line",
  addNodes() {
    return { line: { group: "block", content: "inline*", parseDOM: [{ tag: "p" }], toDOM: () => ["p", 0] } };
  },
});

const manager = new ExtensionManager([Document, Line]);
const schema = manager.schema;

function paste(data: Record<string, string>): Node {
  const doc = schema.node("doc", null, [schema.node("line", null, schema.text("XY"))]);
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 2) });
  const clipboardData = new DataTransfer();
  for (const [type, value] of Object.entries(data)) clipboardData.setData(type, value);
  const tr = new PasteTransformer(schema).transform(clipboardData, state);
  if (!tr) throw new Error("paste produced no transaction");
  return tr.doc;
}

const textsOf = (doc: Node): { type: string; text: string }[] => {
  const blocks: { type: string; text: string }[] = [];
  doc.forEach((block) => blocks.push({ type: block.type.name, text: block.textContent }));
  return blocks;
};

describe("pasting into a schema whose default block is not a paragraph", () => {
  it("makes each pasted line one of its blocks, merged into the text around the cursor", () => {
    expect(textsOf(paste({ "text/plain": "one\ntwo" }))).toEqual([
      { type: "line", text: "Xone" },
      { type: "line", text: "twoY" },
    ]);
  });

  it("merges a pasted plain block into the text around the cursor, as a paragraph would", () => {
    expect(textsOf(paste({ "text/html": "<p>one</p><p>two</p>" }))).toEqual([
      { type: "line", text: "Xone" },
      { type: "line", text: "twoY" },
    ]);
  });
});
