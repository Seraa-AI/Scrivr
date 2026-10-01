/**
 * The size in effect at the selection.
 *
 * The counterpart to `getActiveFontFamily`. Most runs carry no `fontSize` mark
 * and still render at a size — the block style's — so a resolver that only read
 * the mark would answer "unset" for nearly every position.
 */
import { describe, expect, it } from "vitest";
import { getBlockStyle, type BlockStyle, type FontConfig } from "../layout/FontConfig";
import { createTestEditor } from "../test-utils";
import { StarterKit } from "../extensions/StarterKit";
import { Table } from "../extensions/built-in/Table";
import { TextSelection } from "prosemirror-state";
import { parseFontSizePx } from "./activeFontSize";
// `resolveActiveFontSize` is published for a headless caller — through the
// barrel, so dropping it from `index.ts` fails here.
import { resolveActiveFontSize, DEFAULT_FONT_SIZE_PX } from "../index";

const style = (font: string): BlockStyle => ({ font, spaceBefore: 0, spaceAfter: 0, align: "left" });

const CONFIG: FontConfig = {
  paragraph: style("14px Georgia"),
  heading_1: style("bold 32px Georgia"),
  heading_2: style("bold 24px Georgia"),
  codeBlock: style("13px monospace"),
};

describe("parseFontSizePx", () => {
  it("reads the size out of a block style's font shorthand", () => {
    expect(parseFontSizePx("14px Georgia")).toBe(14);
    expect(parseFontSizePx("bold 32px Georgia")).toBe(32);
    expect(parseFontSizePx("13.5px monospace")).toBe(13.5);
  });

  it("is null when the shorthand names no size", () => {
    expect(parseFontSizePx("bold Georgia")).toBeNull();
  });
});

describe("resolveActiveFontSize", () => {
  it("falls back to the size a default paragraph is drawn at", () => {
    expect(resolveActiveFontSize(undefined, style("bold Georgia"))).toBe(DEFAULT_FONT_SIZE_PX);
    expect(DEFAULT_FONT_SIZE_PX).toBeGreaterThan(0);
  });

  it("prefers the size an inline mark states", () => {
    expect(resolveActiveFontSize(18, getBlockStyle(CONFIG, "paragraph"))).toBe(18);
  });

  it("falls back to the block style, which is what the run actually renders at", () => {
    expect(resolveActiveFontSize(undefined, getBlockStyle(CONFIG, "paragraph"))).toBe(14);
    expect(resolveActiveFontSize(undefined, getBlockStyle(CONFIG, "codeBlock"))).toBe(13);
  });

  it("distinguishes heading levels, because the block style does", () => {
    expect(resolveActiveFontSize(undefined, getBlockStyle(CONFIG, "heading", 1))).toBe(32);
    expect(resolveActiveFontSize(undefined, getBlockStyle(CONFIG, "heading", 2))).toBe(24);
  });

  it("answers with a number even when the style names no size", () => {
    expect(resolveActiveFontSize(undefined, style("bold Georgia"))).toBeGreaterThan(0);
  });
});

describe("Editor.getActiveFontFamily", () => {
  const familyOver = (editor: ReturnType<typeof createTestEditor>, from: number, to: number) => {
    const state = editor.getState();
    editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
    return editor.getActiveFontFamily();
  };

  const twoFamilies = () =>
    createTestEditor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [
            { type: "text", text: "one", marks: [{ type: "fontFamily", attrs: { family: "Georgia" } }] },
            { type: "text", text: " two", marks: [{ type: "fontFamily", attrs: { family: "Arial" } }] },
          ],
        }],
      },
    });

  it("reports mixed when the selection spans more than one family", () => {
    const editor = twoFamilies();

    expect(familyOver(editor, 1, 4).mixed).toBe(false);
    expect(familyOver(editor, 4, 8).mixed).toBe(false);
    expect(familyOver(editor, 1, 8).mixed).toBe(true);
  });

  it("still names a family when mixed, so a reader of the old fields is unchanged", () => {
    // Additive: `requested`/`resolved` keep answering as they always did, so a
    // consumer that does not know about `mixed` behaves exactly as before.
    const mixedSelection = familyOver(twoFamilies(), 1, 8);

    expect(mixedSelection.requested.length).toBeGreaterThan(0);
    expect(mixedSelection.resolved.length).toBeGreaterThan(0);
  });
});

describe("Editor.getActiveFontSize", () => {
  const editorWith = (content: Record<string, unknown>) =>
    createTestEditor({ extensions: [StarterKit], content });

  const over = (editor: ReturnType<typeof createTestEditor>, from: number, to: number) => {
    const state = editor.getState();
    editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
    return editor.getActiveFontSize();
  };

  const at = (editor: ReturnType<typeof createTestEditor>, pos: number) => {
    const state = editor.getState();
    editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    return editor.getActiveFontSize();
  };

  it("reads the block style where the run carries no mark", () => {
    const editor = editorWith({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
      ],
    });

    const heading = at(editor, 3)!;
    const body = at(editor, editor.getState().doc.child(0).nodeSize + 3)!;

    // Both are real sizes, and a heading is larger than its body — which is the
    // thing a caller reading the mark alone could not see at all.
    expect(heading).toBeGreaterThan(0);
    expect(body).toBeGreaterThan(0);
    expect(heading).toBeGreaterThan(body);
  });

  it("styles a heading by its own block, not by whatever contains it", () => {
    const editor = createTestEditor({
      extensions: [StarterKit, Table],
      content: {
        type: "doc",
        content: [{
          type: "table",
          content: [{
            type: "tableRow",
            content: [{
              type: "tableCell",
              content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Cell" }] }],
            }],
          }],
        }],
      },
    });

    const inCell = at(editor, 5);
    const plain = editorWith({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }],
    });
    // A heading is a heading wherever it sits; the table has no style of its own
    // and would otherwise answer with the paragraph's.
    expect(inCell).not.toBeNull();
    expect(inCell!).toBeGreaterThan(at(plain, 3)!);
  });

  it("says nothing when the selection spans more than one size", () => {
    const editor = editorWith({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: "big", marks: [{ type: "fontSize", attrs: { size: 24 } }] },
          { type: "text", text: " plain" },
        ],
      }],
    });

    // Each run on its own reports its own size.
    expect(over(editor, 1, 4)).toBe(24);
    const plainRun = over(editor, 4, 10);
    expect(plainRun).not.toBeNull();
    expect(plainRun!).toBeGreaterThan(0);
    // Across both there is no single answer, and naming one of them invites the
    // reader to confirm it and resize the other.
    expect(over(editor, 1, 10)).toBeNull();
  });

  it("answers when every run in the selection agrees", () => {
    const editor = editorWith({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: "one", marks: [{ type: "fontSize", attrs: { size: 20 } }] },
          { type: "text", text: " two", marks: [{ type: "fontSize", attrs: { size: 20 } }] },
        ],
      }],
    });

    expect(over(editor, 1, 8)).toBe(20);
  });

  it("says nothing across blocks whose styles differ", () => {
    const editor = editorWith({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
      ],
    });

    expect(over(editor, 1, 12)).toBeNull();
  });

  it("prefers a size the run's own mark states", () => {
    const editor = editorWith({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "sized", marks: [{ type: "fontSize", attrs: { size: 27 } }] }],
      }],
    });

    expect(at(editor, 3)).toBe(27);
  });
});
