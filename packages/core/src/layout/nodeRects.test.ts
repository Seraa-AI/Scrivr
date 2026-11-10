import { describe, it, expect } from "vitest";
import { createTestEditor } from "../test-utils";
import { StarterKit } from "../extensions/StarterKit";
import { DefaultContent } from "../extensions/built-in/DefaultContent";
import { defaultPageConfig } from "./PageLayout";
import { nodeFragmentRects } from "./nodeRects";
import type { Editor } from "../Editor";

/**
 * Node geometry for popovers (`nodeFragmentRects`) and strict glyph lookup for
 * hover (`glyphAtPoint`), against real layout.
 */

function paragraphs(n: number, text: string) {
  return Array.from({ length: n }, () => ({ type: "paragraph", content: [{ type: "text", text }] }));
}

/** `inFirstCell` is appended to the first cell's content — a nested table, say. */
function table(rows: number, inFirstCell: unknown[] = []): unknown {
  return {
    type: "table",
    attrs: { layout: "fixed", grid: [150, 150] },
    content: Array.from({ length: rows }, (_, r) => ({
      type: "tableRow",
      content: [0, 1].map((c) => ({
        type: "tableCell",
        content: [
          { type: "paragraph", content: [{ type: "text", text: `r${r}c${c}` }] },
          ...(r === 0 && c === 0 ? inFirstCell : []),
        ],
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

function rectsOf(editor: Editor, docPos: number) {
  return nodeFragmentRects(editor.layout.pages, editor.getState().doc, docPos);
}

describe("nodeFragmentRects", () => {
  it("returns one rect for a paragraph on one page", () => {
    const editor = makeEditor([...paragraphs(1, "hello"), table(2)]);
    const rects = rectsOf(editor, nodePos(editor, "paragraph"));
    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({ page: 1, x: defaultPageConfig.margins.left });
    expect(rects[0]!.height).toBeGreaterThan(0);
  });

  it("unions a table's rows into one rect per page", () => {
    const editor = makeEditor([...paragraphs(1, "before"), table(3)]);
    const tablePos = nodePos(editor, "table");
    const rects = rectsOf(editor, tablePos);
    expect(rects).toHaveLength(1);

    const rows = editor.layout.pages[0]!.blocks.filter((b) => b.kind === "composite");
    expect(rows).toHaveLength(3);
    expect(rects[0]!.y).toBe(rows[0]!.y);
    expect(rects[0]!.y + rects[0]!.height).toBe(rows[2]!.y + rows[2]!.height);
  });

  it("returns a cell's own rect, inside its table's", () => {
    const editor = makeEditor([table(2)]);
    const [tableRect] = rectsOf(editor, nodePos(editor, "table"));
    const first = rectsOf(editor, nodePos(editor, "tableCell", 0))[0]!;
    const second = rectsOf(editor, nodePos(editor, "tableCell", 1))[0]!;
    expect(second.x).toBeGreaterThan(first.x);
    expect(first.y).toBe(second.y);
    expect(first.x).toBeGreaterThanOrEqual(tableRect!.x);
    expect(first.y).toBeGreaterThanOrEqual(tableRect!.y);
  });

  it("returns one rect per page for a table split across pages", () => {
    const editor = makeEditor([...paragraphs(1, "x"), table(80)]);
    const pages = rectsOf(editor, nodePos(editor, "table")).map((r) => r.page);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages).toEqual([...new Set(pages)].sort((a, b) => a - b));
  });

  it("finds a table nested in another table's cell, inside that cell", () => {
    const editor = makeEditor([table(1, [table(2)])]);
    const cell = rectsOf(editor, nodePos(editor, "tableCell", 0))[0]!;
    const inner = rectsOf(editor, nodePos(editor, "table", 1));
    expect(inner).toHaveLength(1);
    expect(inner[0]!.x).toBeGreaterThanOrEqual(cell.x);
    expect(inner[0]!.y).toBeGreaterThan(cell.y);
    expect(inner[0]!.y + inner[0]!.height).toBeLessThanOrEqual(cell.y + cell.height);
  });

  it("is empty for a position that is not a node", () => {
    const editor = makeEditor(paragraphs(1, "x"));
    expect(rectsOf(editor, 10_000)).toEqual([]);
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
    const cell = rectsOf(editor, nodePos(editor, "tableCell"))[0]!;
    expect(editor.charMap.glyphAtPoint(cell.x + 1, cell.y + 1, 1)).toBeNull();
  });
});

describe("CharacterMap.rangeRects", () => {
  // "one" ⏎ "two", all linked; the break makes two lines on every machine.
  const linked = (text: string) => ({ type: "text", text, marks: [{ type: "link", attrs: { href: "https://x.test" } }] });
  const twoLines = [{ type: "paragraph", content: [linked("one"), { type: "hardBreak", marks: [{ type: "link", attrs: { href: "https://x.test" } }] }, linked("two")] }];

  it("returns one rect per line a range covers, each spanning only its glyphs", () => {
    const editor = makeEditor(twoLines);
    const [first, second] = editor.charMap.rangeRects(1, 8);
    const o = editor.charMap.coordsAtPos(1)!;
    const t = editor.charMap.coordsAtPos(5)!;
    expect(first).toMatchObject({ page: 1, x: o.x });
    expect(second).toMatchObject({ page: 1, x: t.x });
    expect(second!.y).toBeGreaterThan(first!.y);
    expect(first!.width).toBeGreaterThan(0);
  });

  it("returns nothing for a range with no painted glyph", () => {
    expect(makeEditor(twoLines).charMap.rangeRects(500, 600)).toEqual([]);
  });
});

describe("CharacterMap.rangeRects over an object", () => {
  it("gives a floating image its own box, as it has no glyph of any width", () => {
    const editor = makeEditor([{
      type: "paragraph",
      content: [
        { type: "text", text: "text" },
        { type: "image", attrs: { src: "x.png", width: 80, height: 60, wrapMode: "square" } },
      ],
    }]);
    const rect = editor.getNodeRect(5);
    if (!rect) throw new Error("no image rect");
    expect(editor.charMap.rangeRects(5, 6)).toEqual([
      { page: rect.page, x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    ]);
  });
});
