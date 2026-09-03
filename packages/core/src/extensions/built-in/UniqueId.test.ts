/**
 * UniqueId — stamps stable nodeIds on LOCAL edits, but not on remote collab
 * applies (marked COLLAB_SYNC_META by the Yjs binding), so a block's id is
 * assigned once by its author and synced instead of re-stamped divergently on
 * every receiving client.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../StarterKit";
import { COLLAB_SYNC_META } from "./UniqueId";

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
