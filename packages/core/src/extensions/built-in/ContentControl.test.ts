/**
 * Content controls — Word's `<w:sdt>`. The inline control is a box: a field a
 * signer completes, which the document never holds a value for, or an
 * author's checkbox, whose state is content like any other.
 */
import { describe, expect, it } from "vitest";
import { NodeSelection, TextSelection } from "prosemirror-state";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../StarterKit";
import { ContentControl, listSignerFields } from "./ContentControl";

const terms = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Signed: " }] }],
};

const drafter = () => {
  const editor = new ServerEditor({ extensions: [StarterKit, ContentControl], content: terms });
  const state = editor.getState();
  editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, 9)));
  return editor;
};

const controls = (editor: ServerEditor) => {
  const found: Array<{ pos: number; attrs: Record<string, unknown> }> = [];
  editor.getState().doc.descendants((node, pos) => {
    if (node.type.name === "contentControl") found.push({ pos, attrs: node.attrs });
  });
  return found;
};

describe("a signer field", () => {
  it("is listed by role for the host to assign, with an id of its own", () => {
    const editor = drafter();

    expect(
      editor.commands.insertContentControl({ kind: "signature", fill: "signer", role: "client", required: true }),
    ).toBe(true);

    const fields = listSignerFields(editor.getState().doc);
    expect(fields).toEqual([{ id: expect.any(String), role: "client", kind: "signature", required: true }]);
  });

  it("cannot be inserted without a role, since nobody could be asked to complete it", () => {
    const editor = drafter();

    expect(editor.commands.insertContentControl({ kind: "signature", fill: "signer" })).toBe(false);
    expect(controls(editor)).toEqual([]);
  });

  it("holds no value — a signer's checkbox cannot be checked in the document", () => {
    const editor = drafter();
    editor.commands.insertContentControl({ kind: "checkbox", fill: "signer", role: "client" });
    const [box] = controls(editor);
    editor.applyTransaction(
      editor.getState().tr.setSelection(NodeSelection.create(editor.getState().doc, box!.pos)),
    );

    expect(editor.commands.toggleContentControlChecked()).toBe(false);
    expect(controls(editor)[0]!.attrs["checked"]).toBe(false);
  });

  it("gets a fresh id when copied, so one signature never fills two boxes", () => {
    const editor = drafter();
    editor.commands.insertContentControl({ kind: "signature", fill: "signer", role: "client" });
    const [original] = controls(editor);
    const state = editor.getState();
    const copy = state.doc.slice(original!.pos, original!.pos + 1);

    editor.applyTransaction(state.tr.replace(state.doc.content.size - 1, state.doc.content.size - 1, copy));

    const ids = listSignerFields(editor.getState().doc).map((f) => f.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(original!.attrs["nodeId"]);
  });
});

describe("an author's checkbox", () => {
  it("toggles, and is not a field for anyone to sign", () => {
    const editor = drafter();
    editor.commands.insertContentControl({ kind: "checkbox", fill: "author" });
    const [box] = controls(editor);
    editor.applyTransaction(
      editor.getState().tr.setSelection(NodeSelection.create(editor.getState().doc, box!.pos)),
    );

    expect(editor.commands.toggleContentControlChecked()).toBe(true);

    expect(controls(editor)[0]!.attrs["checked"]).toBe(true);
    expect(listSignerFields(editor.getState().doc)).toEqual([]);
  });

  it("only exists as a checkbox — an author fills text as text", () => {
    const editor = drafter();

    expect(editor.commands.insertContentControl({ kind: "signature", fill: "author" })).toBe(false);
  });
});
