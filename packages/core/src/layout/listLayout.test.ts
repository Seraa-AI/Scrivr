import { describe, expect, it, vi } from "vitest";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { liftListItem, sinkListItem } from "prosemirror-schema-list";
import type { Node } from "prosemirror-model";
import { runPipeline, defaultPageConfig } from "./PageLayout";
import type { LayoutBlock } from "./BlockLayout";
import { ListItemStrategy } from "./ListItemStrategy";
import { CharacterMap } from "./CharacterMap";
import { defaultEditorTheme } from "../model/theme";
import { ServerEditor } from "../ServerEditor";
import { StarterKit } from "../extensions/StarterKit";
import { Table } from "../extensions/built-in/Table";
import { ExtensionManager } from "../extensions/ExtensionManager";
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

  it("keeps every number in the column, however wide (viii. at level 3)", () => {
    const items = Array.from({ length: 12 }, (_, i) => item(`n${i}`));
    const blocks = laidOut([ol(item("top", ol(item("mid", ol(...items)))))]);
    const xs = new Set(items.map((_, i) => blockOf(blocks, `n${i}`).listMarkerX));
    expect(xs.size).toBe(1);
    expect([...xs][0]).toBe(blockOf(blocks, "n0").x - QUARTER_INCH);
  });

  it("moves a wide number's first line of text to the next tab stop, as Word does", () => {
    const text = "wide ".repeat(60).trim();
    const wide = blockOf(laidOut([olFrom(1000, item(text))]), text);
    const firstSpan = wide.lines[0]?.spans[0];
    const font = firstSpan?.kind === "text" ? firstSpan.font : "";
    const markerRight = (wide.listMarkerX ?? 0) + measureTextWidth("1000.", font);
    const firstTextX = wide.x + (firstSpan?.x ?? 0);

    expect(wide.listMarkerX).toBe(wide.x - QUARTER_INCH);
    expect(firstTextX).toBeGreaterThan(markerRight);
    expect((firstTextX - defaultPageConfig.margins.left) % HALF_INCH).toBe(0);
    for (const line of wide.lines.slice(1)) expect(line.spans[0]?.x).toBe(0);
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

describe("incremental layout agrees with a fresh one", () => {
  /** Lays each document out in turn the way LayoutCoordinator does: one cache, the previous layout and version. */
  function incremental(docs: Node[]): LayoutBlock[] {
    const measureCache = new WeakMap();
    const measurer = createMeasurer();
    let previous: ReturnType<typeof runPipeline> | undefined;
    for (const docNode of docs) {
      previous = runPipeline(docNode, {
        pageConfig: defaultPageConfig,
        measurer,
        fontConfig,
        measureCache,
        ...(previous ? { previousLayout: previous, previousVersion: previous.version } : {}),
      });
    }
    return previous ? previous.pages.flatMap((page) => page.blocks) : [];
  }

  const shown = (blocks: LayoutBlock[]) =>
    blocks.map((block) => `${block.node.textContent}:${block.listMarker ?? ""}@${block.x}`);
  /**
   * The documents a run of edits passes through. A bare state keeps every
   * unchanged node's identity, as ProseMirror's structural sharing does, so
   * the measure cache sees the hits a long-lived editor sees.
   */
  function edited(content: Json[], caretIn: string, ...commands: Command[]): Node[] {
    const docNode = schema.nodeFromJSON({ type: "doc", content });
    let at = -1;
    docNode.descendants((node, pos) => {
      if (at < 0 && node.isTextblock && node.textContent === caretIn) at = pos + 1;
      return at < 0;
    });
    let state = EditorState.create({ doc: docNode, selection: TextSelection.create(docNode, at) });
    const docs = [state.doc];
    for (const command of commands) {
      expect(command(state, (tr) => { state = state.apply(tr); })).toBe(true);
      docs.push(state.doc);
    }
    return docs;
  }

  const listItemType = schema.nodes["listItem"];
  if (!listItemType) throw new Error("no listItem");
  const tab = sinkListItem(listItemType);
  const shiftTab = liftListItem(listItemType);
  const fiveItems = [ol(...["a", "b", "c", "d", "e"].map((t) => item(t)))];
  const fresh = (docs: Node[]) => laidOut(docs[docs.length - 1] ?? schema.node("doc"));

  it("renumbers the items after one Tab nested", () => {
    const docs = edited(fiveItems, "b", tab);
    expect(shown(incremental(docs))).toEqual(shown(fresh(docs)));
  });

  it("renumbers the items after Shift-Tab lifts a nested one", () => {
    const docs = edited([ol(item("a"), item("b", ol(item("c"))), item("d"), item("e"))], "c", shiftTab);
    expect(shown(incremental(docs))).toEqual(shown(fresh(docs)));
  });

  it("keeps the numbers after a Tab and its Shift-Tab", () => {
    const docs = edited(fiveItems, "b", tab, shiftTab);
    expect(shown(incremental(docs))).toEqual(shown(fresh(docs)));
  });

  it("renumbers the items after two are joined, across a page break", () => {
    const content = [ol(item("A"), item("B"), li(p("C"), { type: "pageBreak" }), item("D"), item("E"), item("F"))];
    const joinAB: Command = (state, dispatch) => {
      let aEnd = -1;
      let bStart = -1;
      state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === "A") aEnd = pos + 1 + node.content.size;
        if (node.isTextblock && node.textContent === "B") bStart = pos + 1;
        return true;
      });
      dispatch?.(state.tr.delete(aEnd, bStart));
      return true;
    };
    const docs = edited(content, "A", joinAB);
    expect(shown(incremental(docs))).toEqual(shown(fresh(docs)));
  });

  it("re-lays a wide number's first line when the start changes", () => {
    const text = "wide ".repeat(60).trim();
    const restart: Command = (state, dispatch) => {
      dispatch?.(state.tr.setNodeAttribute(0, "order", 1));
      return true;
    };
    const docs = edited([olFrom(1000, item(text))], text, restart);
    const firstLineX = (blocks: LayoutBlock[]) => blockOf(blocks, text).lines[0]?.spans[0]?.x;
    expect(firstLineX(incremental(docs))).toBe(firstLineX(fresh(docs)));
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

describe("deep nesting on a narrow page", () => {
  it("keeps every level's text on the page, at least an inch wide", () => {
    const narrow = { ...defaultPageConfig, pageWidth: 559 };
    const contentRight = narrow.pageWidth - narrow.margins.right;
    let nested: Json = item("deepest text with several words");
    for (let depth = 0; depth < 9; depth++) nested = item(`L${depth}`, ul(nested));
    const docNode = schema.nodeFromJSON({ type: "doc", content: [ul(nested)] });
    const blocks = runPipeline(docNode, { pageConfig: narrow, measurer: createMeasurer(), fontConfig })
      .pages.flatMap((page) => page.blocks);
    for (const block of blocks) {
      expect(block.availableWidth).toBeGreaterThanOrEqual(96);
      expect(block.x + block.availableWidth).toBeLessThanOrEqual(contentRight);
      expect(block.listMarkerX ?? narrow.margins.left).toBeGreaterThanOrEqual(narrow.margins.left);
    }
  });
});

describe("an item that opens with a floating image", () => {
  const floating: Json = {
    type: "paragraph",
    content: [{ type: "image", attrs: { src: "data:image/png;base64,AA==", width: 40, height: 40, wrapMode: "square" } }],
  };

  it("draws the marker on the item's first visible line", () => {
    const blocks = laidOut([ul(li(floating, p("text")), item("next"))]);
    const anchor = blocks.find((block) => block.height === 0 && block.node.type.name === "paragraph");
    expect(anchor?.listMarker).toBeUndefined();
    expect(blockOf(blocks, "text").listMarker).toBe("•");
    expect(blockOf(blocks, "next").listMarker).toBe("•");
  });

  it("draws no marker for an item with nothing visible, and does not hand it on", () => {
    const blocks = laidOut([ol(li(floating), item("next")), p("after")]);
    expect(blocks.filter((block) => block.listMarker !== undefined).map((block) => block.node.textContent))
      .toEqual(["next"]);
    expect(blockOf(blocks, "next").listMarker).toBe("2.");
  });

  it("hands the marker on when a streamed chunk starts between the two blocks", () => {
    const content = [p("intro"), ul(li(floating, p("text")), item("next"))];
    const docNode = schema.nodeFromJSON({ type: "doc", content });
    const options = { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig, maxBlocks: 2 };
    let layout = runPipeline(docNode, options);
    while (layout.resumption) layout = runPipeline(docNode, { ...options, resumption: layout.resumption });
    expect(blockOf(layout.pages.flatMap((page) => page.blocks), "text").listMarker).toBe("•");
  });
});

describe("streamed layout of nested lists", () => {
  it("lays out the same in chunks of any size as in one pass", () => {
    const content = [
      ol(item("one", ul(item("child", ol(item("deep"))), item("child 2"))), li(p("two"), p("more")), item("three")),
      p("between"),
      olFrom(4, item("four", ol(item("x"), item("y")))),
    ];
    const docNode = schema.nodeFromJSON({ type: "doc", content });
    const whole = laidOut(docNode).map((block) => `${block.node.textContent}:${block.listMarker ?? ""}@${block.x}`);
    for (const maxBlocks of [1, 2, 3, 5]) {
      const options = { pageConfig: defaultPageConfig, measurer: createMeasurer(), fontConfig, maxBlocks };
      let layout = runPipeline(docNode, options);
      while (layout.resumption) layout = runPipeline(docNode, { ...options, resumption: layout.resumption });
      const chunked = layout.pages.flatMap((page) => page.blocks)
        .map((block) => `${block.node.textContent}:${block.listMarker ?? ""}@${block.x}`);
      expect(chunked).toEqual(whole);
    }
  });
});
