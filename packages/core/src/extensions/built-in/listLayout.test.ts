import { describe, expect, it, vi } from "vitest";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { runPipeline, defaultPageConfig, type MeasureCacheEntry } from "../../layout/PageLayout";
import { layoutBlock, type BlockLayoutOptions, type LayoutBlock } from "../../layout/BlockLayout";
import type { LayoutLine } from "../../layout/LineBreaker";
import { rangeBandRects } from "../../selection/behaviors";
import { markerAnchorOf } from "../../layout/markers";
import { listMarker } from "./listLevels";
import { CharacterMap } from "../../layout/CharacterMap";
import { defaultEditorTheme, type ResolvedTheme } from "../../model/theme";
import { renderPage } from "../../renderer/PageRenderer";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../StarterKit";
import { Table } from "./Table";
import { ExtensionManager } from "../ExtensionManager";
import { Extension } from "../Extension";
import { nodeLayout } from "../../layout/BlockRegistry";
import { CELL_PADDING_H } from "../../layout/TableLayoutEngine";
import { ANCHORED_OBJECT_MARGIN } from "../../layout/AnchoredObjects";
import { buildStarterKitContext, createMeasurer, createTestEditor, measureTextWidth } from "../../test-utils";
import { listWrap } from "../../index";

/** Draws a block's marker with the painter registered for it, as `paintBlock` does. */
function drawMarker(ctx: CanvasRenderingContext2D, block: LayoutBlock, theme: ResolvedTheme): void {
  const marker = markerAnchorOf(block);
  if (marker) new ExtensionManager([StarterKit]).getMarkerPainters().get(marker.painter)?.canvas(ctx, marker, theme);
}

/**
 * How lists lay out. Geometry follows Word's built-in lists: each level's text
 * sits half an inch past the one above, and the marker hangs a quarter inch
 * before the text, left-aligned.
 */

const HALF_INCH = 48;
const QUARTER_INCH = 24;
const { schema, fontConfig } = buildStarterKitContext();

type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string; marks?: Json[] };
const p = (text: string): Json => ({ type: "paragraph", content: [{ type: "text", text }] });
const sized = (size: number, text: string): Json =>
  ({ type: "paragraph", content: [{ type: "text", text, marks: [{ type: "fontSize", attrs: { size } }] }] });
const li = (...content: Json[]): Json => ({ type: "listItem", content });
const ul = (...items: Json[]): Json => ({ type: "bulletList", content: items });
const ol = (...items: Json[]): Json => ({ type: "orderedList", content: items });
const olFrom = (order: number, ...items: Json[]): Json => ({ type: "orderedList", attrs: { order }, content: items });
const item = (text: string, ...nested: Json[]) => li(p(text), ...nested);
const floating: Json = {
  type: "paragraph",
  content: [{ type: "image", attrs: { src: "data:image/png;base64,AA==", width: 40, height: 40, wrapMode: "square" } }],
};

function laidOut(content: Json[] | Node, pageConfig = defaultPageConfig): LayoutBlock[] {
  const docNode = Array.isArray(content) ? schema.nodeFromJSON({ type: "doc", content }) : content;
  return runPipeline(docNode, { pageConfig, measurer: createMeasurer(), fontConfig })
    .pages.flatMap((page) => page.blocks);
}

function blockOf(blocks: LayoutBlock[], text: string): LayoutBlock {
  const found = blocks.find((block) => block.node.textContent === text);
  if (!found) throw new Error(`"${text}" was not laid out`);
  return found;
}

const markers = (blocks: LayoutBlock[]) => blocks.map((block) => block.marker?.data ?? null);
/** The bullet or number a block carries, as text; "" for none. */
const markerText = (block: LayoutBlock): string => (typeof block.marker?.data === "string" ? block.marker.data : "");
/** The font of the block's first text, on whichever line it starts. */
const fontOf = (block: LayoutBlock) => {
  const span = block.lines.flatMap((line) => line.spans).find((candidate) => candidate.kind === "text");
  return span?.kind === "text" ? span.font : "";
};
/** Where the first line's text starts, measured from the block's text edge. */
const firstLineStart = (block: LayoutBlock) => block.lines[0]?.spans[0]?.x ?? 0;

/** A server editor that can press the editor's own key bindings. */
class KeyEditor extends ServerEditor {
  press(name: string): boolean {
    const command = this.manager.buildKeymap()[name];
    if (!command) throw new Error(`no binding for ${name}`);
    return command(this.getState(), (tr) => this.applyTransaction(tr));
  }
  caretAt(text: string) {
    let at = -1;
    this.getState().doc.descendants((node, pos) => {
      if (at < 0 && node.isTextblock && node.textContent === text) at = pos + 1;
      return at < 0;
    });
    if (at < 0) throw new Error(`no "${text}"`);
    this.applyTransaction(this.getState().tr.setSelection(TextSelection.create(this.getState().doc, at)));
  }
}

describe("list geometry (Word's built-in lists)", () => {
  it("puts top-level text half an inch in, with the marker a quarter inch before it", () => {
    const one = blockOf(laidOut([ul(item("one"))]), "one");
    expect(one.x).toBe(defaultPageConfig.margins.left + HALF_INCH);
    expect(one.marker?.x).toBe(one.x - QUARTER_INCH);
  });

  it("left-aligns ordered markers at the same hanging position", () => {
    const blocks = laidOut([ol(item("one"), item("two"))]);
    const [one, two] = [blockOf(blocks, "one"), blockOf(blocks, "two")];
    expect(one.marker?.x).toBe(one.x - QUARTER_INCH);
    expect(two.marker?.x).toBe(one.marker?.x);
  });

  it("indents each level half an inch past the one above", () => {
    const blocks = laidOut([ul(item("a", ul(item("b", ul(item("c"))))))]);
    const [a, b, c] = [blockOf(blocks, "a"), blockOf(blocks, "b"), blockOf(blocks, "c")];
    expect(b.x - a.x).toBe(HALF_INCH);
    expect(c.x - b.x).toBe(HALF_INCH);
    expect(c.marker?.x).toBe(c.x - QUARTER_INCH);
  });

  it("narrows the text by its indent", () => {
    const a = blockOf(laidOut([ul(item("a"))]), "a");
    const contentWidth = defaultPageConfig.pageWidth - defaultPageConfig.margins.left - defaultPageConfig.margins.right;
    expect(a.availableWidth).toBe(contentWidth - HALF_INCH);
  });

  it("stops at the ninth level", () => {
    let nested: Json = item("deepest");
    for (let depth = 0; depth < 10; depth++) nested = item(`d${depth}`, ul(nested));
    const blocks = laidOut([ul(nested)]);
    expect(blockOf(blocks, "deepest").x).toBe(blockOf(blocks, "d1").x);
  });
});

describe("a number too wide for its hanging indent (the text follows it after a space)", () => {
  /**
   * A list item whose number, measured in the item's own font, is `minWidth`
   * to `maxWidth` wide — found by measuring, not assumed, so the test asks the
   * same question on any machine's fonts. Searches font sizes and numbers at
   * the top level (decimal) and the third (roman).
   */
  function itemWithNumberWidth(minWidth: number, maxWidth: number): LayoutBlock {
    for (let size = 10; size <= 40; size++) {
      const probe = blockOf(laidOut([ol(li(sized(size, "probe")))]), "probe");
      for (const depth of [0, 2]) {
        for (let n = 1; n <= 200; n++) {
          const width = measureTextWidth(listMarker("ordered", depth, n), fontOf(probe));
          if (width < minWidth || width >= maxWidth) continue;
          const numbered = olFrom(n, li(sized(size, "measured")));
          const content = depth === 0 ? [numbered] : [ol(item("a", ol(item("b", numbered))))];
          return blockOf(laidOut(content), "measured");
        }
      }
    }
    throw new Error(`no number measures ${minWidth}–${maxWidth}px at any size`);
  }

  it("keeps the text in place when the number nearly reaches it", () => {
    expect(firstLineStart(itemWithNumberWidth(QUARTER_INCH - 4, QUARTER_INCH))).toBe(0);
  });

  it("moves the text when the number reaches it", () => {
    expect(firstLineStart(itemWithNumberWidth(QUARTER_INCH, QUARTER_INCH + 4))).toBeGreaterThan(0);
  });

  it("keeps every number in the column, however wide", () => {
    const items = Array.from({ length: 12 }, (_, i) => li(sized(18, `n${i}`)));
    const blocks = laidOut([ol(...items)]);
    const xs = new Set(blocks.map((block) => block.marker?.x));
    expect([...xs]).toEqual([(blocks[0]?.x ?? 0) - QUARTER_INCH]);
  });

  it("moves the first line past a wide number beside a float too", () => {
    const text = "wide ".repeat(40).trim();
    const float: Json = {
      type: "paragraph",
      content: [
        { type: "image", attrs: { src: "data:image/png;base64,AA==", width: 100, height: 200, wrapMode: "square", xAlign: "right" } },
        { type: "text", text: "anchor" },
      ],
    };
    const wide = blockOf(laidOut([float, olFrom(100, item(text))]), text);
    const numberEnd = (wide.marker?.x ?? 0) + measureTextWidth("100.", fontOf(wide));
    expect(wide.x + firstLineStart(wide)).toBeGreaterThan(numberEnd);
  });

  it("starts the first line a space after a wide number, and only the first line", () => {
    const text = "wide ".repeat(60).trim();
    const wide = blockOf(laidOut([olFrom(1000, item(text))]), text);
    const firstTextX = wide.x + firstLineStart(wide);
    const numberEnd = (wide.marker?.x ?? 0) + measureTextWidth("1000.", fontOf(wide));
    expect(firstTextX - numberEnd).toBeCloseTo(measureTextWidth(" ", fontOf(wide)), 0);
    for (const line of wide.lines.slice(1)) expect(line.spans[0]?.x).toBe(0);
  });

  it("counts a paragraph's own first-line indent once", () => {
    const indented: Json = {
      type: "paragraph",
      attrs: { textIndent: HALF_INCH },
      content: [{ type: "text", text: "indented", marks: [{ type: "fontSize", attrs: { size: 18 } }] }],
    };
    const block = blockOf(laidOut([olFrom(10, li(indented))]), "indented");
    expect(firstLineStart(block)).toBe(HALF_INCH);
  });

  /** Where the first line's text starts, and where the number ends, both on the page. */
  const textAndNumber = (block: LayoutBlock) => ({
    textStart: block.x + firstLineStart(block),
    numberEnd: (block.marker?.x ?? 0) + measureTextWidth(markerText(block), fontOf(block)),
  });

  it("never starts the text over a number that runs past the line", () => {
    const text = "letter item with words to wrap";
    const block = blockOf(laidOut([ol(item("top", olFrom(32767, item(text))))]), text);
    const { numberEnd } = textAndNumber(block);
    const overNumber = (block.lines[0]?.spans ?? []).filter((span) => span.kind === "text" && block.x + span.x <= numberEnd);
    expect(overNumber).toEqual([]);
  });

  it("follows the number with a space nine levels deep on a narrow page", () => {
    // The text is held an inch wide here. The number is chosen by measuring,
    // so that it reaches the text and still leaves room for the first word
    // after it, on any fonts.
    const narrow = { ...defaultPageConfig, pageWidth: 559 };
    const deep = (order: number): Json[] => {
      let nested: Json = olFrom(order, item("deep text"));
      for (let depth = 0; depth < 8; depth++) nested = ol(item(`L${depth}`, nested));
      return [nested];
    };
    const probe = blockOf(laidOut(deep(1), narrow), "deep text");
    const indent = probe.x - narrow.margins.left;
    const lineEnd = indent + probe.availableWidth;
    const roman = (n: number) => listMarker("ordered", 8, n);
    const fitting = Array.from({ length: 3999 }, (_, i) => i + 1).find((n) => {
      const end = indent - QUARTER_INCH + measureTextWidth(roman(n), fontOf(probe));
      return end >= indent && end + measureTextWidth(" deep", fontOf(probe)) < lineEnd;
    });
    if (fitting === undefined) throw new Error("no roman number reaches the text and leaves room for its first word");

    const block = blockOf(laidOut(deep(fitting), narrow), "deep text");
    const { textStart, numberEnd } = textAndNumber(block);
    expect(textStart).toBeGreaterThan(numberEnd);
    expect(textStart - numberEnd).toBeLessThan(QUARTER_INCH);
  });
});

describe("a first word that does not fit after its number (Word leaves the number alone on its line)", () => {
  const textOf = (line: LayoutLine | undefined) =>
    (line?.spans ?? []).map((span) => (span.kind === "text" ? span.text : "")).join("");
  const measured = (node: Node, availableWidth: number, options: Partial<BlockLayoutOptions> = {}) =>
    layoutBlock(node, { nodePos: 0, x: 0, y: 0, page: 1, availableWidth, measurer: createMeasurer(), fontConfig, ...options });
  const paragraph = (text: string, attrs?: Record<string, unknown>) =>
    schema.nodeFromJSON({ type: "paragraph", ...(attrs ? { attrs } : {}), content: [{ type: "text", text }] });
  /** How far a wide number pushes the first line, as `layoutBlockWithMarker` passes it. */
  const NUMBER_PUSH = 50;
  const WORD = "alphabetical";
  const wordWidth = () => measureTextWidth(WORD, fontOf(measured(paragraph(WORD), 500)));
  /** Too narrow for the word after the number, wide enough for it on a line of its own. */
  const narrow = () => wordWidth() + NUMBER_PUSH / 2;

  it("starts the next line, below a full-width float there", () => {
    const floatBottom = 100;
    const width = narrow();
    const block = measured(paragraph(`${WORD} more`), width, {
      marker: { offset: NUMBER_PUSH },
      lineSpaceProvider: (y) => (y > 0 && y < floatBottom ? { segments: [], skipToY: floatBottom } : { segments: [{ x: 0, width }] }),
    });
    expect(block.lines.map(textOf).join("")).toBe(`${WORD} more`);
    const wordLine = block.lines.findIndex((line) => textOf(line).startsWith(WORD));
    const wordTop = block.lines.slice(0, wordLine).reduce((sum, line) => sum + line.lineHeight, 0);
    expect(wordTop).toBeGreaterThanOrEqual(floatBottom);
  });

  it("is a list rule: a plain first-line indent keeps its first word on its line", () => {
    const block = measured(paragraph(`${WORD} more`, { textIndent: NUMBER_PUSH }), narrow());
    expect(textOf(block.lines[0]).startsWith(WORD)).toBe(true);
  });

  it("stays after the number when the next line has no more room for it", () => {
    const image = { type: "image", attrs: { src: "data:image/png;base64,AA==", width: 300, height: 20 } };
    const wide = schema.nodeFromJSON({ type: "paragraph", content: [image, { type: "text", text: " after" }] });
    const block = measured(wide, 200, { marker: { offset: NUMBER_PUSH } });
    expect(block.lines[0]?.spans[0]?.kind).toBe("object");
  });

  it("stays after the number when only its trailing space does not fit, which may hang", () => {
    const block = measured(paragraph(`${WORD} more`), NUMBER_PUSH + wordWidth() + 0.5, { marker: { offset: NUMBER_PUSH } });
    expect(textOf(block.lines[0]).startsWith(WORD)).toBe(true);
  });

  it("gives the number's line the text's baseline when the item opens with a floating image", () => {
    const anchored = schema.nodeFromJSON({ type: "paragraph", content: [
      { type: "image", attrs: { src: "data:image/png;base64,AA==", width: 40, height: 40, wrapMode: "square" } },
      { type: "text", text: WORD },
    ] });
    const block = measured(anchored, narrow(), { marker: { offset: NUMBER_PUSH } });
    const wordLine = block.lines.find((line) => textOf(line).startsWith(WORD));
    expect(wordLine).not.toBe(block.lines[0]);
    expect(block.lines[0]?.ascent).toBe(wordLine?.ascent);
  });

  /**
   * An item numbered 32767 whose first word fits a whole line but not the
   * rest of its number's line — found by measuring, so on any machine's fonts.
   */
  function numberAloneText(): string {
    for (let length = 20; length <= 120; length++) {
      const text = `${"w".repeat(length)} tail`;
      if (textOf(blockOf(laidOut([olFrom(32767, item(text))]), text).lines[1]).startsWith("w".repeat(length))) return text;
    }
    throw new Error("no word fills a line but not the rest of its number's");
  }
  const numberAloneDoc = (text: string) => schema.nodeFromJSON({ type: "doc", content: [p("before"), olFrom(32767, item(text)), p("after")] });

  /** The item, its first text position, and its number's line, from a real editor's hit-test map. */
  function numberAloneEditor() {
    const text = numberAloneText();
    const editor = createTestEditor({ content: numberAloneDoc(text).toJSON() });
    editor.ensurePagePopulated(1);
    const block = blockOf(editor.layout.pages.flatMap((page) => page.blocks), text);
    const numberLine = { top: block.y, bottom: block.y + (block.lines[0]?.lineHeight ?? 0) };
    return { editor, map: editor.charMap, block, start: block.nodePos + 1, numberLine };
  }

  it("puts the caret before the word on the word's line, and Home and End keep to it", () => {
    const { editor, map, start } = numberAloneEditor();
    const before = map.coordsAtPos(start);
    const after = map.coordsAtPos(start + 1);
    expect(before?.y).toBe(after?.y);
    expect(before?.x).toBeLessThan(after?.x ?? 0);
    expect(map.lineStartPos(start + 3)).toBe(start);
    expect(map.lineEndPos(start)).toBe(map.lineEndPos(start + 3));
    editor.destroy();
  });

  it("puts the caret before the word for a click on the number's line", () => {
    const { editor, map, block, start, numberLine } = numberAloneEditor();
    expect(map.posAtCoords(block.x + 20, (numberLine.top + numberLine.bottom) / 2, 1)).toBe(start);
    editor.destroy();
  });

  it("paints no selection on the number's line for a selection inside the word", () => {
    const { editor, map, start, numberLine } = numberAloneEditor();
    const rects = rangeBandRects(start, start + 3, map.glyphsInRange(start, start + 3), map.linesInRange(start, start + 3));
    expect(rects.length).toBeGreaterThan(0);
    expect(rects.filter((rect) => rect.y < numberLine.bottom && rect.y + rect.height > numberLine.top)).toEqual([]);
    editor.destroy();
  });

  it("moves Up from the word's line out of the item, and Down from above onto the word", () => {
    const { editor, map, start } = numberAloneEditor();
    const x = map.coordsAtPos(start + 3)?.x ?? 0;
    expect(map.posAbove(start + 3, x)).toBeLessThan(start);
    expect(map.posBelow(2, x)).toBeGreaterThanOrEqual(start);
    editor.destroy();
  });

  it("moves Up past a number left alone at the bottom of a page, onto the line above it", () => {
    const text = numberAloneText();
    // Fill page 1 until the number's line is its last line and the word starts page 2.
    for (let fillers = 1; fillers < 80; fillers++) {
      const content = [...Array.from({ length: fillers }, (_, i) => p(`Filler ${i}`)), olFrom(32767, item(text))];
      const editor = createTestEditor({ content: { type: "doc", content } });
      const parts = editor.layout.pages.flatMap((page) => page.blocks.filter((b) => b.node.textContent === text).map((b) => ({ page: page.pageNumber, b })));
      const [onFirst, onNext] = parts;
      if (!onFirst || !onNext || onFirst.b.lines.some((line) => line.spans.length > 0)) { editor.destroy(); continue; }
      editor.ensurePagePopulated(onFirst.page);
      editor.ensurePagePopulated(onNext.page);
      const start = onFirst.b.nodePos + 1;
      const x = editor.charMap.coordsAtPos(start + 3)?.x ?? 0;
      const above = editor.charMap.posAbove(start + 3, x);
      expect(above).not.toBeNull();
      expect(above ?? start).toBeLessThan(start);
      editor.destroy();
      return;
    }
    throw new Error("no layout leaves the number alone at a page bottom");
  });

  it("draws a number left alone at the bottom of a page in its text's face", () => {
    for (let fillers = 1; fillers < 80; fillers++) {
      for (let length = 8; length <= 60; length++) {
        const text = `${"w".repeat(length)} tail`;
        const content = [...Array.from({ length: fillers }, (_, i) => p(`Filler ${i}`)), olFrom(32767, li(sized(28, text)))];
        const parts = laidOut(content).filter((block) => block.node.textContent === text);
        const [numberPart, wordPart] = parts;
        if (!numberPart || !wordPart || numberPart.lines.some((line) => line.spans.length > 0)) continue;
        expect(markerAnchorOf(numberPart)?.font).toBe(fontOf(wordPart));
        return;
      }
    }
    throw new Error("no layout leaves the number alone at a page bottom");
  });

  it("draws the number on the item's first text line when a full-width image covers its top", () => {
    const text = "item text after the image";
    // An image alone in the paragraph before the list takes no line, so its
    // band starts where the item does.
    const image: Json = { type: "paragraph", content: [
      { type: "image", attrs: { src: "data:image/png;base64,AA==", width: 420, height: 100, wrapMode: "top-bottom", xAlign: "center", yOffset: 10 } },
    ] };
    const block = blockOf(laidOut([p("before"), image, olFrom(100, item(text))]), text);
    const textLineIndex = block.lines.findIndex((line) => line.spans.some((span) => span.kind === "text"));
    expect(textLineIndex).toBeGreaterThan(0);
    const textTop = block.y + block.lines.slice(0, textLineIndex).reduce((sum, line) => sum + line.lineHeight, 0);
    const textLine = block.lines[textLineIndex];
    const marker = markerAnchorOf(block);
    expect(marker?.baseline).toBeCloseTo(textTop + (textLine?.ascent ?? 0), 6);
    const firstSpan = textLine?.spans.find((span) => span.kind === "text");
    expect(block.x + (firstSpan?.x ?? 0)).toBeGreaterThan((block.marker?.x ?? 0) + measureTextWidth("100.", fontOf(block)));
  });

  it("moves Down and Up across a full-width image's gap in a plain paragraph", () => {
    const text = "word ".repeat(80).trim();
    const editor = createTestEditor({ content: { type: "doc", content: [
      p("before"),
      { type: "paragraph", content: [
        { type: "text", text },
        { type: "image", attrs: { src: "data:image/png;base64,AA==", width: 420, height: 100, wrapMode: "top-bottom", xAlign: "center", yOffset: 80 } },
      ] },
    ] } });
    editor.ensurePagePopulated(1);
    const map = editor.charMap;
    const block = blockOf(editor.layout.pages.flatMap((page) => page.blocks), text);
    const gapIndex = block.lines.findIndex((line) => line.spans.length === 0);
    expect(gapIndex).toBeGreaterThan(0);
    const before = block.lines.slice(0, gapIndex).flatMap((line) => line.spans).at(-1);
    const after = block.lines.slice(gapIndex + 1).flatMap((line) => line.spans)[0];
    if (!before || !after) throw new Error("no text on both sides of the gap");
    const x = map.coordsAtPos(before.docPos)?.x ?? 0;
    expect(map.posBelow(before.docPos, x)).toBeGreaterThanOrEqual(after.docPos);
    expect(map.posAbove(after.docPos, x)).toBeLessThan(after.docPos);
    expect(map.posAbove(after.docPos, x)).toBeGreaterThan(block.nodePos + 1);
    editor.destroy();
  });

  it("moves the number past a float on the item's left, and the text a space after it", () => {
    const float: Json = { type: "paragraph", content: [
      { type: "image", attrs: { src: "data:image/png;base64,AA==", width: 150, height: 200, wrapMode: "square", xAlign: "left" } },
      { type: "text", text: "anchor" },
    ] };
    const l = runPipeline(schema.nodeFromJSON({ type: "doc", content: [float, ol(item("first"), item("second"))] }), {
      pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig,
    });
    const f = l.anchoredObjects?.[0];
    if (!f) throw new Error("no float");
    const blocks = l.pages.flatMap((page) => page.blocks);
    for (const { text, number } of [{ text: "first", number: "1." }, { text: "second", number: "2." }]) {
      const block = blockOf(blocks, text);
      const marker = markerAnchorOf(block);
      const textX = block.x + firstLineStart(block);
      expect(marker?.x).toBeGreaterThanOrEqual(f.x + f.width + ANCHORED_OBJECT_MARGIN - 0.5);
      const numberEnd = (marker?.x ?? 0) + measureTextWidth(number, fontOf(block));
      expect(textX - numberEnd).toBeCloseTo(measureTextWidth(" ", fontOf(block)), 0);
    }
  });

  it("keeps the push past a wide number when a float moves the first word below it", () => {
    const word = "w".repeat(30);
    const float: Json = { type: "paragraph", content: [
      { type: "image", attrs: { src: "data:image/png;base64,AA==", width: 480, height: 60, wrapMode: "square", xAlign: "right" } },
    ] };
    const block = blockOf(laidOut([float, olFrom(100, item(`${word} tail`))]), `${word} tail`);
    const textLine = block.lines.find((line) => line.spans.some((span) => span.kind === "text"));
    const first = textLine?.spans.find((span) => span.kind === "text");
    expect(block.x + (first?.x ?? 0)).toBeGreaterThan((block.marker?.x ?? 0) + measureTextWidth("100.", fontOf(block)));
  });

  it("never lets an indented paragraph's first word run into a float beside it", () => {
    // Every first-word length, so some fall between the gap and the indented line.
    for (let length = 6; length <= 40; length++) {
      const plain = schema.nodeFromJSON({ type: "paragraph", attrs: { textIndent: 48 }, content: [
        { type: "text", text: `${"w".repeat(length)} tail` },
        { type: "image", attrs: { src: "data:image/png;base64,AA==", width: 450, height: 60, wrapMode: "square", xAlign: "right" } },
      ] });
      const l = runPipeline(schema.node("doc", null, [plain]), { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig });
      const f = l.anchoredObjects?.[0];
      const block = l.pages[0]?.blocks[0];
      if (!f || !block) throw new Error("no float or block");
      let top = block.y;
      for (const line of block.lines) {
        const beside = top < f.y + f.height && top + line.lineHeight > f.y;
        for (const span of line.spans) {
          // Text keeps clear of the image's wrap margin, not just its pixels.
          if (beside && span.kind === "text") expect(block.x + span.x + span.width).toBeLessThanOrEqual(f.x - ANCHORED_OBJECT_MARGIN + 0.5);
        }
        top += line.lineHeight;
      }
    }
  });

  it("draws the number of an item split just below a full-width image, on the part with its text", () => {
    const image = (height: number): Json => ({ type: "paragraph", content: [
      { type: "image", attrs: { src: "data:image/png;base64,AA==", width: 420, height, wrapMode: "top-bottom", xAlign: "center" } },
    ] });
    let splitSeen = false;
    for (const height of [100, 200, 300]) {
      for (let fillers = 20; fillers <= 32; fillers++) {
        const text = "item text after the image";
        const content = [...Array.from({ length: fillers }, (_, i) => p(`Filler ${i}`)), image(height), olFrom(7, item(text))];
        const parts = laidOut(content).filter((block) => block.node.textContent === text);
        if (parts.length > 1) splitSeen = true;
        const drawn = parts.map((part) => markerAnchorOf(part)).filter((marker) => marker !== null);
        expect(drawn).toHaveLength(1);
      }
    }
    expect(splitSeen).toBe(true);
  });

  it("leaves a wide number alone on its line below a full-width image that opens the item in a narrow cell", () => {
    const manager = new ExtensionManager([StarterKit, Table]);
    const tableFont = manager.buildBlockStyles();
    const cases = [[208, "Telecommunications", 18], [208, "Telecommunications", 14], [156, "Responsibilities", 14]] as const;
    for (const [column, word, size] of cases) {
      const text = `${word} and more words follow here`;
      const grid = Array.from({ length: Math.round(624 / column) }, () => column);
      const docNode = manager.schema.nodeFromJSON({ type: "doc", content: [{ type: "table", attrs: { grid }, content: [{ type: "tableRow", content: [
        { type: "tableCell", content: [olFrom(100, li({ type: "paragraph", content: [
          { type: "image", attrs: { src: "data:image/png;base64,AA==", width: 100, height: 60, wrapMode: "top-bottom", xAlign: "center" } },
          { type: "text", text, marks: [{ type: "fontSize", attrs: { size } }] },
        ] }))] },
        ...grid.slice(1).map(() => ({ type: "tableCell", content: [p("b")] })),
      ] }] }] });
      const l = runPipeline(docNode, { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: tableFont });
      const cell = l.pages[0]?.blocks.find((block) => block.cells)?.cells?.[0];
      const item = cell?.blocks.find((block) => block.node.textContent === text);
      if (!item) throw new Error("no item");
      const marker = markerAnchorOf(item);
      if (!marker) throw new Error("no marker");
      // The number sits on a line of its own or on its text's line, never on
      // the anchor's empty line above the text.
      let top = item.y;
      const numberLine = item.lines.find((line) => {
        const here = Math.abs(top + line.ascent - marker.baseline) < 0.01;
        top += line.lineHeight;
        return here;
      });
      expect(numberLine?.ascent ?? 0).toBeGreaterThan(0);
    }
  });

  it("registers every letter of the word when painting fills the hit-test map", () => {
    const text = numberAloneText();
    const layout = runPipeline(numberAloneDoc(text), { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig });
    const page = layout.pages[0];
    const ctx = document.createElement("canvas").getContext("2d");
    if (!page || !ctx) throw new Error("no page or no 2d context");
    const map = new CharacterMap();
    renderPage({
      ctx, page, pageConfig: defaultPageConfig, renderVersion: layout.version, currentVersion: () => layout.version,
      dpr: 1, measurer: createMeasurer(), map, blockRegistry: new ExtensionManager([StarterKit]).buildBlockRegistry(),
    });
    const start = blockOf(page.blocks, text).nodePos + 1;
    const wordLength = text.indexOf(" ");
    const glyphs = map.glyphsInRange(start, start + wordLength);
    expect(glyphs.map((glyph) => glyph.docPos)).toEqual(Array.from({ length: wordLength }, (_, i) => start + i));
    expect(new Set(glyphs.map((glyph) => glyph.lineIndex)).size).toBe(1);
  });
});

describe("nested lists", () => {
  it("lays out a nested item with the second level's marker", () => {
    const blocks = laidOut([ul(item("one", ul(item("child"))), item("two"))]);
    expect(blocks.map((block) => block.node.textContent)).toEqual(["one", "child", "two"]);
    expect(markers(blocks)).toEqual(["•", "◦", "•"]);
  });

  it("cycles bullets by depth", () => {
    const blocks = laidOut([ul(item("a", ul(item("b", ul(item("c", ul(item("d"))))))))]);
    expect(markers(blocks)).toEqual(["•", "◦", "▪", "•"]);
  });

  it("numbers nested ordered levels 1. / a. / i.", () => {
    const blocks = laidOut([ol(item("a", ol(item("b", ol(item("c", ol(item("d"))))), item("b2"))))]);
    expect(markers(blocks)).toEqual(["1.", "a.", "i.", "1.", "b."]);
  });

  it("takes each level's marker from its own list: ordered inside bullet, bullet inside ordered", () => {
    expect(markers(laidOut([ol(item("one", ul(item("child"))))]))).toEqual(["1.", "◦"]);
    expect(markers(laidOut([ul(item("one", ol(item("child"), item("next"))))]))).toEqual(["•", "a.", "b."]);
  });

  it("restarts a nested list's count under each parent item", () => {
    const blocks = laidOut([ol(item("one", ol(item("x"), item("y"))), item("two", ol(item("z"))))]);
    expect(markers(blocks)).toEqual(["1.", "a.", "b.", "2.", "a."]);
  });
});

describe("an item with more than one block", () => {
  it("lays out every block, with the marker only on the first", () => {
    const blocks = laidOut([ul(li(p("one"), p("more")), item("two"))]);
    expect(blocks.map((block) => block.node.textContent)).toEqual(["one", "more", "two"]);
    expect(markers(blocks)).toEqual(["•", null, "•"]);
  });

  it("aligns a continuation block with the item's text", () => {
    const blocks = laidOut([ul(li(p("one"), p("more")))]);
    expect(blockOf(blocks, "more").x).toBe(blockOf(blocks, "one").x);
  });

  it("does not count a continuation block as an item", () => {
    const blocks = laidOut([ol(li(p("one"), p("more")), item("two"))]);
    expect(markers(blocks)).toEqual(["1.", null, "2."]);
  });
});

describe("where an ordered list starts", () => {
  it("numbers from `order`", () => {
    const blocks = laidOut([olFrom(3, item("c"), item("d"), item("e"))]);
    expect(markers(blocks)).toEqual(["3.", "4.", "5."]);
  });

  it("restarts every ordered list at its own start", () => {
    const blocks = laidOut([ol(item("a"), item("b")), p("between"), ol(item("c"))]);
    expect(markers(blocks)).toEqual(["1.", "2.", null, "1."]);
  });
});

describe("Tab and Shift-Tab are visible", () => {
  const twoItems = { type: "doc", content: [ul(item("one"), item("two")), { type: "paragraph" }] };

  it("draws an item Tab nested, one level in", () => {
    const editor = new KeyEditor({ extensions: [StarterKit], content: twoItems });
    editor.caretAt("two");
    expect(editor.press("Tab")).toBe(true);

    const blocks = laidOut(editor.getState().doc);
    const [one, two] = [blockOf(blocks, "one"), blockOf(blocks, "two")];
    expect(two.marker?.data).toBe("◦");
    expect(two.x - one.x).toBe(HALF_INCH);
  });

  it("draws it back at the top level after Shift-Tab", () => {
    const editor = new KeyEditor({ extensions: [StarterKit], content: twoItems });
    editor.caretAt("two");
    editor.press("Tab");
    editor.press("Shift-Tab");

    const blocks = laidOut(editor.getState().doc);
    const [one, two] = [blockOf(blocks, "one"), blockOf(blocks, "two")];
    expect(two.marker?.data).toBe("•");
    expect(two.x).toBe(one.x);
  });

  it("draws an item that Backspace joined onto the one above", () => {
    const editor = new KeyEditor({ extensions: [StarterKit], content: twoItems });
    editor.caretAt("two");
    editor.press("Backspace");

    const blocks = laidOut(editor.getState().doc);
    const [one, two] = [blockOf(blocks, "one"), blockOf(blocks, "two")];
    expect(two.marker?.data).toBeUndefined();
    expect(two.x).toBe(one.x);
  });
});

describe("Tab takes only that item deeper, as in Word", () => {
  const threeItems = { type: "doc", content: [ul(item("one"), item("two"), item("three")), { type: "paragraph" }] };
  const xs = (editor: KeyEditor) => {
    const blocks = laidOut(editor.getState().doc);
    const one = blockOf(blocks, "one").x;
    return ["one", "two", "three"].map((text) => (blockOf(blocks, text).x - one) / HALF_INCH);
  };
  const marker = (editor: KeyEditor, text: string) => blockOf(laidOut(editor.getState().doc), text).marker?.data;

  it("takes an item a level further on each Tab, and leaves the items after it", () => {
    const editor = new KeyEditor({ extensions: [StarterKit], content: threeItems });
    editor.caretAt("two");
    editor.press("Tab");
    expect(editor.press("Tab")).toBe(true);
    expect(xs(editor)).toEqual([0, 2, 0]);
    expect(marker(editor, "two")).toBe("▪");
    expect(marker(editor, "three")).toBe("•");
  });

  it("leaves a list nested in the item where it is", () => {
    const editor = new KeyEditor({ extensions: [StarterKit], content: { type: "doc", content: [
      ol(item("one"), item("two", ol(item("child")))), { type: "paragraph" },
    ] } });
    const before = blockOf(laidOut(editor.getState().doc), "child");
    editor.caretAt("two");
    editor.press("Tab");
    const blocks = laidOut(editor.getState().doc);
    expect(blockOf(blocks, "two").x - blockOf(blocks, "one").x).toBe(HALF_INCH);
    expect(blockOf(blocks, "child").x).toBe(before.x);
    expect(blockOf(blocks, "child").marker?.data).toBe(before.marker?.data);
  });

  it("brings only that item back a level on each Shift-Tab", () => {
    const editor = new KeyEditor({ extensions: [StarterKit], content: threeItems });
    editor.caretAt("two");
    editor.press("Tab");
    editor.press("Tab");
    editor.press("Shift-Tab");
    expect(xs(editor)).toEqual([0, 1, 0]);
    expect(marker(editor, "two")).toBe("◦");
  });

  it("takes a list's first item in alone", () => {
    const editor = new KeyEditor({ extensions: [StarterKit], content: threeItems });
    const before = blockOf(laidOut(editor.getState().doc), "two").x;
    editor.caretAt("one");
    expect(editor.press("Tab")).toBe(true);
    const blocks = laidOut(editor.getState().doc);
    expect(blockOf(blocks, "one").x - before).toBe(HALF_INCH);
    expect(blockOf(blocks, "two").x).toBe(before);
  });

  it("takes an item back a level on each Backspace at its start, leaving the items after it", () => {
    const editor = new KeyEditor({ extensions: [StarterKit], content: threeItems });
    editor.caretAt("two");
    for (let i = 0; i < 3; i++) editor.press("Tab");
    for (let level = 2; level >= 0; level--) {
      editor.caretAt("two");
      editor.press("Backspace");
      expect(xs(editor)).toEqual([0, level, 0]);
      expect(marker(editor, "two")).toBe(["•", "◦", "▪"][level]);
    }
    expect(editor.getState().doc.child(0).childCount).toBe(3);
  });

  it("joins a line below a nested list onto the text above it on Backspace, as Word does", () => {
    const editor = new KeyEditor({ extensions: [StarterKit], content: { type: "doc", content: [
      ul(li(p("one"), ul(item("two")), p("more"))), { type: "paragraph" },
    ] } });
    editor.caretAt("more");
    editor.press("Backspace");
    const texts: string[] = [];
    editor.getState().doc.descendants((node) => {
      if (node.isTextblock) texts.push(node.textContent);
    });
    expect(texts).toEqual(["one", "twomore", ""]);
  });

  it("stops at the ninth level", () => {
    const editor = new KeyEditor({ extensions: [StarterKit], content: threeItems });
    editor.caretAt("one");
    for (let i = 0; i < 8; i++) editor.press("Tab");
    const deepest = editor.getState().doc;
    expect(editor.press("Tab")).toBe(true);
    expect(editor.getState().doc.eq(deepest)).toBe(true);
    expect(blockOf(laidOut(editor.getState().doc), "one").x - blockOf(laidOut(editor.getState().doc), "two").x).toBe(8 * HALF_INCH);
  });

  it("numbers by level, as Word does: an item follows the last at its level, and a shallower one restarts the deeper", () => {
    const deeper = (text: string) => ({ type: "listItem", attrs: { levelOffset: 1 }, content: [p(text)] });
    const blocks = laidOut([ol(item("a1"), deeper("b1"), deeper("b2"), item("a2"), deeper("c1"))]);
    expect(markers(blocks)).toEqual(["1.", "a.", "b.", "2.", "a."]);
  });
});

describe("a list container from another extension", () => {
  it("is drawn as a bullet list when it declares List's wrapper", () => {
    const Checklist = Extension.create({
      name: "checklist",
      addNodes() {
        return { checklist: { group: "block", content: "listItem+", toDOM: () => ["ul", 0], layout: { kind: "transparent", wrap: listWrap } } };
      },
    });
    const custom = new ExtensionManager([StarterKit, Checklist]);
    const lay = (content: Json[]) => runPipeline(custom.schema.nodeFromJSON({ type: "doc", content }), {
      pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: custom.buildBlockStyles(),
    }).pages.flatMap((page) => page.blocks);
    const checklist = (...items: Json[]): Json => ({ type: "checklist", content: items });
    const shown = (blocks: LayoutBlock[]) => blocks.map((block) => `${block.node.textContent}:${markerText(block)}@${block.x}`);
    expect(shown(lay([checklist(item("a", checklist(item("b"))))])))
      .toEqual(shown(lay([ul(item("a", ul(item("b"))))])));
  });
});

describe("drawing markers on the canvas", () => {
  const paint = (block: LayoutBlock) => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const calls = { arc: vi.spyOn(ctx, "arc"), fillRect: vi.spyOn(ctx, "fillRect"), fillText: vi.spyOn(ctx, "fillText") };
    drawMarker(ctx, block, defaultEditorTheme);
    const markerText = calls.fillText.mock.calls.filter(([text]) => text === block.marker?.data);
    return { arcs: calls.arc.mock.calls.length, rects: calls.fillRect.mock.calls.length, markerText: markerText.length };
  };

  it("draws bullets as shapes, the same ones PDF draws", () => {
    const blocks = laidOut([ul(item("a", ul(item("b", ul(item("c"))))))]);
    const [disc, circle, square] = [paint(blockOf(blocks, "a")), paint(blockOf(blocks, "b")), paint(blockOf(blocks, "c"))];
    expect(disc).toMatchObject({ arcs: 1, markerText: 0 });
    expect(circle).toMatchObject({ arcs: 1, markerText: 0 });
    expect(square).toMatchObject({ rects: 1, markerText: 0 });
  });

  it("draws in the theme's marker colour", () => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const fills: unknown[] = [];
    vi.spyOn(ctx, "fillText").mockImplementation(() => void fills.push(ctx.fillStyle));
    drawMarker(ctx, blockOf(laidOut([ol(item("a"))]), "a"), { ...defaultEditorTheme, marker: "#ff0000" });
    expect(fills).toEqual(["#ff0000"]);
  });

  it("draws numbers as text", () => {
    expect(paint(blockOf(laidOut([ol(item("a"))]), "a")).markerText).toBe(1);
  });

  it("keeps every block's own painter: a marker does not relabel the block", () => {
    const blocks = laidOut([ol(li(floating, p("more")), item("two", ul(item("child"))))]);
    expect(blocks.filter((block) => block.blockType !== block.node.type.name)).toEqual([]);
  });
});

describe("incremental layout agrees with a fresh one", () => {
  /** Lays each document out in turn the way LayoutCoordinator does: one cache, the previous layout and version. */
  function incremental(steps: Array<{ doc: Node; pageConfig?: typeof defaultPageConfig }>): LayoutBlock[] {
    const measureCache = new WeakMap<Node, MeasureCacheEntry>();
    const measurer = createMeasurer();
    let previous: ReturnType<typeof runPipeline> | undefined;
    for (const step of steps) {
      previous = runPipeline(step.doc, {
        pageConfig: step.pageConfig ?? defaultPageConfig,
        measurer,
        fontConfig,
        measureCache,
        ...(previous ? { previousLayout: previous, previousVersion: previous.version } : {}),
      });
    }
    return previous ? previous.pages.flatMap((page) => page.blocks) : [];
  }

  const shown = (blocks: LayoutBlock[]) =>
    blocks.map((block) => `${block.node.textContent}:${block.marker?.data ?? ""}@${block.x}+${firstLineStart(block)}`);
  const longList = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => item(`${prefix} ${i}`));

  /**
   * The documents an editor passes through while its keys are pressed. The
   * first edit stamps every block with its id, which replaces every node once;
   * a word typed first leaves the keys to edit a document whose unchanged
   * blocks keep their identity, as in an editor already in use.
   */
  function pressed(content: Json[], caretIn: string, ...keys: string[]): Node[] {
    const editor = new KeyEditor({ extensions: [StarterKit], content: { type: "doc", content: [...content, { type: "paragraph" }] } });
    editor.applyTransaction(editor.getState().tr.insertText("typed", editor.getState().doc.content.size - 1));
    const docs = [editor.getState().doc];
    editor.caretAt(caretIn);
    for (const key of keys) {
      expect(editor.press(key)).toBe(true);
      docs.push(editor.getState().doc);
    }
    return docs;
  }
  const steps = (docs: Node[]) => docs.map((doc) => ({ doc }));
  const fresh = (docs: Node[]) => laidOut(docs[docs.length - 1] ?? schema.node("doc"));

  it("renumbers the items after one Tab nested", () => {
    const docs = pressed([ol(...longList("item", 90))], "item 5", "Tab");
    expect(shown(incremental(steps(docs)))).toEqual(shown(fresh(docs)));
  });

  it("renumbers the items after Shift-Tab lifts a nested one", () => {
    const docs = pressed([ol(item("top", ol(...longList("sub", 80))), ...longList("after", 10))], "sub 3", "Shift-Tab");
    expect(shown(incremental(steps(docs)))).toEqual(shown(fresh(docs)));
  });

  it("renumbers the items after two are joined, across a page break", () => {
    const content = [ol(item("A"), item("B"), li(p("C"), { type: "pageBreak" }), item("D"), item("E"), item("F"))];
    const docNode = schema.nodeFromJSON({ type: "doc", content });
    let aEnd = -1;
    let bStart = -1;
    docNode.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "A") aEnd = pos + 1 + node.content.size;
      if (node.isTextblock && node.textContent === "B") bStart = pos + 1;
      return true;
    });
    const joined = EditorState.create({ doc: docNode }).tr.delete(aEnd, bStart).doc;
    expect(shown(incremental(steps([docNode, joined])))).toEqual(shown(fresh([joined])));
  });

  it("re-lays a wide number's first line when the start changes", () => {
    const text = "wide ".repeat(60).trim();
    const docNode = schema.nodeFromJSON({ type: "doc", content: [olFrom(1000, item(text))] });
    const restarted = EditorState.create({ doc: docNode }).tr.setNodeAttribute(0, "order", 1).doc;
    expect(shown(incremental(steps([docNode, restarted])))).toEqual(shown(fresh([restarted])));
  });

  it("re-lays a wide number's first line when the page width moves its indent", () => {
    let nested: Json = olFrom(18, item("deep"));
    for (let depth = 0; depth < 8; depth++) nested = ol(item(`L${depth}`, nested));
    const docNode = schema.nodeFromJSON({ type: "doc", content: [nested] });
    const narrow = { ...defaultPageConfig, pageWidth: 559 };
    const wider = { ...defaultPageConfig, pageWidth: 600 };
    const after = incremental([{ doc: docNode, pageConfig: narrow }, { doc: docNode, pageConfig: wider }]);
    expect(shown(after)).toEqual(shown(laidOut(docNode, wider)));
  });
});

describe("blocks other than paragraphs inside an item", () => {
  it("keeps a heading's own style, at the item's indent", () => {
    const heading: Json = { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "H" }] };
    const blocks = laidOut([ul(li(p("a"), heading))]);
    const inList = blockOf(blocks, "H");
    const alone = blockOf(laidOut([heading]), "H");
    expect(inList.lines[0]?.lineHeight).toBe(alone.lines[0]?.lineHeight);
    expect(inList.spaceBefore).toBe(alone.spaceBefore);
    expect(inList.spaceAfter).toBe(alone.spaceAfter);
    expect(inList.x).toBe(blockOf(blocks, "a").x);
  });

  it("indents a table with the item it sits in", () => {
    const manager = new ExtensionManager([StarterKit, Table]);
    const cell = (text: string): Json => ({ type: "tableCell", content: [p(text)] });
    const table: Json = {
      type: "table",
      attrs: { grid: [120, 120] },
      content: [{ type: "tableRow", content: [cell("c1"), cell("c2")] }],
    };
    const docNode = manager.schema.nodeFromJSON({ type: "doc", content: [ul(li(p("a"), table)), { type: "paragraph" }] });
    const blocks = runPipeline(docNode, {
      pageConfig: defaultPageConfig,
      measurer: createMeasurer(),
      fontConfig: manager.buildBlockStyles(),
    }).pages.flatMap((page) => page.blocks);
    const row = blocks.find((block) => block.node.type.name === "tableRow");
    expect(row?.x).toBe(blockOf(blocks, "a").x);
  });
});

describe("how far a block can be indented", () => {
  const contentRight = (config: typeof defaultPageConfig) => config.pageWidth - config.margins.right;

  it("keeps every level's text on a narrow page, at least an inch wide", () => {
    const narrow = { ...defaultPageConfig, pageWidth: 559 };
    let nested: Json = item("deepest text with several words");
    for (let depth = 0; depth < 9; depth++) nested = item(`L${depth}`, ul(nested));
    for (const block of laidOut([ul(nested)], narrow)) {
      expect(block.availableWidth).toBeGreaterThanOrEqual(96);
      expect(block.x + block.availableWidth).toBeLessThanOrEqual(contentRight(narrow));
      expect(block.marker?.x ?? narrow.margins.left).toBeGreaterThanOrEqual(narrow.margins.left);
    }
  });

  it("keeps an inch of text for a paragraph indented past the page", () => {
    const deep = blockOf(laidOut([{ type: "paragraph", attrs: { indent: 30 }, content: [{ type: "text", text: "deep" }] }]), "deep");
    expect(deep.availableWidth).toBe(96);
    expect(deep.x + deep.availableWidth).toBe(contentRight(defaultPageConfig));
  });

  it("ignores an indent that is not a positive number", () => {
    for (const indent of [-2, Number.NaN]) {
      const block = blockOf(laidOut([{ type: "paragraph", attrs: { indent }, content: [{ type: "text", text: "x" }] }]), "x");
      expect(block.x).toBe(defaultPageConfig.margins.left);
    }
  });
});

/**
 * Word numbers the paragraph that opens an item, even when all it holds is a
 * floating image's anchor: the number sits on that paragraph's line. Such a
 * paragraph keeps one line inside a list item so the number has a line to sit
 * on; anywhere else it takes no space.
 */
describe("an item that opens with a floating image", () => {
  const anchorOf = (blocks: LayoutBlock[]) => {
    const found = blocks.find((block) => block.node.type.name === "paragraph" && block.node.textContent === "");
    if (!found) throw new Error("no anchor paragraph");
    return found;
  };

  it("numbers the image's paragraph, and counts on from it", () => {
    const blocks = laidOut([ol(li(floating), item("next"))]);
    expect(anchorOf(blocks).marker?.data).toBe("1.");
    expect(blockOf(blocks, "next").marker?.data).toBe("2.");
  });

  it("keeps the image's paragraph a line for its number", () => {
    const blocks = laidOut([ol(li(floating), item("next"))]);
    const anchor = anchorOf(blocks);
    expect(anchor.height).toBeGreaterThan(0);
    expect(blockOf(blocks, "next").y).toBeGreaterThanOrEqual(anchor.y + anchor.height);
  });

  it("numbers it when the item's text follows in the same item", () => {
    const blocks = laidOut([ul(li(floating, p("text")))]);
    expect(anchorOf(blocks).marker?.data).toBe("•");
    expect(blockOf(blocks, "text").marker?.data).toBeUndefined();
  });

  it("numbers it when a table or a nested list follows", () => {
    const manager = new ExtensionManager([StarterKit, Table]);
    const cell = (text: string): Json => ({ type: "tableCell", content: [p(text)] });
    const table: Json = { type: "table", attrs: { grid: [120] }, content: [{ type: "tableRow", content: [cell("c")] }] };
    const docNode = manager.schema.nodeFromJSON({ type: "doc", content: [
      ol(li(floating, table), li(floating, ol(item("child")))),
      { type: "paragraph" },
    ] });
    const blocks = runPipeline(docNode, { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: manager.buildBlockStyles() })
      .pages.flatMap((page) => page.blocks);
    const anchors = blocks.filter((block) => block.node.type.name === "paragraph" && block.marker?.data !== undefined && block.node.textContent === "");
    expect(anchors.map((block) => block.marker?.data)).toEqual(["1.", "2."]);
    expect(blockOf(blocks, "child").marker?.data).toBe("a.");
  });

  it("takes no space outside a list", () => {
    expect(anchorOf(laidOut([floating, p("after")])).height).toBe(0);
  });
});

describe("streamed layout of lists", () => {
  function streamed(docNode: Node, maxBlocks: number): LayoutBlock[] {
    const options = { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig, maxBlocks };
    let layout = runPipeline(docNode, options);
    while (layout.resumption) layout = runPipeline(docNode, { ...options, resumption: layout.resumption });
    return layout.pages.flatMap((page) => page.blocks);
  }
  const shown = (blocks: LayoutBlock[]) => blocks.map((block) => `${block.node.textContent}:${block.marker?.data ?? ""}@${block.x}`);

  it("lays lists out the same in chunks of any size as in one pass", () => {
    const docNode = schema.nodeFromJSON({ type: "doc", content: [
      ol(item("one", ul(item("child", ol(item("deep"))), item("child 2"))), li(p("two"), p("more")), item("three")),
      p("between"),
      olFrom(4, item("four", ol(item("x"), item("y")))),
      ol(li(floating, { type: "pageBreak" }, p("text")), item("second")),
    ] });
    for (const maxBlocks of [1, 2, 3, 5]) expect(shown(streamed(docNode, maxBlocks))).toEqual(shown(laidOut(docNode)));
  });
});

/** A table cell holds blocks as the body does, lists included (paste one in and it is there). */
describe("a list inside a table cell", () => {
  const manager = new ExtensionManager([StarterKit, Table]);
  const cellBlocks = (cellContent: Json[]): LayoutBlock[] => {
    const docNode = manager.schema.nodeFromJSON({ type: "doc", content: [
      { type: "table", attrs: { grid: [300, 300] }, content: [{ type: "tableRow", content: [
        { type: "tableCell", content: cellContent },
        { type: "tableCell", content: [p("other")] },
      ] }] },
      { type: "paragraph" },
    ] });
    const row = runPipeline(docNode, { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: manager.buildBlockStyles() })
      .pages.flatMap((page) => page.blocks).find((block) => block.cells !== undefined);
    return row?.cells?.[0]?.blocks ?? [];
  };

  it("lays out every item, numbered and nested, at its level's indent", () => {
    const blocks = cellBlocks([ol(item("first"), item("second", ul(item("nested"))))]);
    expect(blocks.map((block) => `${block.node.textContent}:${block.marker?.data ?? ""}`))
      .toEqual(["first:1.", "second:2.", "nested:◦"]);
    const [first, nested] = [blockOf(blocks, "first"), blockOf(blocks, "nested")];
    expect(nested.x - first.x).toBe(HALF_INCH);
    expect(first.marker?.x).toBe(first.x - QUARTER_INCH);
  });

  it("keeps the cell's text, with each item's own lines", () => {
    const blocks = cellBlocks([ul(item("alpha"), item("beta"))]);
    expect(blocks.map((block) => block.lines.flatMap((line) => line.spans).filter((span) => span.kind === "text").length > 0))
      .toEqual([true, true]);
  });

  it("spaces its items as a list in the body is spaced", () => {
    const inCell = blockOf(cellBlocks([ul(item("alpha"), item("beta"))]), "alpha");
    const inBody = blockOf(laidOut([ul(item("alpha"), item("beta"))]), "alpha");
    expect([inCell.spaceBefore, inCell.spaceAfter]).toEqual([inBody.spaceBefore, inBody.spaceAfter]);
  });

  it("closes a table nested in the cell with its last row", () => {
    const cell = (text: string): Json => ({ type: "tableCell", content: [p(text)] });
    const nested: Json = {
      type: "table",
      attrs: { grid: [100, 100] },
      content: [{ type: "tableRow", content: [cell("a"), cell("b")] }, { type: "tableRow", content: [cell("c"), cell("d")] }],
    };
    const rows = cellBlocks([p("before"), nested]).filter((block) => block.node.type.name === "tableRow");
    expect(rows.map((row) => row.isLastRow === true)).toEqual([false, true]);
  });

  /**
   * Word's rule after a list number: a first word that does not fit after the
   * number wraps to the next line, leaving the number alone on its line. So
   * the word never starts over the number, and never runs past the cell
   * unless it is wider than the cell itself.
   */
  it("keeps a narrow cell's first word inside the cell and clear of the number, at any column width", () => {
    const narrowCell = (content: Json[]): Json => ({ type: "tableCell", content });
    const faults: string[] = [];
    for (const order of [1, 100]) {
      for (let columns = 5; columns <= 10; columns++) {
        const docNode = manager.schema.nodeFromJSON({ type: "doc", content: [
          { type: "table", attrs: { grid: Array.from({ length: columns }, () => 100) }, content: [{ type: "tableRow", content: [
            narrowCell([olFrom(order, item("alphabet"))]),
            ...Array.from({ length: columns - 1 }, () => narrowCell([p("x")])),
          ] }] },
          { type: "paragraph" },
        ] });
        const row = runPipeline(docNode, { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: manager.buildBlockStyles() })
          .pages.flatMap((page) => page.blocks).find((block) => block.cells !== undefined);
        const cell = row?.cells?.[0];
        if (!cell) throw new Error("no cell");
        const block = blockOf(cell.blocks, "alphabet");
        const lineIndex = block.lines.findIndex((line) => line.spans.some((span) => span.kind === "text" && span.text.trim() !== "\u200b" && span.text.trim() !== ""));
        const word = block.lines[lineIndex]?.spans.find((span) => span.kind === "text" && span.text.trim() !== "" && span.text !== "\u200b");
        if (!word) throw new Error("no word");
        const wordStart = block.x + word.x;
        const numberEnd = (block.marker?.x ?? 0) + measureTextWidth(markerText(block), fontOf(block));
        const cellRight = cell.x + cell.width;
        const wordFitsCell = word.width <= cell.width - 2 * CELL_PADDING_H;
        const where = `${columns} columns, order ${order}`;
        if (lineIndex === 0 && wordStart <= numberEnd) faults.push(`${where}: over the number`);
        if (wordFitsCell && wordStart + word.width > cellRight) faults.push(`${where}: past the cell`);
      }
    }
    expect(faults).toEqual([]);
  });

  it("keeps the number inside a narrow cell, clear of its text", () => {
    const narrowCell = (content: Json[]): Json => ({ type: "tableCell", content });
    const docNode = manager.schema.nodeFromJSON({ type: "doc", content: [
      { type: "table", attrs: { grid: [100, 100, 100, 100, 100, 100] }, content: [{ type: "tableRow", content: [
        narrowCell([ol(item("first"))]),
        ...Array.from({ length: 5 }, () => narrowCell([p("x")])),
      ] }] },
      { type: "paragraph" },
    ] });
    const row = runPipeline(docNode, { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: manager.buildBlockStyles() })
      .pages.flatMap((page) => page.blocks).find((block) => block.cells !== undefined);
    const cell = row?.cells?.[0];
    if (!cell) throw new Error("no cell");
    const first = blockOf(cell.blocks, "first");
    const markerX = first.marker?.x ?? Number.NEGATIVE_INFINITY;
    expect(markerX).toBeGreaterThanOrEqual(cell.x);
    expect(first.x + firstLineStart(first)).toBeGreaterThan(markerX + measureTextWidth("1.", fontOf(first)));
  });
});

describe("a block container that is not a list", () => {
  it("lays out the blocks it holds", () => {
    const Mixed = Extension.create({
      name: "mixedContainer",
      addNodes() {
        return { mixedContainer: { group: "block", content: "(listItem | paragraph)+", toDOM: () => ["div", 0] } };
      },
    });
    const manager = new ExtensionManager([StarterKit, Mixed]);
    const docNode = manager.schema.nodeFromJSON({ type: "doc", content: [
      { type: "mixedContainer", content: [item("in an item"), p("loose")] },
    ] });
    const blocks = runPipeline(docNode, { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: manager.buildBlockStyles() })
      .pages.flatMap((page) => page.blocks);
    expect(blocks.map((block) => block.node.textContent)).toEqual(["in an item", "loose"]);
    expect(blocks.map((block) => block.marker?.data)).toEqual([undefined, undefined]);
  });

  it("is what nodeLayout reports: transparent when undeclared, its own box when declared", () => {
    const Containers = Extension.create({
      name: "containers",
      addNodes() {
        return {
          undeclaredContainer: { group: "block", content: "paragraph+", toDOM: () => ["div", 0] },
          declaredContainer: { group: "block", content: "paragraph+", layout: { kind: "block" }, toDOM: () => ["div", 0] },
        };
      },
    });
    const { schema: containers } = new ExtensionManager([StarterKit, Containers]);
    const kindOf = (name: string) => {
      const type = containers.nodes[name];
      return type ? nodeLayout(type).kind : undefined;
    };
    expect(["undeclaredContainer", "declaredContainer", "paragraph", "image"].map(kindOf))
      .toEqual(["transparent", "block", "block", "block"]);
  });

  it("still takes a line when it holds no blocks", () => {
    const Box = Extension.create({
      name: "box",
      addNodes() {
        return { box: { group: "block", content: "block*", toDOM: () => ["div", 0] } };
      },
    });
    const manager = new ExtensionManager([StarterKit, Box]);
    const docNode = manager.schema.nodeFromJSON({ type: "doc", content: [{ type: "box" }] });
    const blocks = runPipeline(docNode, { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: manager.buildBlockStyles() })
      .pages.flatMap((page) => page.blocks);
    expect(blocks.map((block) => block.node.type.name)).toEqual(["box"]);
  });

  it("keeps its own box when it declares one, so its painter draws it", () => {
    const Boxed = Extension.create({
      name: "boxedContainer",
      addNodes() {
        return {
          boxedContainer: { group: "block", content: "paragraph+", layout: { kind: "block" }, toDOM: () => ["div", 0] },
        };
      },
    });
    const manager = new ExtensionManager([StarterKit, Boxed]);
    const docNode = manager.schema.nodeFromJSON({ type: "doc", content: [{ type: "boxedContainer", content: [p("inside")] }] });
    const blocks = runPipeline(docNode, { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig: manager.buildBlockStyles() })
      .pages.flatMap((page) => page.blocks);
    expect(blocks.map((block) => block.node.type.name)).toEqual(["boxedContainer"]);
  });
});
