import { describe, it, expect } from "vitest";
import { EditorState, TextSelection, Transaction } from "prosemirror-state";
import { ExtensionManager } from "../ExtensionManager";
import { StarterKit } from "../StarterKit";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContext() {
  const manager = new ExtensionManager([StarterKit]);
  const commands = manager.buildCommands();
  const schema = manager.schema;

  const state = EditorState.create({
    schema,
    plugins: manager.buildPlugins(),
  });

  return { schema, commands, state };
}

/** Returns the state after running a command by name (with optional args). */
function run(
  state: EditorState,
  commands: Record<string, (...args: unknown[]) => (s: EditorState, d?: (tr: Transaction) => void) => boolean>,
  name: string,
  ...args: unknown[]
): EditorState {
  let next = state;
  commands[name]!(...args)(state, (tr) => { next = state.apply(tr as Parameters<typeof state.apply>[0]); });
  return next;
}

/** Selects the whole content of the first paragraph (positions 1..end). */
function selectAll(state: EditorState): EditorState {
  const $from = state.doc.resolve(1);
  const $to = state.doc.resolve(state.doc.content.size - 1);
  return state.apply(state.tr.setSelection(TextSelection.between($from, $to)));
}

// ── setBlockFontFamily ────────────────────────────────────────────────────────

describe("setBlockFontFamily", () => {
  it("sets fontFamily attr on the cursor's paragraph", () => {
    const { commands, state } = makeContext();
    const next = run(state, commands, "setBlockFontFamily", "Arial");
    const para = next.doc.firstChild!;
    expect(para.attrs["fontFamily"]).toBe("Arial");
  });

  it("does not affect other paragraphs outside the selection", () => {
    const { schema, commands, state } = makeContext();
    // Insert a second paragraph and keep cursor in the first
    const tr = state.tr.insert(
      state.doc.content.size - 1,
      schema.nodes["paragraph"]!.create(null, schema.text("second"))
    );
    const twoParas = state.apply(tr);
    const next = run(twoParas, commands, "setBlockFontFamily", "Arial");

    expect(next.doc.child(0).attrs["fontFamily"]).toBe("Arial");
    expect(next.doc.child(1).attrs["fontFamily"]).toBeNull(); // untouched
  });

  it("applies to every paragraph in a multi-block selection", () => {
    const { schema, commands, state } = makeContext();
    const tr = state.tr.insert(
      state.doc.content.size - 1,
      schema.nodes["paragraph"]!.create(null, schema.text("second"))
    );
    const twoParas = state.apply(tr);
    // Select across both paragraphs
    const $from = twoParas.doc.resolve(1);
    const $to = twoParas.doc.resolve(twoParas.doc.content.size - 1);
    const selected = twoParas.apply(
      twoParas.tr.setSelection(TextSelection.between($from, $to))
    );
    const next = run(selected, commands, "setBlockFontFamily", "Verdana");

    expect(next.doc.child(0).attrs["fontFamily"]).toBe("Verdana");
    expect(next.doc.child(1).attrs["fontFamily"]).toBe("Verdana");
  });

  it("sets fontFamily on a heading node", () => {
    const { schema, commands, state } = makeContext();
    // Replace the default paragraph with a heading
    const tr = state.tr.replaceWith(
      0,
      state.doc.content.size,
      schema.nodes["heading"]!.create({ level: 1 }, schema.text("Title"))
    );
    const withHeading = state.apply(tr);
    const next = run(withHeading, commands, "setBlockFontFamily", "Times New Roman");

    expect(next.doc.firstChild!.attrs["fontFamily"]).toBe("Times New Roman");
  });

  it("replaces a previously set fontFamily", () => {
    const { commands, state } = makeContext();
    const after1 = run(state, commands, "setBlockFontFamily", "Arial");
    const after2 = run(after1, commands, "setBlockFontFamily", "Verdana");
    expect(after2.doc.firstChild!.attrs["fontFamily"]).toBe("Verdana");
  });
});

// ── unsetBlockFontFamily ──────────────────────────────────────────────────────

describe("unsetBlockFontFamily", () => {
  it("clears the fontFamily attr (back to null)", () => {
    const { commands, state } = makeContext();
    const withFamily = run(state, commands, "setBlockFontFamily", "Arial");
    expect(withFamily.doc.firstChild!.attrs["fontFamily"]).toBe("Arial");

    const cleared = run(withFamily, commands, "unsetBlockFontFamily");
    expect(cleared.doc.firstChild!.attrs["fontFamily"]).toBeNull();
  });

  it("is a no-op on a paragraph that has no fontFamily set", () => {
    const { commands, state } = makeContext();
    expect(state.doc.firstChild!.attrs["fontFamily"]).toBeNull();
    // Should not throw, and doc should be unchanged
    const next = run(state, commands, "unsetBlockFontFamily");
    expect(next.doc.firstChild!.attrs["fontFamily"]).toBeNull();
  });
});

// ── setFontFamily (inline mark, unchanged behaviour) ─────────────────────────

describe("setFontFamily — inline mark", () => {
  it("applies the font_family mark to selected text", () => {
    const { schema, commands, state } = makeContext();
    // Insert text so the paragraph has a text node to mark
    const withText = state.apply(
      state.tr.insertText("Hello", 1)
    );
    const selected = selectAll(withText);
    const next = run(selected, commands, "setFontFamily", "Arial");
    const marks = next.doc.firstChild!.firstChild!.marks;
    const familyMark = marks.find((m) => m.type.name === "font_family");
    expect(familyMark).toBeDefined();
    expect(familyMark!.attrs["family"]).toBe("Arial");
  });

  it("does not change the node-level fontFamily attr", () => {
    const { commands, state } = makeContext();
    const withText = state.apply(state.tr.insertText("Hello", 1));
    const selected = selectAll(withText);
    const next = run(selected, commands, "setFontFamily", "Arial");
    // node attr should be untouched (null = inherits from page/doc)
    expect(next.doc.firstChild!.attrs["fontFamily"]).toBeNull();
  });
});
