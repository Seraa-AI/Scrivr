import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Command } from "prosemirror-state";
import type { Node as PMNode, Schema } from "prosemirror-model";
import { ExtensionManager } from "./ExtensionManager";
import { StarterKit } from "./StarterKit";

/**
 * Keymap composition invariants.
 *
 * `ExtensionManager.buildKeymap()` chains colliding bindings in registration
 * order, so the ORDER of StarterKit's `addExtensions()` list decides what a key
 * means. These tests pin the orderings that carry meaning — without them,
 * alphabetising that list looks harmless and silently breaks Enter in lists or
 * Tab in tables.
 *
 * They deliberately drive the merged keymap (what `InputBridge` dispatches),
 * not an individual extension's `addKeymap()`, because composition is the thing
 * under test.
 */

function makeKit(opts?: Parameters<typeof StarterKit.configure>[0]) {
  const manager = new ExtensionManager([opts ? StarterKit.configure(opts) : StarterKit]);
  return { schema: manager.schema, keymap: manager.buildKeymap() };
}

/** Run a bound key against `state`; returns the new state, or null if unhandled. */
function press(
  keymap: Record<string, Command>,
  key: string,
  state: EditorState,
): EditorState | null {
  const cmd = keymap[key];
  if (!cmd) return null;
  let next: EditorState | null = null;
  const handled = cmd(state, (tr) => {
    next = state.apply(tr);
  });
  return handled ? next : null;
}

function stateWithDoc(schema: Schema, doc: PMNode, cursorAt: number): EditorState {
  const state = EditorState.create({ schema, doc });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, cursorAt)));
}

/** Count nodes of a type anywhere in the doc. */
function countType(doc: PMNode, typeName: string): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === typeName) n += 1;
  });
  return n;
}

describe("StarterKit keymap composition", () => {
  describe("Enter — List must get first refusal, before Paragraph", () => {
    it("splits a list item into a SECOND list item, not a second paragraph in the same item", () => {
      const { schema, keymap } = makeKit();
      const { bulletList, listItem, paragraph } = schema.nodes;

      const doc = schema.topNodeType.create(null, [
        bulletList!.create(null, [listItem!.create(null, [paragraph!.create(null, schema.text("Hello"))])]),
      ]);
      // Cursor at the end of "Hello": doc(0) > list(1) > item(2) > para(3) > text
      const next = press(keymap, "Enter", stateWithDoc(schema, doc, 3 + "Hello".length));

      expect(next).not.toBeNull();
      // The regression this guards: Paragraph's splitBlockInheritAttrs running
      // first would produce ONE item holding TWO paragraphs.
      expect(countType(next!.doc, "listItem")).toBe(2);
      expect(countType(next!.doc, "paragraph")).toBe(2);
      expect(next!.doc.textContent).toBe("Hello");
    });

    it("still splits an ordinary paragraph outside any list", () => {
      const { schema, keymap } = makeKit();
      const doc = schema.topNodeType.create(null, [
        schema.nodes["paragraph"]!.create(null, schema.text("Hello")),
      ]);
      const next = press(keymap, "Enter", stateWithDoc(schema, doc, 1 + "Hello".length));

      expect(next).not.toBeNull();
      expect(countType(next!.doc, "paragraph")).toBe(2);
      expect(countType(next!.doc, "listItem")).toBe(0);
    });
  });

  describe("Tab — Table, then CodeBlock, then List", () => {
    it("indents inside a code block rather than sinking a list item", () => {
      const { schema, keymap } = makeKit();
      const doc = schema.topNodeType.create(null, [
        schema.nodes["codeBlock"]!.create(null, schema.text("x")),
      ]);
      const next = press(keymap, "Tab", stateWithDoc(schema, doc, 1 + 1));

      expect(next).not.toBeNull();
      // Code indentation is inserted as text; nothing structural happens.
      expect(next!.doc.textContent.length).toBeGreaterThan(1);
      expect(countType(next!.doc, "listItem")).toBe(0);
    });

    it("sinks a nested list item when the cursor is in a list", () => {
      const { schema, keymap } = makeKit();
      const { bulletList, listItem, paragraph } = schema.nodes;

      const item = (text: string) => listItem!.create(null, [paragraph!.create(null, schema.text(text))]);
      const doc = schema.topNodeType.create(null, [bulletList!.create(null, [item("one"), item("two")])]);

      // Cursor inside the SECOND item — the first item can't sink (nothing to nest under).
      const secondItemTextPos = 1 + 1 + 1 + "one".length + 1 + 1 + 1;
      const next = press(keymap, "Tab", stateWithDoc(schema, doc, secondItemTextPos));

      expect(next).not.toBeNull();
      // Sinking nests a new list inside the first item.
      expect(countType(next!.doc, "bulletList")).toBe(2);
      expect(next!.doc.textContent).toBe("onetwo");
    });
  });

  describe("Table — must get first refusal before CodeBlock/List/BaseEditing", () => {
    it("binds Tab, Shift-Tab, Backspace and Delete when tables are enabled", () => {
      const withTable = makeKit({ table: true });
      const withoutTable = makeKit();

      for (const key of ["Tab", "Shift-Tab", "Backspace", "Delete"]) {
        expect(withTable.keymap[key]).toBeDefined();
      }
      // Without tables the same keys still resolve — to the non-table handlers.
      expect(withoutTable.keymap["Backspace"]).toBeDefined();
      expect(withoutTable.keymap["Delete"]).toBeDefined();
    });

    it("leaves ordinary Backspace working outside a table (guard falls through)", () => {
      const { schema, keymap } = makeKit({ table: true });
      const doc = schema.topNodeType.create(null, [
        schema.nodes["paragraph"]!.create(null, schema.text("ab")),
      ]);
      const next = press(keymap, "Backspace", stateWithDoc(schema, doc, 3));

      expect(next).not.toBeNull();
      expect(next!.doc.textContent).toBe("a");
    });
  });

  describe("default document shape", () => {
    // Schema node order decides ProseMirror's fill node for `block+`. Paragraph
    // must be registered first or an empty document opens as a code block.
    it("creates an empty doc whose first block is a paragraph", () => {
      const { schema } = makeKit();
      const state = EditorState.create({ schema });
      expect(state.doc.firstChild?.type.name).toBe("paragraph");
    });
  });
});
