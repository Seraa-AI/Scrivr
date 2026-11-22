import { expect, it, vi } from "vitest";
import { Plugin } from "prosemirror-state";
import { ServerEditor } from "../../ServerEditor";
import { Extension } from "../Extension";
import { StarterKit } from "../StarterKit";
import { Field, fieldValues, replaceFieldValues, setFieldValue } from "./Field";

it("replaces the entire record atomically on a sealed editor, preserving it on refusal", () => {
  let refuse = false;
  const editor = new ServerEditor({
    extensions: [StarterKit, Field.configure({ values: { old: { kind: "text", text: "Old" } } }),
      Extension.create({ name: "refuseValues", addProseMirrorPlugins: () => [new Plugin({ filterTransaction: () => !refuse })] }),
    ], sealed: true,
  });
  const doc = editor.getState().doc;
  const update = vi.fn();
  editor.on("update", update);
  expect(replaceFieldValues(editor, { next: { kind: "text", text: "Next" } })).toBe(true);
  expect(fieldValues(editor.getState())).toEqual({ next: { kind: "text", text: "Next" } });
  expect(update).toHaveBeenCalledTimes(1);
  refuse = true;
  expect(replaceFieldValues(editor, {})).toBe(false);
  expect(fieldValues(editor.getState())).toEqual({ next: { kind: "text", text: "Next" } });
  refuse = false;
  expect(setFieldValue(editor, "another", { kind: "checkbox", checked: true })).toBe(true);
  expect(Object.keys(fieldValues(editor.getState()))).toEqual(["next", "another"]);
  expect(replaceFieldValues(editor, {})).toBe(true);
  expect(fieldValues(editor.getState())).toEqual({});
  expect(editor.getState().doc).toBe(doc);
  editor.destroy();
});

it("reports an absent Field", () => {
  const editor = new ServerEditor({ extensions: [StarterKit] });
  expect(replaceFieldValues(editor, {})).toBe(false);
  expect(setFieldValue(editor, "sig", { kind: "text", text: "Ada" })).toBe(false);
  editor.destroy();
});
