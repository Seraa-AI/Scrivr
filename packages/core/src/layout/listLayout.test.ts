import { describe, expect, it, vi } from "vitest";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { runPipeline, defaultPageConfig, type MeasureCacheEntry } from "./PageLayout";
import type { LayoutBlock } from "./BlockLayout";
import { drawListMarker } from "./listMarkers";
import { listMarker } from "../model/lists";
import { CharacterMap } from "./CharacterMap";
import { defaultEditorTheme } from "../model/theme";
import { renderPage } from "../renderer/PageRenderer";
import { ServerEditor } from "../ServerEditor";
import { StarterKit } from "../extensions/StarterKit";
import { Table } from "../extensions/built-in/Table";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { Extension } from "../extensions/Extension";
import { buildStarterKitContext, createMeasurer, measureTextWidth } from "../test-utils";

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

const markers = (blocks: LayoutBlock[]) => blocks.map((block) => block.listMarker ?? null);
const fontOf = (block: LayoutBlock) => {
  const span = block.lines[0]?.spans[0];
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
    expect(one.listMarkerX).toBe(one.x - QUARTER_INCH);
  });

  it("left-aligns ordered markers at the same hanging position", () => {
    const blocks = laidOut([ol(item("one"), item("two"))]);
    const [one, two] = [blockOf(blocks, "one"), blockOf(blocks, "two")];
    expect(one.listMarkerX).toBe(one.x - QUARTER_INCH);
    expect(two.listMarkerX).toBe(one.listMarkerX);
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
    expect(blockOf(blocks, "deepest").x).toBe(blockOf(blocks, "d1").x);
  });
});

describe("a number too wide for its hanging indent (Word: the tab after it goes to the next stop)", () => {
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
    const xs = new Set(blocks.map((block) => block.listMarkerX));
    expect([...xs]).toEqual([(blocks[0]?.x ?? 0) - QUARTER_INCH]);
  });

  // BLOCKS THE L1 MERGE. Beside a float, reflowFlowsAgainstExclusions re-lays
  // the item without its first-line offset, so the text starts under the
  // number. Fixed, after W1 lands on main, by forwarding a block's first-line
  // settings on every re-break path; this test then passes and `.fails` comes off.
  it.fails("moves the first line past a wide number beside a float too", () => {
    const text = "wide ".repeat(40).trim();
    const float: Json = {
      type: "paragraph",
      content: [
        { type: "image", attrs: { src: "data:image/png;base64,AA==", width: 100, height: 200, wrapMode: "square", xAlign: "right" } },
        { type: "text", text: "anchor" },
      ],
    };
    const wide = blockOf(laidOut([float, olFrom(100, item(text))]), text);
    const numberEnd = (wide.listMarkerX ?? 0) + measureTextWidth("100.", fontOf(wide));
    expect(wide.x + firstLineStart(wide)).toBeGreaterThan(numberEnd);
  });

  it("moves the first line to the next tab stop, and only the first line", () => {
    const text = "wide ".repeat(60).trim();
    const wide = blockOf(laidOut([olFrom(1000, item(text))]), text);
    const firstTextX = wide.x + firstLineStart(wide);
    expect(firstTextX).toBeGreaterThan((wide.listMarkerX ?? 0) + measureTextWidth("1000.", fontOf(wide)));
    expect((firstTextX - defaultPageConfig.margins.left) % HALF_INCH).toBe(0);
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
    numberEnd: (block.listMarkerX ?? 0) + measureTextWidth(block.listMarker ?? "", fontOf(block)),
  });

  it("never starts the text over a number that runs past the line's last tab stop", () => {
    const text = "letter item with words to wrap";
    const block = blockOf(laidOut([ol(item("top", olFrom(32767, item(text))))]), text);
    const { textStart, numberEnd } = textAndNumber(block);
    expect(textStart).toBeGreaterThan(numberEnd);
  });

  it("follows the number with a space when it ends past the line's last tab stop", () => {
    // Nine levels deep on a narrow page: the text is held an inch wide, so the
    // line's last tab stop falls inside it. The number is chosen by measuring,
    // so that it ends past that stop but before the line does, on any fonts.
    const narrow = { ...defaultPageConfig, pageWidth: 559 };
    const deep = (order: number): Json[] => {
      let nested: Json = olFrom(order, item("deep text"));
      for (let depth = 0; depth < 8; depth++) nested = ol(item(`L${depth}`, nested));
      return [nested];
    };
    const probe = blockOf(laidOut(deep(1), narrow), "deep text");
    const indent = probe.x - narrow.margins.left;
    const lineEnd = indent + probe.availableWidth;
    const lastStop = Math.floor((lineEnd - QUARTER_INCH) / HALF_INCH) * HALF_INCH;
    const roman = (n: number) => listMarker("ordered", 8, n);
    const fitting = Array.from({ length: 3999 }, (_, i) => i + 1).find((n) => {
      const end = indent - QUARTER_INCH + measureTextWidth(roman(n), fontOf(probe));
      return end >= lastStop && end < lineEnd - QUARTER_INCH;
    });
    if (fitting === undefined) throw new Error("no roman number ends between the last stop and the line's end");

    const block = blockOf(laidOut(deep(fitting), narrow), "deep text");
    const { textStart, numberEnd } = textAndNumber(block);
    expect(textStart).toBeGreaterThan(numberEnd);
    expect(textStart - numberEnd).toBeLessThan(QUARTER_INCH);
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
    drawListMarker(ctx, block, defaultEditorTheme);
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
    blocks.map((block) => `${block.node.textContent}:${block.listMarker ?? ""}@${block.x}+${firstLineStart(block)}`);
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
      expect(block.listMarkerX ?? narrow.margins.left).toBeGreaterThanOrEqual(narrow.margins.left);
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
    expect(anchorOf(blocks).listMarker).toBe("1.");
    expect(blockOf(blocks, "next").listMarker).toBe("2.");
  });

  // BLOCKS THE L1 MERGE. The float's own exclusion pass
  // (reflowFlowsAgainstExclusions) re-lays the paragraph without
  // keepAnchorLine, so its line collapses again. Fixed, after W1 lands on
  // main, by forwarding a block's first-line settings on every re-break path;
  // this test then passes and `.fails` comes off.
  it.fails("keeps the image's paragraph a line for its number", () => {
    const blocks = laidOut([ol(li(floating), item("next"))]);
    const anchor = anchorOf(blocks);
    expect(anchor.height).toBeGreaterThan(0);
    expect(blockOf(blocks, "next").y).toBeGreaterThanOrEqual(anchor.y + anchor.height);
  });

  it("numbers it when the item's text follows in the same item", () => {
    const blocks = laidOut([ul(li(floating, p("text")))]);
    expect(anchorOf(blocks).listMarker).toBe("•");
    expect(blockOf(blocks, "text").listMarker).toBeUndefined();
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
    const anchors = blocks.filter((block) => block.node.type.name === "paragraph" && block.listMarker !== undefined && block.node.textContent === "");
    expect(anchors.map((block) => block.listMarker)).toEqual(["1.", "2."]);
    expect(blockOf(blocks, "child").listMarker).toBe("a.");
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
  const shown = (blocks: LayoutBlock[]) => blocks.map((block) => `${block.node.textContent}:${block.listMarker ?? ""}@${block.x}`);

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
    expect(blocks.map((block) => `${block.node.textContent}:${block.listMarker ?? ""}`))
      .toEqual(["first:1.", "second:2.", "nested:◦"]);
    const [first, nested] = [blockOf(blocks, "first"), blockOf(blocks, "nested")];
    expect(nested.x - first.x).toBe(HALF_INCH);
    expect(first.listMarkerX).toBe(first.x - QUARTER_INCH);
  });

  it("keeps the cell's text, with each item's own lines", () => {
    const blocks = cellBlocks([ul(item("alpha"), item("beta"))]);
    expect(blocks.map((block) => block.lines.flatMap((line) => line.spans).filter((span) => span.kind === "text").length > 0))
      .toEqual([true, true]);
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
    expect(blocks.map((block) => block.listMarker)).toEqual([undefined, undefined]);
  });
});
