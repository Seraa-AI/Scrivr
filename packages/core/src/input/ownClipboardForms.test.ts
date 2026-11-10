/**
 * A selection may write its own clipboard forms (a cell selection writes a
 * table). One that answers with something that is not text is not trusted:
 * the clipboard gets the document's own text and HTML instead.
 */
import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { serializeSelectionToHtml, serializeSelectionToText } from "./ClipboardSerializer";

const manager = new ExtensionManager([StarterKit]);
const schema = manager.schema;

/** A selection whose own clipboard forms are not text. */
class BrokenFormsSelection extends TextSelection {
  clipboardText(): unknown {
    return undefined;
  }
  clipboardHtml(): unknown {
    return null;
  }
}

describe("a selection's own clipboard forms", () => {
  const doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text("Hello"))]);
  const state = EditorState.create({ doc, selection: new BrokenFormsSelection(doc.resolve(1), doc.resolve(6)) });

  it("fall back to the document's text when they are not text", () => {
    expect(serializeSelectionToText(state)).toBe("Hello");
  });

  it("fall back to the document's HTML when they are not text", () => {
    expect(serializeSelectionToHtml(state, schema)).toContain("Hello");
  });
});
