import { describe, it, expect } from "vitest";
import { createTestEditor } from "../test-utils";
import { StarterKit } from "../extensions/StarterKit";
import { DefaultContent } from "../extensions/built-in/DefaultContent";
import { defaultPageConfig } from "./PageLayout";
import type { Editor } from "../Editor";

/**
 * Node geometry for popovers (`getNodeRects`) and strict glyph lookup for
 * hover (`glyphAtPoint`), against real layout.
 */

function paragraphs(n: number, text: string) {
  return Array.from({ length: n }, () => ({ type: "paragraph", content: [{ type: "text", text }] }));
}

function table(rows: number) {
  return {
    type: "table",
    attrs: { layout: "fixed", grid: [150, 150] },
    content: Array.from({ length: rows }, (_, r) => ({
      type: "tableRow",
      content: [0, 1].map((c) => ({
        type: "tableCell",
        content: [{ type: "paragraph", content: [{ type: "text", text: `r${r}c${c}` }] }],
      })),
    })),
  };
}

function makeEditor(content: unknown[]): Editor {
  const editor = createTestEditor({
    pageConfig: defaultPageConfig,
    extensions: [StarterKit.configure({ table: true }), DefaultContent.configure({ json: { type: "doc", content } })],
  });
  editor.ensurePagePopulated(1);
  return editor;
}

function nodePos(editor: Editor, name: string, nth = 0): number {
  const found: number[] = [];
  editor.getState().doc.descendants((n, p) => {
    if (n.type.name === name) found.push(p);
  });
  return found[nth]!;
}

describe("Editor.getNodeRects", () => {
  it("returns one rect for a paragraph on one page", () => {
    const editor = makeEditor([...paragraphs(1, "hello"), table(2)]);
    const rects = editor.getNodeRects(nodePos(editor, "paragraph"));
    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({ page: 1, x: defaultPageConfig.margins.left });
    expect(rects[0]!.height).toBeGreaterThan(0);
  });

  it("unions a table's rows into one rect per page", () => {
    const editor = makeEditor([...paragraphs(1, "before"), table(3)]);
    const tablePos = nodePos(editor, "table");
    const rects = editor.getNodeRects(tablePos);
    expect(rects).toHaveLength(1);

    const rows = editor.layout.pages[0]!.blocks.filter((b) => b.kind === "tableRow");
    expect(rows).toHaveLength(3);
    expect(rects[0]!.y).toBe(rows[0]!.y);
    expect(rects[0]!.y + rects[0]!.height).toBe(rows[2]!.y + rows[2]!.height);
  });

  it("returns a cell's own rect, inside its table's", () => {
    const editor = makeEditor([table(2)]);
    const [tableRect] = editor.getNodeRects(nodePos(editor, "table"));
    const first = editor.getNodeRects(nodePos(editor, "tableCell", 0))[0]!;
    const second = editor.getNodeRects(nodePos(editor, "tableCell", 1))[0]!;
    expect(second.x).toBeGreaterThan(first.x);
    expect(first.y).toBe(second.y);
    expect(first.x).toBeGreaterThanOrEqual(tableRect!.x);
    expect(first.y).toBeGreaterThanOrEqual(tableRect!.y);
  });

  it("returns one rect per page for a table split across pages", () => {
    const editor = makeEditor([...paragraphs(1, "x"), table(80)]);
    const pages = editor.getNodeRects(nodePos(editor, "table")).map((r) => r.page);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages).toEqual([...new Set(pages)].sort((a, b) => a - b));
  });

  it("is empty for a position that is not a node", () => {
    const editor = makeEditor(paragraphs(1, "x"));
    expect(editor.getNodeRects(10_000)).toEqual([]);
  });
});

describe("CharacterMap.glyphAtPoint", () => {
  it("returns the glyph under the point and null past the line's end", () => {
    const editor = makeEditor(paragraphs(1, "hello"));
    const h = editor.charMap.coordsAtPos(1)!;
    const e = editor.charMap.coordsAtPos(2)!;
    const mid = h.y + h.height / 2;

    expect(editor.charMap.glyphAtPoint((h.x + e.x) / 2, mid, 1)?.docPos).toBe(1);
    const end = editor.charMap.coordsAtPos(6)!;
    expect(editor.charMap.glyphAtPoint(end.x + 50, mid, 1)).toBeNull();
    // posAtCoords still snaps to the line end there.
    expect(editor.charMap.posAtCoords(end.x + 50, mid, 1)).toBe(6);
  });

  it("returns null in the left margin beside text", () => {
    const editor = makeEditor(paragraphs(1, "hello"));
    const h = editor.charMap.coordsAtPos(1)!;
    expect(editor.charMap.glyphAtPoint(h.x - 20, h.y + h.height / 2, 1)).toBeNull();
  });

  it("returns null in a cell's padding", () => {
    const editor = makeEditor([table(1)]);
    const cell = editor.getNodeRects(nodePos(editor, "tableCell"))[0]!;
    expect(editor.charMap.glyphAtPoint(cell.x + 1, cell.y + 1, 1)).toBeNull();
  });
});
