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
import { defaultPageConfig, runPipeline, type DocumentLayout, type MeasureCacheEntry } from "./PageLayout";

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
            enter: (node: Node) => ({ as: node.attrs["as"] }),
            place: (_node: Node, _index: number, scope: Record<string, unknown>) => ({ indent: 0, styleKey: String(scope["as"]) }),
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
const p = (text: string): Node => schema.node("paragraph", null, [schema.text(text)]);
const pageBreak = (): Node => schema.node("pageBreak");
const sectionBreak = (breakType: string): Node =>
  schema.node("sectionBreak", { settings: { breakType, columns: { count: 1, gap: 24, equalWidth: true } } });
const list = (...items: Node[]): Node => schema.node("bulletList", null, items);
const item = (text: string): Node => schema.node("listItem", null, [p(text)]);
/** A table is never in the measure cache, so every layout of one measures something. */
const table = (): Node =>
  schema.node("table", { grid: [100] }, [
    schema.node("tableRow", null, [schema.node("tableCell", null, [p("cell")])]),
  ]);

/** Every block on every page: what it is, where it is, and where its text maps to. */
const placed = (layout: DocumentLayout) =>
  layout.pages.map((page) =>
    page.blocks.map((block) => ({
      text: block.node.textContent,
      nodePos: block.nodePos,
      sourceNodePos: block.sourceNodePos,
      y: block.y,
      spans: block.lines.flatMap((line) => line.spans.map((span) => span.docPos)),
    })),
  );

/** `after` laid out on top of `before`'s layout, and on its own. */
function relayout(before: Node, after: Node): { previous: DocumentLayout; reused: DocumentLayout; fresh: DocumentLayout } {
  const options = { pageConfig: defaultPageConfig, fontConfig, measurer };
  const cached = { ...options, measureCache: new WeakMap<Node, MeasureCacheEntry>() };
  const previous = runPipeline(before, cached);
  return {
    previous,
    reused: runPipeline(after, { ...cached, previousLayout: previous, previousVersion: previous.version }),
    fresh: runPipeline(after, options),
  };
}

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
  ])("equals a fresh one: %s", (_name, before, after) => {
    const { reused, fresh } = relayout(before, after);
    expect(placed(reused)).toEqual(placed(fresh));
  });

  it("equals a fresh one: a section break that stops moving the flow", () => {
    const t = table();
    const { reused, fresh } = relayout(
      doc(t, a, sectionBreak("nextPage"), b),
      doc(t, a, sectionBreak("continuous"), b),
    );
    expect(placed(reused)).toEqual(placed(fresh));
  });

  it("equals a fresh one: a list split in two, which moves the positions after it", () => {
    const t = table();
    const [one, two, three] = [item("one"), item("two"), item("three")];
    const { reused, fresh } = relayout(doc(t, list(one, two, three), d), doc(t, list(one, two), list(three), d));
    expect(placed(reused)).toEqual(placed(fresh));
  });

  it("equals a fresh one: a wrapper that restyles the block it holds", () => {
    // The block is the same node at the same width, so its measurement is still
    // good; only the space it keeps comes from the wrapper.
    const t = table();
    const { reused, fresh } = relayout(
      doc(t, a, schema.node("restyled", { as: "heading_1" }, [b]), c),
      doc(t, a, schema.node("restyled", { as: "paragraph" }, [b]), c),
    );
    expect(placed(reused)).toEqual(placed(fresh));
  });

  it("still copies an unchanged tail instead of building it again", () => {
    const t = table();
    const { previous, reused } = relayout(doc(t, p("x"), a, b, c), doc(t, p("y"), a, b, c));
    const last = previous.pages[0]?.blocks.at(-1);
    expect(last?.node).toBe(c);
    expect(reused.pages[0]?.blocks.at(-1)).toBe(last);
  });
});

describe("a layout that moves the tail it reuses", () => {
  it("moves both parts of a paragraph that splits across pages", () => {
    const long = p("word ".repeat(1200).trim());
    const { previous, reused, fresh } = relayout(doc(p("x"), a, long), doc(p("xy"), a, long));
    expect(previous.pages.length).toBeGreaterThan(1);
    expect(reused.pages.at(-1)?.blocks.at(-1)?.node).toBe(long);
    expect(placed(reused)).toEqual(placed(fresh));
  });
});

describe("a layout after one that reused its tail", () => {
  it("maps the text to where it now is, when this edit moves the blocks below", () => {
    const options = { pageConfig: defaultPageConfig, fontConfig, measurer };
    const cached = { ...options, measureCache: new WeakMap<Node, MeasureCacheEntry>() };
    const typed = runPipeline(doc(p("x"), a, b, c), cached);
    // One more letter, nothing moves on the page: the tail is copied.
    const reused = runPipeline(doc(p("xy"), a, b, c), { ...cached, previousLayout: typed, previousVersion: typed.version });
    // A new paragraph above: every block below is placed again.
    const after = doc(p("xy"), p("new"), a, b, c);
    const moved = runPipeline(after, { ...cached, previousLayout: reused, previousVersion: reused.version });

    expect(placed(moved)).toEqual(placed(runPipeline(after, options)));
  });

  it("puts the caret in the right place after typing a letter and then Enter", () => {
    const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const editor = createTestEditor({
      extensions,
      content: { type: "doc", content: ["first", "second", "third"].map(paragraph) },
    });
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

describe("deleting a block in an editor with a table", () => {
  it("takes the block off the page", () => {
    const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const editor = createTestEditor({
      extensions,
      content: { type: "doc", content: [table().toJSON(), paragraph("A"), paragraph("B"), paragraph("C")] },
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
