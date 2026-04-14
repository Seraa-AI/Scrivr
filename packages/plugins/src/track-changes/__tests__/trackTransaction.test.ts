import { describe, it, expect, beforeEach } from "vitest";
import { doc, p, h, ul, ol, li, TestEditor } from "./helpers";
import { CHANGE_OPERATION, TrackChangesStatus } from "../types";
import { trackChangesPlugin, trackChangesPluginKey } from "../engine/trackChangesPlugin";
import { EditorState } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import { history } from "prosemirror-history";
import { schema } from "./helpers";

// ── Node attribute change tracking ─────────────────────────────────────��──────

describe("trackTransaction — paragraph → heading", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor(doc(p("hello")));
  });

  it("setNodeMarkup(paragraph → heading 2) produces one node-attr-change", () => {
    const tr = editor.state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 2 });
    editor.dispatch(tr);

    expect(editor.pendingChanges).toHaveLength(1);
    const change = editor.pendingChanges[0]!;
    expect(change.type).toBe("node-attr-change");
    expect(change.dataTracked.operation).toBe(CHANGE_OPERATION.set_node_attributes);
  });

  it("node type actually changes in the document", () => {
    const tr = editor.state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 2 });
    editor.dispatch(tr);

    expect(editor.state.doc.firstChild!.type.name).toBe("heading");
    expect(editor.state.doc.firstChild!.attrs.level).toBe(2);
  });

  it("oldAttrs reflects the pre-change paragraph (level: null)", () => {
    const tr = editor.state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 2 });
    editor.dispatch(tr);

    const change = editor.pendingChanges[0]!;
    // @ts-expect-error — NodeAttrChange has oldAttrs
    expect(change.oldAttrs?.level ?? null).toBeNull();
  });

  it("newAttrs reflects the post-change heading level", () => {
    const tr = editor.state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 2 });
    editor.dispatch(tr);

    const change = editor.pendingChanges[0]!;
    // @ts-expect-error — NodeAttrChange has newAttrs
    expect(change.newAttrs?.level).toBe(2);
  });

  it("text content is preserved after paragraph → heading", () => {
    const tr = editor.state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 2 });
    editor.dispatch(tr);

    expect(editor.text).toBe("hello");
  });
});

describe("trackTransaction — heading level change (h1 → h2)", () => {
  it("h1 → h2 produces one node-attr-change with correct attrs", () => {
    const editor = new TestEditor(doc(h(1, "hello")));
    const tr = editor.state.tr.setNodeMarkup(0, schema.nodes.heading, { level: 2 });
    editor.dispatch(tr);

    expect(editor.pendingChanges).toHaveLength(1);
    const change = editor.pendingChanges[0]!;
    expect(change.type).toBe("node-attr-change");
    // @ts-expect-error
    expect(change.oldAttrs?.level).toBe(1);
    // @ts-expect-error
    expect(change.newAttrs?.level).toBe(2);
  });
});

describe("trackTransaction — heading → paragraph (reverse)", () => {
  it("heading → paragraph produces node-attr-change", () => {
    const editor = new TestEditor(doc(h(2, "hello")));
    const tr = editor.state.tr.setNodeMarkup(0, schema.nodes.paragraph, {});
    editor.dispatch(tr);

    expect(editor.pendingChanges).toHaveLength(1);
    expect(editor.pendingChanges[0]!.type).toBe("node-attr-change");
    expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
  });
});

// ── List type conversion tracking ─────────────────────────────────────────────

describe("trackTransaction — ordered → bullet list (type change)", () => {
  it("setNodeMarkup(ordered_list → bullet_list) produces one node-attr-change", () => {
    const editor = new TestEditor(doc(ol(li("item one"), li("item two"))));
    // pos 0 is the ordered_list node
    editor.dispatch(editor.state.tr.setNodeMarkup(0, schema.nodes.bullet_list, {}));

    expect(editor.pendingChanges).toHaveLength(1);
    const change = editor.pendingChanges[0]!;
    expect(change.type).toBe("node-attr-change");
    expect(change.dataTracked.operation).toBe(CHANGE_OPERATION.set_node_attributes);
  });

  it("node type changes to bullet_list in the document", () => {
    const editor = new TestEditor(doc(ol(li("item one"), li("item two"))));
    editor.dispatch(editor.state.tr.setNodeMarkup(0, schema.nodes.bullet_list, {}));

    expect(editor.state.doc.firstChild!.type.name).toBe("bullet_list");
  });

  it("list content is preserved after type change", () => {
    const editor = new TestEditor(doc(ol(li("item one"), li("item two"))));
    editor.dispatch(editor.state.tr.setNodeMarkup(0, schema.nodes.bullet_list, {}));

    expect(editor.state.doc.firstChild!.childCount).toBe(2);
    expect(editor.state.doc.textContent).toBe("item oneitem two");
  });

  it("accepting the change clears it; list stays as bullet_list", () => {
    const editor = new TestEditor(doc(ol(li("item one"))));
    editor.dispatch(editor.state.tr.setNodeMarkup(0, schema.nodes.bullet_list, {}));

    const ids = editor.pendingChanges.map(c => c.id);
    editor.acceptChanges(ids);

    expect(editor.pendingChanges).toHaveLength(0);
    expect(editor.state.doc.firstChild!.type.name).toBe("bullet_list");
  });

  it("rejecting the change reverts to ordered_list", () => {
    const editor = new TestEditor(doc(ol(li("item one"))));
    editor.dispatch(editor.state.tr.setNodeMarkup(0, schema.nodes.bullet_list, {}));

    const ids = editor.pendingChanges.map(c => c.id);
    editor.rejectChanges(ids);

    expect(editor.pendingChanges).toHaveLength(0);
    expect(editor.state.doc.firstChild!.type.name).toBe("ordered_list");
  });
});

describe("trackTransaction — bullet → ordered list (reverse)", () => {
  it("setNodeMarkup(bullet_list → ordered_list) produces one node-attr-change", () => {
    const editor = new TestEditor(doc(ul(li("item one"))));
    editor.dispatch(editor.state.tr.setNodeMarkup(0, schema.nodes.ordered_list, {}));

    expect(editor.pendingChanges).toHaveLength(1);
    expect(editor.pendingChanges[0]!.type).toBe("node-attr-change");
    expect(editor.state.doc.firstChild!.type.name).toBe("ordered_list");
  });
});

// ── Text operation tracking ────────────────────────────────────────────────────

describe("trackTransaction — basic insert and delete", () => {
  it("insert attributes correct author ID", () => {
    const editor = new TestEditor(doc(p("hello")), "author42");
    editor.insertAt(6, "!");

    expect(editor.pendingChanges).toHaveLength(1);
    expect(editor.pendingChanges[0]!.dataTracked.authorID).toBe("author42");
  });

  it("delete attributes correct author ID", () => {
    const editor = new TestEditor(doc(p("hello")), "author42");
    editor.deleteRange(5, 6); // delete "o"

    expect(editor.pendingChanges).toHaveLength(1);
    expect(editor.pendingChanges[0]!.dataTracked.authorID).toBe("author42");
  });

  it("insert has unique ID", () => {
    const editor = new TestEditor(doc(p("hello")));
    editor.insertAt(6, "!");
    editor.insertAt(6, "?"); // non-adjacent so they stay separate

    const ids = editor.pendingChanges.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });
});

// ── Tracking disabled ─────────────────────────────────────────────────────────

describe("trackTransaction — tracking disabled", () => {
  function makeDisabledEditor() {
    const state = EditorState.create({
      doc: doc(p("hello")),
      plugins: [
        history(),
        trackChangesPlugin({
          userID: "user1",
          initialStatus: TrackChangesStatus.disabled,
        }),
      ],
    });
    return {
      state,
      dispatch(tr: Transaction) {
        this.state = this.state.apply(tr);
      },
      get pendingChanges() {
        return trackChangesPluginKey.getState(this.state)?.changeSet.changes.filter(
          c => c.dataTracked.status === "pending",
        ) ?? [];
      },
      get text() { return this.state.doc.textContent; },
    };
  }

  it("inserting text does NOT create a tracked_insert mark", () => {
    const editor = makeDisabledEditor();
    editor.dispatch(editor.state.tr.insertText("!", 6));

    expect(editor.pendingChanges).toHaveLength(0);
    expect(editor.text).toBe("hello!");
  });

  it("deleting text does NOT create a tracked_delete mark", () => {
    const editor = makeDisabledEditor();
    editor.dispatch(editor.state.tr.delete(5, 6)); // delete "o"

    expect(editor.pendingChanges).toHaveLength(0);
    expect(editor.text).toBe("hell");
  });
});
