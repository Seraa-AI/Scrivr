import { describe, it, expect } from "vitest";
import { code, doc, p, schema, TestEditor } from "./helpers";
import { CHANGE_OPERATION } from "../types";

/**
 * Marks and node attrs are the engine's two representations, and the schema
 * decides which one is available: a node forbidding marks can only be stamped
 * on itself. Picking the wrong one builds content the node type rejects — and
 * `NodeType.create` does not validate, so the document stays broken until some
 * later transaction tries to touch that node and throws.
 */

const trackedMarks = (editor: TestEditor) => {
  const found: string[] = [];
  editor.state.doc.descendants(node => {
    if (!node.isText) return true;
    for (const mark of node.marks) {
      if (mark.type === schema.marks.trackedInsert) found.push("trackedInsert");
      if (mark.type === schema.marks.trackedDelete) found.push("trackedDelete");
    }
    return true;
  });
  return found;
};

describe("tracked representation follows the schema", () => {
  it("stamps an inserted mark-free block on the node, not its text", () => {
    const editor = new TestEditor(doc(p("tail")));
    editor.dispatch(editor.state.tr.insert(0, code("x = 1")));

    expect(trackedMarks(editor)).toEqual([]);
    expect(
      editor.pendingChanges
        .filter(c => c.type === "node-change")
        .map(c => c.dataTracked.operation),
    ).toContain(CHANGE_OPERATION.insert);
    expect(() => editor.state.doc.check()).not.toThrow();
  });

  it("leaves the document valid for the transaction that comes after", () => {
    const editor = new TestEditor(doc(p("tail")));
    editor.dispatch(editor.state.tr.insert(0, code("x = 1")));

    // The invalid content this used to build only surfaced here — any later
    // setNodeMarkup on the block threw rather than the insert that caused it.
    expect(() =>
      editor.dispatch(
        editor.state.tr.setNodeMarkup(0, undefined, {
          ...editor.state.doc.firstChild!.attrs,
          nodeId: "cb1",
        }),
      ),
    ).not.toThrow();
  });

  it("stamps a deleted mark-free block on the node, not its text", () => {
    const editor = new TestEditor(doc(code("x = 1"), p("tail")));
    editor.deleteRange(0, 7);

    expect(trackedMarks(editor)).toEqual([]);
    expect(editor.text).toContain("x = 1");
    expect(() => editor.state.doc.check()).not.toThrow();
  });

  it("still marks text where the schema admits marks", () => {
    const editor = new TestEditor(doc(p("tail")));
    editor.dispatch(editor.state.tr.insert(0, p("new")));

    expect(trackedMarks(editor)).toContain("trackedInsert");
  });
});
