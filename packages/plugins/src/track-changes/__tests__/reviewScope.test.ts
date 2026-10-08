import { describe, it, expect } from "vitest";
import { doc, p, schema, TestEditor } from "./helpers";
import { trackChangesPluginKey } from "../index";

/**
 * A review answers for what it rewrote. A document can hold invalid content no
 * review touched — written by another author, or by an older defect — and
 * validating the whole document would make every decision in that document
 * permanently unresolvable, silently.
 */

// `create` does not validate, which is exactly how such content gets written.
const invalidCodeBlock = () =>
  schema.nodes.code_block!.create(
    null,
    schema.text("x", [schema.marks.bold!.create()]),
  );

const lastReview = (editor: TestEditor) =>
  trackChangesPluginKey.getState(editor.state)!.lastReview;

describe("review is scoped to what it rewrote", () => {
  it("resolves a change in a document holding unrelated invalid content", () => {
    const editor = new TestEditor(doc(p("hello"), invalidCodeBlock()));
    expect(() => editor.state.doc.check()).toThrow();

    editor.insertAt(6, "!");
    const pending = editor.pendingChanges.map(c => c.id);
    expect(pending.length).toBeGreaterThan(0);

    editor.acceptChanges(pending);

    expect(editor.pendingChanges).toEqual([]);
    expect(lastReview(editor)?.status).toBe("applied");
    expect(editor.text).toContain("hello!");
  });

});
