/**
 * UniqueId — stamps stable nodeIds on LOCAL edits, but not on remote collab
 * applies (marked COLLAB_SYNC_META by the Yjs binding), so a block's id is
 * assigned once by its author and synced instead of re-stamped divergently on
 * every receiving client.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../StarterKit";
import { TextSelection } from "prosemirror-state";
import { splitListItem } from "prosemirror-schema-list";
import { COLLAB_SYNC_META, NORMALIZATION_META, findNodeById } from "./UniqueId";

describe("findNodeById", () => {
  it("returns the first accepted match and does not inspect later matches", () => {
    const ed = editor();
    const { schema } = ed;
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { nodeId: "same" }, schema.text("first")),
      schema.node("paragraph", { nodeId: "same" }, schema.text("second")),
      schema.node("paragraph", { nodeId: "same" }, schema.text("third")),
    ]);
    expect(findNodeById(doc, "same")?.pos).toBe(0);
    const visited: number[] = [];
    const found = findNodeById(doc, "same", (_node, pos) => { visited.push(pos); return pos > 0; });
    expect(found?.node.textContent).toBe("second");
    expect(visited).toEqual([0, 7]);
    expect(findNodeById(doc, "same", () => false)).toBeNull();
  });

  it("continues into a refused ancestor and preserves absolute positions", () => {
    const { schema } = editor();
    const doc = schema.node("doc", null, [schema.node("bulletList", { nodeId: "same" }, [schema.node("listItem", null, [
      schema.node("paragraph", { nodeId: "same" }, schema.text("nested")),
    ])])]);
    const found = findNodeById(doc, "same", node => node.isTextblock);
    expect(found?.pos).toBe(2);
    expect(found?.node.textContent).toBe("nested");
  });
});

function editor(): ServerEditor {
  return new ServerEditor({
    extensions: [StarterKit],
    content: {
      type: "doc",
      content: [{ type: "paragraph", attrs: { nodeId: "p0" }, content: [{ type: "text", text: "hi" }] }],
    },
  });
}

function appendNullIdParagraph(ed: ServerEditor, text: string, remote: boolean): void {
  const { schema } = ed;
  const para = schema.node("paragraph", null, [schema.text(text)]); // nodeId defaults to null
  let tr = ed.getState().tr.insert(ed.getState().doc.content.size, para);
  if (remote) tr = tr.setMeta(COLLAB_SYNC_META, true);
  ed.applyTransaction(tr);
}

describe("UniqueId — stamping is housekeeping", () => {
  it("marks the ids it stamps as an edit nobody authored", () => {
    const ed = editor();
    const state = ed.getState();
    const para = ed.schema.node("paragraph", null, [ed.schema.text("new")]);
    const { transactions } = state.applyTransaction(state.tr.insert(state.doc.content.size, para));
    const stamped = transactions.slice(1);

    expect(stamped.length).toBeGreaterThan(0);
    expect(stamped.every(tr => tr.getMeta(NORMALIZATION_META))).toBe(true);
  });
});

describe("UniqueId — collab-safe stamping", () => {
  it("stamps a new block on a LOCAL edit", () => {
    const ed = editor();
    appendNullIdParagraph(ed, "local", false);
    const last = ed.getState().doc.lastChild!;
    expect(last.textContent).toBe("local");
    expect(typeof last.attrs["nodeId"]).toBe("string");
    expect(last.attrs["nodeId"]).not.toBe("");
  });

  it("does NOT stamp on a REMOTE collab apply (id stays null, no divergence)", () => {
    const ed = editor();
    appendNullIdParagraph(ed, "remote", true);
    const last = ed.getState().doc.lastChild!;
    expect(last.textContent).toBe("remote");
    // Author already assigned the id upstream; this client must not re-stamp.
    expect(last.attrs["nodeId"]).toBeNull();
  });

  it("does NOT stamp bookkeeping transactions appended during a REMOTE collab apply", () => {
    const ed = editor();
    const heading = ed.schema.node("heading", null, [ed.schema.text("remote heading")]);
    const state = ed.getState();
    const tr = state.tr
      .replaceWith(0, state.doc.content.size, heading)
      .setMeta(COLLAB_SYNC_META, true);

    ed.applyTransaction(tr);

    const doc = ed.getState().doc;
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).type.name).toBe("heading");
    expect(doc.child(0).attrs["nodeId"]).toBeNull();
    expect(doc.child(1).type.name).toBe("paragraph");
    expect(doc.child(1).attrs["nodeId"]).toBeNull();
  });

  it("preserves existing ids on the rest of the document", () => {
    const ed = editor();
    appendNullIdParagraph(ed, "local", false);
    expect(ed.getState().doc.firstChild!.attrs["nodeId"]).toBe("p0");
  });
});

describe("UniqueId — no two blocks share an id an edit created", () => {
  const ids = (ed: ServerEditor) => {
    const out: unknown[] = [];
    ed.getState().doc.descendants((node) => {
      if (node.isBlock && "nodeId" in node.attrs) out.push(node.attrs["nodeId"]);
    });
    return out;
  };

  it("gives the split-off half of a paragraph a fresh id; the first keeps its own", () => {
    const ed = editor();
    ed.applyTransaction(ed.getState().tr.split(2));
    const [first, second] = ids(ed);
    expect(first).toBe("p0");
    expect(typeof second).toBe("string");
    expect(second).not.toBe("p0");
  });

  it("gives the item an Enter splits off a list a fresh id", () => {
    const ed = new ServerEditor({
      extensions: [StarterKit],
      content: { type: "doc", content: [{ type: "bulletList", attrs: { nodeId: "l" }, content: [
        { type: "listItem", attrs: { nodeId: "li" }, content: [{ type: "paragraph", attrs: { nodeId: "p" }, content: [{ type: "text", text: "onetwo" }] }] },
      ] }] },
    });
    const listItem = ed.schema.nodes["listItem"];
    if (!listItem) throw new Error("no listItem");
    ed.applyTransaction(ed.getState().tr.setSelection(TextSelection.create(ed.getState().doc, 6)));
    splitListItem(listItem)(ed.getState(), (tr) => ed.applyTransaction(tr));
    const all = ids(ed);
    expect(new Set(all).size).toBe(all.length);
    expect(all.slice(0, 3)).toEqual(["l", "li", "p"]);
  });

  it("keeps a paragraph's id when Enter at its start opens an empty line before it", () => {
    const ed = editor();
    ed.applyTransaction(ed.getState().tr.split(1));
    const [empty, text] = [ed.getState().doc.child(0), ed.getState().doc.child(1)];
    expect(text.textContent).toBe("hi");
    expect(text.attrs["nodeId"]).toBe("p0");
    expect(empty.textContent).toBe("");
    expect(empty.attrs["nodeId"]).not.toBe("p0");
  });

  it("keeps a paragraph's id when Enter at its end opens an empty line after it", () => {
    const ed = editor();
    ed.applyTransaction(ed.getState().tr.split(3));
    expect(ed.getState().doc.child(0).attrs["nodeId"]).toBe("p0");
    expect(ed.getState().doc.child(1).attrs["nodeId"]).not.toBe("p0");
  });

  it("gives a pasted copy of a block a fresh id, leaving the original", () => {
    const ed = editor();
    const original = ed.getState().doc.child(0);
    ed.applyTransaction(ed.getState().tr.insert(ed.getState().doc.content.size, original));
    const [first, second] = ids(ed);
    expect(first).toBe("p0");
    expect(second).not.toBe("p0");
  });

  it("leaves a copy that bookkeeping puts back, as a pending move does", () => {
    const ed = editor();
    const original = ed.getState().doc.child(0);
    ed.applyTransaction(ed.getState().tr.insert(0, original).setMeta(NORMALIZATION_META, true));
    expect(ids(ed)).toEqual(["p0", "p0"]);
    ed.applyTransaction(ed.getState().tr.insertText("!", 1));
    expect(ids(ed)).toEqual(["p0", "p0"]);
  });

  it("does not re-key a copy that arrives through collaboration", () => {
    const ed = editor();
    const original = ed.getState().doc.child(0);
    ed.applyTransaction(ed.getState().tr.insert(ed.getState().doc.content.size, original).setMeta(COLLAB_SYNC_META, true));
    expect(ids(ed)).toEqual(["p0", "p0"]);
  });
});
