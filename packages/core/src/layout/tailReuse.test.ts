/**
 * A layout that reuses the last one's tail equals a fresh one, whatever the
 * edit was.
 */
import { describe, expect, it } from "vitest";
import type { Node } from "prosemirror-model";
import { Extension } from "../extensions/Extension";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { createMeasurer, createTestEditor } from "../test-utils";
import { defaultPageConfig, defaultPagelessConfig, runPipeline, type DocumentLayout, type MeasureCacheEntry, type PageConfig } from "./PageLayout";

/** Lays its blocks out in place, in the style its attr names. */
const Restyled = Extension.create({
  name: "restyled",
  addNodes() {
    return {
      restyled: {
        content: "block+",
        group: "block",
        attrs: { as: { default: "paragraph" } },
        layout: {
          kind: "transparent",
          wrap: {
            enter: (node) => ({ as: node.attrs["as"] }),
            place: (_block, _index, scope) => ({ indent: 0, styleKey: String(scope["as"]) }),
          },
        },
      },
    };
  },
});

const extensions = [StarterKit.configure({ table: true }), Restyled];
const manager = new ExtensionManager(extensions);
const { schema } = manager;
const fontConfig = manager.buildBlockStyles();
const measurer = createMeasurer();

const doc = (...blocks: Node[]): Node => schema.node("doc", null, blocks);
const p = (text: string, ...more: Node[]): Node => schema.node("paragraph", null, [schema.text(text), ...more]);
const image = (attrs: Record<string, unknown>): Node => schema.node("image", { src: "", ...attrs });
const pageBreak = (): Node => schema.node("pageBreak");
const sectionBreak = (breakType: string): Node =>
  schema.node("sectionBreak", { settings: { breakType, columns: { count: 1, gap: 24, equalWidth: true } } });
const numbered = (order: number, ...items: Node[]): Node => schema.node("orderedList", { order }, items);
const list = (...items: Node[]): Node => schema.node("bulletList", null, items);
const item = (text: string): Node => schema.node("listItem", null, [p(text)]);
/** A table is never in the measure cache, so every layout of one measures something. */
const table = (): Node =>
  schema.node("table", { grid: [100] }, [
    schema.node("tableRow", null, [schema.node("tableCell", null, [p("cell")])]),
  ]);

/** What a layout put where, and the document positions its text maps to. */
const placed = (layout: DocumentLayout) => ({
  height: layout.totalContentHeight,
  pages: layout.pages.map((page) =>
    page.blocks.map((block) => ({
      text: block.node.textContent,
      nodePos: block.nodePos,
      sourceNodePos: block.sourceNodePos,
      x: block.x,
      y: block.y,
      height: block.height,
      spaceAfter: block.spaceAfter,
      marker: block.marker?.data,
      lines: block.lines.map((line) => ({
        spans: line.spans.map((span) => [span.docPos, span.x]),
        breakAt: line.terminalBreakDocPos,
      })),
    })),
  ),
});

const optionsFor = (pageConfig: PageConfig) => ({ pageConfig, fontConfig, measurer });

/** Laid out on its own. */
const fresh = (node: Node, pageConfig: PageConfig = defaultPageConfig): DocumentLayout =>
  runPipeline(node, optionsFor(pageConfig));

/** Each document laid out on top of the last one's layout, as an editor does. */
function inTurn(docs: readonly Node[], pageConfig: PageConfig = defaultPageConfig): DocumentLayout[] {
  const options = { ...optionsFor(pageConfig), measureCache: new WeakMap<Node, MeasureCacheEntry>() };
  return docs.reduce<DocumentLayout[]>((layouts, node) => {
    const previousLayout = layouts.at(-1);
    return [...layouts, runPipeline(node, previousLayout ? { ...options, previousLayout, previousVersion: previousLayout.version } : options)];
  }, []);
}

function expectSameAsFresh(before: Node, after: Node, pageConfig: PageConfig = defaultPageConfig): void {
  const reused = inTurn([before, after], pageConfig)[1];
  expect(reused && placed(reused)).toEqual(placed(fresh(after, pageConfig)));
}

const paragraphJson = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

const [a, b, c, d] = [p("A"), p("B"), p("C"), p("D")];

describe("a layout that reuses the last one's tail", () => {
  it.each<[string, Node, Node]>([
    ["the last block deleted", doc(table(), a, b, c), doc(table(), a, b)],
    ["a block in the middle deleted", doc(table(), a, b, c), doc(table(), a, c)],
    ["everything after a block deleted", doc(table(), a, b, c, d), doc(table(), a)],
    ["a block moved to the end", doc(table(), a, b, c, d), doc(table(), a, c, d, b)],
    ["a page break deleted", doc(table(), a, pageBreak(), b), doc(table(), a, b)],
    ["a block deleted and an earlier one edited", doc(p("x"), a, b, c), doc(p("y"), a, b)],
    ["a block deleted after a page break", doc(table(), a, pageBreak(), b, c), doc(table(), a, pageBreak(), b)],
    ["a section break that stops moving the flow", doc(table(), a, sectionBreak("nextPage"), b), doc(table(), a, sectionBreak("continuous"), b)],
  ])("equals a fresh one: %s", (_name, before, after) => {
    expectSameAsFresh(before, after);
  });

  it("equals a fresh one: a list split in two, which moves the positions after it", () => {
    const t = table();
    const [one, two, three] = [item("one"), item("two"), item("three")];
    expectSameAsFresh(doc(t, list(one, two, three), d), doc(t, list(one, two), list(three), d));
  });

  it("equals a fresh one: a list renumbered, its items unchanged", () => {
    const one = item("one");
    expectSameAsFresh(doc(p("x"), a, numbered(1, one), c), doc(p("y"), a, numbered(5, one), c));
  });

  it("equals a fresh one: a wrapper that restyles the block it holds", () => {
    // The block is the same node at the same width, so its measurement is still
    // good; only the space it keeps comes from the wrapper.
    const t = table();
    expectSameAsFresh(
      doc(t, a, schema.node("restyled", { as: "heading_1" }, [b]), c),
      doc(t, a, schema.node("restyled", { as: "paragraph" }, [b]), c),
    );
  });

  it.each<[string, Node, Node]>([
    ["edited above", doc(p("x"), a, a, c), doc(p("y"), a, a, c)],
    ["moved down", doc(p("x"), a, a, c), doc(p("x"), p("new"), a, a, c)],
  ])("equals a fresh one: the same node twice, %s", (_name, before, after) => {
    expectSameAsFresh(before, after);
  });

  it("equals a fresh one: a float whose margin grows over the blocks beside it", () => {
    const anchoring = (margin: number): Node =>
      p("anchor", image({ wrapMode: "square", xAlign: "right", width: 200, height: 60, yOffset: 220, margin }));
    const rest = Array.from({ length: 12 }, (_, i) => p(`${i} ${"word ".repeat(30).trim()}`));
    expectSameAsFresh(doc(anchoring(12), ...rest), doc(anchoring(60), ...rest));
  });

  it("is as tall as a fresh one without pages", () => {
    expectSameAsFresh(doc(p("x"), a, b, c, d), doc(p("y"), a, b, c, d), defaultPagelessConfig);
  });

  it("still copies an unchanged tail instead of building it again", () => {
    const t = table();
    const [previous, reused] = inTurn([doc(t, p("x"), a, b, c), doc(t, p("y"), a, b, c)]);
    const last = previous?.pages[0]?.blocks.at(-1);
    expect(last?.node).toBe(c);
    expect(reused?.pages[0]?.blocks.at(-1)).toBe(last);
  });

  it("does not reach past a cutoff, where nothing was measured", () => {
    const cached = { ...optionsFor(defaultPageConfig), measureCache: new WeakMap<Node, MeasureCacheEntry>() };
    const one = item("one");
    const previousLayout = runPipeline(doc(p("x"), a, b, numbered(1, one)), cached);
    const after = doc(p("y"), a, b, numbered(5, one));
    const partial = runPipeline(after, { ...cached, previousLayout, previousVersion: previousLayout.version, maxBlocks: 2 });

    expect(partial.isPartial).toBe(true);
    expect(partial.pages.flatMap((page) => page.blocks).map((block) => block.node.textContent)).toEqual(["y", "A"]);
  });

  it("equals a fresh one: a paragraph that splits at another line, its last part starting where it did", () => {
    const long = p("word ".repeat(1200).trim());
    expectSameAsFresh(doc(p("x"), long, c), doc(p("word ".repeat(40).trim()), long, c));
  });
});

describe("a layout that moves the tail it reuses", () => {
  it("moves both parts of a paragraph that splits across pages", () => {
    const long = p("word ".repeat(1200).trim());
    const [before, after] = [doc(p("x"), a, long), doc(p("xy"), a, long)];
    expect(fresh(before).pages.length).toBeGreaterThan(1);
    expectSameAsFresh(before, after);
  });

  it("moves the line breaks in a paragraph", () => {
    const broken = p("one", schema.node("hardBreak"), schema.text("two"));
    expectSameAsFresh(doc(p("x"), a, broken), doc(p("xy"), a, broken));
  });
});

describe("a layout after one that reused its tail", () => {
  it("maps the text to where it now is, when this edit moves the blocks below", () => {
    // One more letter, nothing moves on the page: the tail is copied. Then a
    // new paragraph above: every block below is placed again.
    const docs = [doc(p("x"), a, b, c), doc(p("xy"), a, b, c), doc(p("xy"), p("new"), a, b, c)];
    const moved = inTurn(docs)[2];
    expect(moved && placed(moved)).toEqual(placed(fresh(doc(p("xy"), p("new"), a, b, c))));
  });

  it("maps a later paragraph to its own position after typing a letter and then Enter", () => {
    const editor = createTestEditor({ extensions, content: { type: "doc", content: ["first", "second", "third"].map(paragraphJson) } });
    editor.ensureLayout();
    editor.applyTransaction(editor.getState().tr.insertText("!", 6));
    editor.ensureLayout();
    editor.applyTransaction(editor.getState().tr.split(7));
    editor.ensureLayout();

    const third = editor.layout.pages[0]?.blocks.at(-1);
    expect(third?.node.textContent).toBe("third");
    expect(third?.lines[0]?.spans[0]?.docPos).toBe((third?.nodePos ?? 0) + 1);
    editor.destroy();
  });
});

describe("a block that moved down the document", () => {
  it("keeps the click at the end of a Shift+Enter line in that line", () => {
    const editor = createTestEditor({
      extensions,
      content: { type: "doc", content: [paragraphJson("first"), { type: "paragraph", content: [{ type: "text", text: "one" }, { type: "hardBreak" }, { type: "text", text: "two" }] }] },
    });
    editor.ensureLayout();
    // Typed letter by letter, the paragraph below keeps its measurement and only moves.
    for (const letter of "!!!!") {
      editor.applyTransaction(editor.getState().tr.insertText(letter, 6));
      editor.ensureLayout();
    }
    editor.ensurePagePopulated(1);

    const block = editor.layout.pages[0]?.blocks[1];
    const lineHeight = block?.lines[0]?.lineHeight ?? 0;
    const clicked = editor.charMap.posAtCoords((block?.x ?? 0) + 300, (block?.y ?? 0) + lineHeight / 2, 1);
    const breakPos = (block?.nodePos ?? 0) + 1 + "one".length;
    expect([breakPos, breakPos + 1]).toContain(clicked);
    editor.destroy();
  });
});

describe("deleting a block in an editor with a table", () => {
  it("takes the block off the page", () => {
    const editor = createTestEditor({
      extensions,
      content: { type: "doc", content: [table().toJSON(), ...["A", "B", "C"].map(paragraphJson)] },
    });
    const { doc: before, tr } = editor.getState();
    before.forEach((node, offset) => {
      if (node.textContent === "B") tr.delete(offset, offset + node.nodeSize);
    });

    editor.applyTransaction(tr);
    editor.ensureLayout();

    expect(editor.layout.pages.flatMap((page) => page.blocks).map((block) => block.node.textContent)).toEqual(["cell", "A", "C"]);
    editor.destroy();
  });
});
