// @vitest-environment happy-dom
/**
 * The keys FieldCompletion answers, called as the input bridge calls them —
 * with the editor's navigator and the key's event — from the handlers the
 * extensions contribute.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ExtensionManager, Field, StarterKit, type SignerFieldDescriptor } from "@scrivr/core";
import { ViewEditorDouble } from "../__tests__/viewEditorDouble";
import { FieldCompletion, moveFieldFocus } from "../index";

const terms: SignerFieldDescriptor = { id: "terms", role: "client", kind: "dropdown", required: true, options: [{ id: "net-30", label: "Net 30" }] };
const sign: SignerFieldDescriptor = { id: "sign", role: "client", kind: "signature", required: true, options: [] };

let editor: ViewEditorDouble | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("FieldCompletion's keys", () => {
  it("takes Enter on a signature held back as handled: focus went to what is owed", () => {
    const completion = FieldCompletion.configure({ fields: [terms, sign], completable: [terms.id, sign.id], onFieldRequest: async () => null });
    editor = new ViewEditorDouble({
      extensions: [StarterKit, Field, completion],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "field", attrs: { nodeId: terms.id, kind: "dropdown", fill: "signer", role: "client", required: true, options: terms.options } },
              { type: "field", attrs: { nodeId: sign.id, kind: "signature", fill: "signer", role: "client", required: true } },
            ],
          },
        ],
      },
      sealed: true,
    });
    editor.mountView();
    const enter = new ExtensionManager([StarterKit, Field, completion]).buildInputHandlers()["Enter"];
    moveFieldFocus(editor, 1);
    expect(moveFieldFocus(editor, 1)).toBe(sign.id);

    expect(enter?.(editor.selection, new KeyboardEvent("keydown", { key: "Enter" }))).toBe(true);
    // Focus is on the owed field now: Tab goes on from it to the signature.
    expect(moveFieldFocus(editor, 1)).toBe(sign.id);
  });
});
