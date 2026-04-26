import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { ExtensionManager } from "../ExtensionManager";
import { StarterKit } from "../StarterKit";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContext() {
  const manager = new ExtensionManager([StarterKit]);
  const schema  = manager.schema;
  const keymap  = manager.buildKeymap();
  const state   = EditorState.create({ schema, plugins: manager.buildPlugins() });
  return { schema, keymap, state };
}

/** Run the Enter keymap command and return the resulting state, or null if not handled. */
function pressEnter(state: EditorState, keymap: Record<string, (s: EditorState, d?: (tr: Parameters<EditorState["apply"]>[0]) => void) => boolean>): EditorState | null {
  let next: EditorState | null = null;
  const cmd = keymap["Enter"];
  if (!cmd) return null;
  const handled = cmd(state, (tr) => { next = state.apply(tr); });
  return handled ? next : null;
}

/** Set fontFamily attr on the first paragraph block. */
function withFontFamily(state: EditorState, family: string): EditorState {
  const para = state.doc.firstChild!;
  const pos  = 0; // paragraph is at position 0 in doc
  return state.apply(
    state.tr.setNodeMarkup(pos, undefined, { ...para.attrs, fontFamily: family })
  );
}

/** Insert text into state (at current cursor). */
function insert(state: EditorState, text: string): EditorState {
  return state.apply(state.tr.insertText(text));
}

/** Move cursor to a given absolute document position. */
function moveTo(state: EditorState, pos: number): EditorState {
  const $pos = state.doc.resolve(pos);
  return state.apply(state.tr.setSelection(TextSelection.near($pos)));
}

// ── Enter key: font inheritance ───────────────────────────────────────────────

describe("Enter key — font inheritance", () => {
  it("new paragraph inherits fontFamily from the source paragraph", () => {
    const { keymap, state } = makeContext();

    // Type some text, set a custom font, then press Enter
    const s1 = insert(state, "Hello");
    const s2 = withFontFamily(s1, "Arial");
    const next = pressEnter(s2, keymap)!;

    expect(next).not.toBeNull();
    expect(next.doc.childCount).toBe(2);
    expect(next.doc.child(0).attrs["fontFamily"]).toBe("Arial");
    expect(next.doc.child(1).attrs["fontFamily"]).toBe("Arial");
  });

  it("new paragraph inherits align from the source paragraph", () => {
    const { schema, keymap, state } = makeContext();

    // Create a center-aligned paragraph
    const para = schema.nodes["paragraph"]!.create(
      { align: "center", fontFamily: null },
      schema.text("Centered")
    );
    const s1 = state.apply(state.tr.replaceWith(0, state.doc.content.size, para));
    // Move cursor to end of text
    const s2 = moveTo(s1, s1.doc.firstChild!.nodeSize - 1);
    const next = pressEnter(s2, keymap)!;

    expect(next.doc.child(1).attrs["align"]).toBe("center");
  });

  it("new paragraph inherits both fontFamily and align together", () => {
    const { schema, keymap, state } = makeContext();

    const para = schema.nodes["paragraph"]!.create(
      { align: "right", fontFamily: "Times New Roman" },
      schema.text("Legal text")
    );
    const s1 = state.apply(state.tr.replaceWith(0, state.doc.content.size, para));
    const s2 = moveTo(s1, s1.doc.firstChild!.nodeSize - 1);
    const next = pressEnter(s2, keymap)!;

    const newPara = next.doc.child(1);
    expect(newPara.attrs["fontFamily"]).toBe("Times New Roman");
    expect(newPara.attrs["align"]).toBe("right");
  });

  it("new paragraph has null fontFamily when source has none (no regression)", () => {
    const { keymap, state } = makeContext();

    const s1 = insert(state, "Hello");
    const next = pressEnter(s1, keymap)!;

    expect(next.doc.child(1).attrs["fontFamily"]).toBeNull();
  });

  it("still preserves inline marks (bold) on Enter", () => {
    const { schema, keymap, state } = makeContext();

    // Insert bold text
    const bold = schema.marks["bold"]!.create();
    const s1   = state.apply(
      state.tr
        .insertText("Bold text")
        .addMark(1, 10, bold)
        .setStoredMarks([bold])
    );
    const next = pressEnter(s1, keymap)!;

    // Stored marks should be applied to text typed after the split
    expect(next.storedMarks).not.toBeNull();
    expect(next.storedMarks!.some((m) => m.type.name === "bold")).toBe(true);
  });

  it("splits text correctly — content before/after cursor is preserved", () => {
    const { keymap, state } = makeContext();

    const s1 = insert(state, "HelloWorld");
    // Move cursor between "Hello" and "World" — position 6 (1 for node open + 5 chars)
    const s2 = moveTo(s1, 6);
    const s2f = withFontFamily(s2, "Georgia");
    const next = pressEnter(s2f, keymap)!;

    expect(next.doc.child(0).textContent).toBe("Hello");
    expect(next.doc.child(1).textContent).toBe("World");
    expect(next.doc.child(1).attrs["fontFamily"]).toBe("Georgia");
  });
});

  it("new paragraph inherits fontFamily from inline fontFamily mark when no block attr is set", () => {
    const { schema, keymap, state } = makeContext();

    // Insert text, apply fontFamily mark inline (the common toolbar path)
    const fontFamilyMark = schema.marks["fontFamily"]!.create({ family: "Times New Roman" });
    const s1 = state.apply(
      state.tr
        .insertText("Hello")
        .addMark(1, 6, fontFamilyMark)
    );
    // Cursor is at end of text; block attr fontFamily is still null
    expect(s1.doc.firstChild!.attrs["fontFamily"]).toBeNull();

    const next = pressEnter(s1, keymap)!;

    // The new paragraph should pick up the inline mark's family as its fontFamily attr
    expect(next.doc.child(1).attrs["fontFamily"]).toBe("Times New Roman");
  });

// ── Enter key: indent inheritance ────────────────────────────────────────────

describe("Enter key — indent inheritance", () => {
  it("new paragraph inherits indent from the source paragraph", () => {
    const { schema, keymap, state } = makeContext();

    const para = schema.nodes["paragraph"]!.create(
      { indent: 2 },
      schema.text("Indented text"),
    );
    const s1 = state.apply(state.tr.replaceWith(0, state.doc.content.size, para));
    const s2 = moveTo(s1, s1.doc.firstChild!.nodeSize - 1);
    const next = pressEnter(s2, keymap)!;

    expect(next.doc.child(1).attrs["indent"]).toBe(2);
  });

  it("new paragraph inherits textIndent from the source paragraph", () => {
    const { schema, keymap, state } = makeContext();

    const para = schema.nodes["paragraph"]!.create(
      { textIndent: 48 },
      schema.text("First-line indented"),
    );
    const s1 = state.apply(state.tr.replaceWith(0, state.doc.content.size, para));
    const s2 = moveTo(s1, s1.doc.firstChild!.nodeSize - 1);
    const next = pressEnter(s2, keymap)!;

    expect(next.doc.child(1).attrs["textIndent"]).toBe(48);
  });

  it("new paragraph inherits indent, textIndent, and align together", () => {
    const { schema, keymap, state } = makeContext();

    const para = schema.nodes["paragraph"]!.create(
      { align: "center", indent: 1, textIndent: 24 },
      schema.text("Full attrs"),
    );
    const s1 = state.apply(state.tr.replaceWith(0, state.doc.content.size, para));
    const s2 = moveTo(s1, s1.doc.firstChild!.nodeSize - 1);
    const next = pressEnter(s2, keymap)!;

    const newPara = next.doc.child(1);
    expect(newPara.attrs["align"]).toBe("center");
    expect(newPara.attrs["indent"]).toBe(1);
    expect(newPara.attrs["textIndent"]).toBe(24);
  });

  it("default indent is 0 when source has no indent", () => {
    const { keymap, state } = makeContext();

    const s1 = insert(state, "Hello");
    const next = pressEnter(s1, keymap)!;

    expect(next.doc.child(1).attrs["indent"]).toBe(0);
    expect(next.doc.child(1).attrs["textIndent"]).toBe(0);
  });
});

// ── Indent commands ─────────────────────────────────────────────────────────

describe("Indent commands", () => {
  it("increaseIndent increments the indent attr", () => {
    const { state } = makeContext();
    const s1 = insert(state, "Hello");

    const manager = new ExtensionManager([StarterKit]);
    const cmds = manager.buildCommands();
    let next: EditorState | null = null;
    cmds["increaseIndent"]!()(s1, (tr) => { next = s1.apply(tr); });

    expect(next).not.toBeNull();
    expect(next!.doc.firstChild!.attrs["indent"]).toBe(1);
  });

  it("decreaseIndent does not go below 0", () => {
    const { state } = makeContext();
    const s1 = insert(state, "Hello");

    const manager = new ExtensionManager([StarterKit]);
    const cmds = manager.buildCommands();
    let next: EditorState | null = null;
    const handled = cmds["decreaseIndent"]!()(s1, (tr) => { next = s1.apply(tr); });

    // indent is already 0, command should return false
    expect(handled).toBe(false);
  });

  it("increaseIndent caps at max indent level", () => {
    const { schema, state } = makeContext();

    const para = schema.nodes["paragraph"]!.create(
      { indent: 8 },
      schema.text("Max indented"),
    );
    const s1 = state.apply(state.tr.replaceWith(0, state.doc.content.size, para));
    const s2 = moveTo(s1, 2);

    const manager = new ExtensionManager([StarterKit]);
    const cmds = manager.buildCommands();
    let next: EditorState | null = null;
    const handled = cmds["increaseIndent"]!()(s2, (tr) => { next = s2.apply(tr); });

    expect(handled).toBe(false);
  });
});

// ── Enter key at end of heading ───────────────────────────────────────────────

describe("Enter key — heading → paragraph", () => {
  it("creates a paragraph (not another heading) after a heading", () => {
    const { schema, keymap, state } = makeContext();

    const heading = schema.nodes["heading"]!.create(
      { level: 1, fontFamily: "Arial" },
      schema.text("My Title")
    );
    const s1 = state.apply(state.tr.replaceWith(0, state.doc.content.size, heading));
    // Move cursor to end of heading content
    const s2 = moveTo(s1, s1.doc.firstChild!.nodeSize - 1);
    const next = pressEnter(s2, keymap)!;

    // StarterKit's TrailingNode plugin keeps a trailing paragraph at the end,
    // so after splitting the heading the doc is: heading + new-para + trailing-para.
    expect(next.doc.child(0).type.name).toBe("heading");
    expect(next.doc.child(1).type.name).toBe("paragraph");
  });

  it("new paragraph after heading inherits heading's fontFamily", () => {
    const { schema, keymap, state } = makeContext();

    const heading = schema.nodes["heading"]!.create(
      { level: 2, fontFamily: "Arial" },
      schema.text("Section Title")
    );
    const s1 = state.apply(state.tr.replaceWith(0, state.doc.content.size, heading));
    const s2 = moveTo(s1, s1.doc.firstChild!.nodeSize - 1);
    const next = pressEnter(s2, keymap)!;

    // child(1) is the new paragraph produced by the split (child(2) is the trailing para).
    expect(next.doc.child(1).attrs["fontFamily"]).toBe("Arial");
  });
});
