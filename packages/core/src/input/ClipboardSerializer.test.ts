import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { serializeSelectionToHtml } from "./ClipboardSerializer";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeContext() {
  const manager = new ExtensionManager([StarterKit]);
  const schema = manager.schema;
  const state = EditorState.create({ schema, plugins: manager.buildPlugins() });
  return { schema, state, manager };
}

function withText(state: EditorState, text: string): EditorState {
  return state.apply(state.tr.insertText(text, 1));
}

function selectAll(state: EditorState): EditorState {
  const $from = state.doc.resolve(1);
  const $to = state.doc.resolve(state.doc.content.size - 1);
  return state.apply(state.tr.setSelection(TextSelection.between($from, $to)));
}

function selectRange(state: EditorState, from: number, to: number): EditorState {
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  return state.apply(state.tr.setSelection(TextSelection.between($from, $to)));
}

// ── serializeSelectionToHtml ──────────────────────────────────────────────────

describe("serializeSelectionToHtml", () => {
  it("returns null for a collapsed (empty) selection", () => {
    const { schema, state } = makeContext();
    const s = withText(state, "Hello");
    expect(serializeSelectionToHtml(s, schema)).toBeNull();
  });

  it("serializes plain text and contains the text content", () => {
    const { schema, state } = makeContext();
    const s = selectAll(withText(state, "Hello"));
    const html = serializeSelectionToHtml(s, schema);
    expect(html).not.toBeNull();
    expect(html).toContain("Hello");
    // Note: when the selection is entirely within one block, DOMSerializer emits
    // only inline content (no <p> wrapper). The <p> tag appears only when the
    // selection spans across block boundaries.
  });

  it("serializes bold text with <strong> tag", () => {
    const { schema, state, manager } = makeContext();
    let s = withText(state, "Hello");
    s = selectAll(s);
    // Apply bold mark to the selection
    const boldMark = schema.marks["bold"]!;
    s = s.apply(s.tr.addMark(1, 6, boldMark.create()));
    s = selectAll(s);
    const html = serializeSelectionToHtml(s, schema);
    expect(html).not.toBeNull();
    expect(html).toContain("<strong>");
    expect(html).toContain("Hello");
    void manager; // suppress unused warning
  });

  it("serializes italic text with <em> tag", () => {
    const { schema, state } = makeContext();
    let s = withText(state, "World");
    s = selectAll(s);
    const italicMark = schema.marks["italic"]!;
    s = s.apply(s.tr.addMark(1, 6, italicMark.create()));
    s = selectAll(s);
    const html = serializeSelectionToHtml(s, schema);
    expect(html).not.toBeNull();
    expect(html).toContain("<em>");
    expect(html).toContain("World");
  });

  it("serializes a heading as the correct <h> tag", () => {
    const { schema, state } = makeContext();
    let s = withText(state, "My Title");
    // Convert paragraph to heading level 2
    const headingType = schema.nodes["heading"]!;
    s = s.apply(s.tr.setBlockType(1, s.doc.content.size - 1, headingType, { level: 2 }));
    s = selectAll(s);
    const html = serializeSelectionToHtml(s, schema);
    expect(html).not.toBeNull();
    expect(html).toContain("<h2");
    expect(html).toContain("My Title");
  });

  it("serializes a heading as h1 for level 1", () => {
    const { schema, state } = makeContext();
    let s = withText(state, "Top");
    const headingType = schema.nodes["heading"]!;
    s = s.apply(s.tr.setBlockType(1, s.doc.content.size - 1, headingType, { level: 1 }));
    s = selectAll(s);
    const html = serializeSelectionToHtml(s, schema);
    expect(html).toContain("<h1");
  });

  it("serializes a heading with fontFamily attr as font-family style", () => {
    const { schema, state } = makeContext();
    let s = withText(state, "Fancy Heading");
    const headingType = schema.nodes["heading"]!;
    s = s.apply(s.tr.setBlockType(1, s.doc.content.size - 1, headingType, { level: 3, fontFamily: "Verdana" }));
    s = selectAll(s);
    const html = serializeSelectionToHtml(s, schema);
    expect(html).not.toBeNull();
    // happy-dom normalizes CSS properties to add a space after the colon
    expect(html).toMatch(/font-family:\s*Verdana/);
    expect(html).toContain("Fancy Heading");
  });

  it("serializes a heading with fontFamily — block tag is present when selection spans blocks", () => {
    // Headings always have a trailing paragraph (TrailingNode plugin), so selectAll
    // spans the h1 + the trailing <p>, which forces block-level serialization.
    const { schema, state } = makeContext();
    let s = withText(state, "Title");
    const headingType = schema.nodes["heading"]!;
    s = s.apply(s.tr.setBlockType(1, s.doc.content.size - 1, headingType, { level: 1, fontFamily: "Arial" }));
    s = selectAll(s);
    const html = serializeSelectionToHtml(s, schema);
    expect(html).toContain("<h1");
    expect(html).toMatch(/font-family:\s*Arial/);
  });

  it("includes only selected text when a partial range is selected", () => {
    const { schema, state } = makeContext();
    // "Hello World" — select only "Hello" (positions 1–6)
    let s = withText(state, "Hello World");
    s = selectRange(s, 1, 6);
    const html = serializeSelectionToHtml(s, schema);
    expect(html).not.toBeNull();
    expect(html).toContain("Hello");
    expect(html).not.toContain("World");
  });
});
