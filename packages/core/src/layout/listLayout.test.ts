import { describe, expect, it, vi } from "vitest";
import { TextSelection } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { runPipeline, defaultPageConfig } from "./PageLayout";
import type { LayoutBlock } from "./BlockLayout";
import { ListItemStrategy } from "./ListItemStrategy";
import { CharacterMap } from "./CharacterMap";
import { defaultEditorTheme } from "../model/theme";
import { ServerEditor } from "../ServerEditor";
import { StarterKit } from "../extensions/StarterKit";
import { buildStarterKitContext, createMeasurer, measureTextWidth } from "../test-utils";

/**
 * How lists lay out. Geometry follows Word's built-in lists: each level's text
 * sits half an inch past the one above, and the marker hangs a quarter inch
 * before the text, left-aligned.
 */

const HALF_INCH = 48;
const QUARTER_INCH = 24;
const { schema, fontConfig } = buildStarterKitContext();

type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string };
const p = (text: string): Json => ({ type: "paragraph", content: [{ type: "text", text }] });
const li = (...content: Json[]): Json => ({ type: "listItem", content });
const ul = (...items: Json[]): Json => ({ type: "bulletList", content: items });
const ol = (...items: Json[]): Json => ({ type: "orderedList", content: items });
const olFrom = (order: number, ...items: Json[]): Json => ({ type: "orderedList", attrs: { order }, content: items });
const item = (text: string, ...nested: Json[]) => li(p(text), ...nested);

function laidOut(content: Json[] | Node): LayoutBlock[] {
  const docNode = Array.isArray(content) ? schema.nodeFromJSON({ type: "doc", content }) : content;
  const layout = runPipeline(docNode, {
    pageConfig: defaultPageConfig,
    measurer: createMeasurer(),
    fontConfig,
  });
  return layout.pages.flatMap((page) => page.blocks);
}

function blockOf(blocks: LayoutBlock[], text: string): LayoutBlock {
  const found = blocks.find((block) => block.node.textContent === text);
  if (!found) throw new Error(`"${text}" was not laid out`);
  return found;
}

const markers = (blocks: LayoutBlock[]) => blocks.map((block) => block.listMarker ?? null);

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
    expect(one.listMarkerX).toBe(one.x - QUARTER_INCH);
  });

  it("left-aligns ordered markers at the same hanging position", () => {
    const blocks = laidOut([ol(item("one"), item("two"))]);
    const [one, two] = [blockOf(blocks, "one"), blockOf(blocks, "two")];
    expect(one.listMarkerX).toBe(one.x - QUARTER_INCH);
    expect(two.listMarkerX).toBe(one.listMarkerX);
  });

  it("draws a number too wide for the hanging further left, clear of the text", () => {
    const blocks = laidOut([olFrom(1000, item("wide"))]);
    const wide = blockOf(blocks, "wide");
    const firstSpan = wide.lines[0]?.spans[0];
    const font = firstSpan?.kind === "text" ? firstSpan.font : "";
    const markerRight = (wide.listMarkerX ?? 0) + measureTextWidth("1000.", font);
    expect(wide.listMarkerX).toBeLessThan(wide.x - QUARTER_INCH);
    expect(markerRight).toBeLessThan(wide.x);
  });

  it("indents each level half an inch past the one above", () => {
    const blocks = laidOut([ul(item("a", ul(item("b", ul(item("c"))))))]);
    const [a, b, c] = [blockOf(blocks, "a"), blockOf(blocks, "b"), blockOf(blocks, "c")];
    expect(b.x - a.x).toBe(HALF_INCH);
    expect(c.x - b.x).toBe(HALF_INCH);
    expect(c.listMarkerX).toBe(c.x - QUARTER_INCH);
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
    const deepest = blockOf(blocks, "deepest");
    const ninth = blockOf(blocks, "d1");
    expect(deepest.x).toBe(ninth.x);
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
    expect(two.listMarker).toBe("◦");
    expect(two.x - one.x).toBe(HALF_INCH);
  });

  it("draws it back at the top level after Shift-Tab", () => {
    const editor = new KeyEditor({ extensions: [StarterKit], content: twoItems });
    editor.caretAt("two");
    editor.press("Tab");
    editor.press("Shift-Tab");

    const blocks = laidOut(editor.getState().doc);
    const [one, two] = [blockOf(blocks, "one"), blockOf(blocks, "two")];
    expect(two.listMarker).toBe("•");
    expect(two.x).toBe(one.x);
  });

  it("draws an item that Backspace joined onto the one above", () => {
    const editor = new KeyEditor({ extensions: [StarterKit], content: twoItems });
    editor.caretAt("two");
    editor.press("Backspace");

    const blocks = laidOut(editor.getState().doc);
    const [one, two] = [blockOf(blocks, "one"), blockOf(blocks, "two")];
    expect(two.listMarker).toBeUndefined();
    expect(two.x).toBe(one.x);
  });
});

describe("drawing markers on the canvas", () => {
  const paint = (block: LayoutBlock) => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const calls = { arc: vi.spyOn(ctx, "arc"), fillRect: vi.spyOn(ctx, "fillRect"), fillText: vi.spyOn(ctx, "fillText") };
    ListItemStrategy.render(
      block,
      { ctx, pageNumber: 1, lineIndexOffset: 0, dpr: 1, measurer: createMeasurer(), theme: defaultEditorTheme },
      new CharacterMap(),
    );
    const markerText = calls.fillText.mock.calls.filter(([text]) => text === block.listMarker);
    return { arcs: calls.arc.mock.calls.length, rects: calls.fillRect.mock.calls.length, markerText: markerText.length };
  };

  it("draws bullets as shapes, the same ones PDF draws", () => {
    const blocks = laidOut([ul(item("a", ul(item("b", ul(item("c"))))))]);
    const [disc, circle, square] = [paint(blockOf(blocks, "a")), paint(blockOf(blocks, "b")), paint(blockOf(blocks, "c"))];
    expect(disc).toMatchObject({ arcs: 1, markerText: 0 });
    expect(circle).toMatchObject({ arcs: 1, markerText: 0 });
    expect(square).toMatchObject({ rects: 1, markerText: 0 });
  });

  it("draws numbers as text", () => {
    expect(paint(blockOf(laidOut([ol(item("a"))]), "a")).markerText).toBe(1);
  });
});
