/**
 * The toolbar shows the block the caret is in, as Word's ribbon does: the
 * list the caret's paragraph belongs to (the innermost one when lists nest),
 * and the paragraph's own style and alignment — at the top level, in a list
 * or in a table cell.
 */
import { afterEach, describe, expect, it } from "vitest";
import { StarterKit } from "../StarterKit";
import { createTestEditor } from "../../test-utils";
import type { Editor } from "../../Editor";

type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string };
const p = (text: string): Json => ({ type: "paragraph", content: [{ type: "text", text }] });
const item = (...content: Json[]): Json => ({ type: "listItem", content });
const bullets = (...items: Json[]): Json => ({ type: "bulletList", content: items });
const numbers = (...items: Json[]): Json => ({ type: "orderedList", content: items });
const cell = (...content: Json[]): Json => ({ type: "tableCell", content });
const table = (...cells: Json[]): Json => ({
  type: "table",
  attrs: { grid: cells.map(() => 200) },
  content: [{ type: "tableRow", content: cells }],
});

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** The pressed toolbar buttons with the caret in the text `at`. */
function pressedAt(content: Json[], at: string): string[] {
  editor = createTestEditor({
    extensions: [StarterKit.configure({ table: true })],
    content: { type: "doc", content },
  });
  let caret = -1;
  editor.getState().doc.descendants((node, pos) => {
    if (caret < 0 && node.isText && node.text === at) caret = pos + 1;
  });
  if (caret < 0) throw new Error(`no text "${at}"`);
  editor.selection.setSelection(caret, caret);
  const state = editor.getSelectionSnapshot();
  return editor.toolbarItems
    .filter((spec) => spec.group === "list" || spec.group === "heading" || spec.group === "align")
    .filter((spec) => spec.isActive(state))
    .map((spec) => spec.command);
}

describe("list buttons", () => {
  it("show the list a top-level paragraph is in", () => {
    expect(pressedAt([numbers(item(p("one")))], "one")).toContain("toggleOrderedList");
  });

  it("show the innermost list when a numbered list nests in a bulleted one", () => {
    const pressed = pressedAt([bullets(item(p("outer"), numbers(item(p("inner")))))], "inner");
    expect(pressed).toContain("toggleOrderedList");
    expect(pressed).not.toContain("toggleBulletList");
  });

  it("show the innermost list when a bulleted list nests in a numbered one", () => {
    const pressed = pressedAt([numbers(item(p("outer"), bullets(item(p("inner")))))], "inner");
    expect(pressed).toContain("toggleBulletList");
    expect(pressed).not.toContain("toggleOrderedList");
  });

  it("show the outer list on the outer item's own paragraph", () => {
    const pressed = pressedAt([bullets(item(p("outer"), numbers(item(p("inner")))))], "outer");
    expect(pressed).toContain("toggleBulletList");
    expect(pressed).not.toContain("toggleOrderedList");
  });

  it("show a list in a table cell", () => {
    expect(pressedAt([table(cell(bullets(item(p("in cell")))))], "in cell")).toContain("toggleBulletList");
  });

  it("show nothing for a cell paragraph of a table inside a list item", () => {
    const pressed = pressedAt([bullets(item(p("lead"), table(cell(p("cell text")))))], "cell text");
    expect(pressed).not.toContain("toggleBulletList");
  });

  it("show nothing for a plain paragraph in a table cell", () => {
    const pressed = pressedAt([table(cell(p("plain")))], "plain");
    expect(pressed).not.toContain("toggleBulletList");
    expect(pressed).not.toContain("toggleOrderedList");
  });
});

describe("paragraph buttons", () => {
  it("show a heading in a table cell", () => {
    const h2: Json = { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "title" }] };
    expect(pressedAt([table(cell(h2))], "title")).toContain("setHeading2");
  });

  it("show a centred paragraph in a table cell", () => {
    const centred: Json = { type: "paragraph", attrs: { align: "center" }, content: [{ type: "text", text: "mid" }] };
    expect(pressedAt([table(cell(centred))], "mid")).toContain("setAlignCenter");
  });

  it("show a centred paragraph in a list", () => {
    const centred: Json = { type: "paragraph", attrs: { align: "center" }, content: [{ type: "text", text: "mid" }] };
    const pressed = pressedAt([bullets(item(centred))], "mid");
    expect(pressed).toContain("setAlignCenter");
    expect(pressed).not.toContain("setAlignLeft");
  });
});
