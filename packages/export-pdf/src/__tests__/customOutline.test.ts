/**
 * Which blocks a reader can jump to belongs to their extensions. This one is
 * written only against the public surface: a chapter title that declares its
 * own outline level on its spec, beside the built-in headings.
 */
import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDict, PDFDocument, PDFHexString, PDFName } from "pdf-lib";
import { Extension, ExtensionManager, ServerEditor, StarterKit, TextMeasurer, runPipeline, type TextMeasureContext } from "@scrivr/core";
import { buildPdf } from "../index";
import { PAGE_CONFIG } from "./fixtures";

const Chapter = Extension.create({
  name: "chapter",
  addNodes() {
    return { chapter: { group: "block", content: "inline*", outlineLevel: () => 1, toDOM: () => ["h1", 0] } };
  },
  addExports() {
    return { pdf: { nodes: { chapter: (block, ctx) => ctx.draw.lines(block, ctx) } } };
  },
});

/** Skia's context supplies the two members a measurer reads. */
function measureContext(ctx: { font: string; measureText: (text: string) => TextMetrics }): TextMeasureContext {
  return ctx;
}

type Entry = { title: string; children: Entry[] };

/** The outline as a viewer walks it: title, and the entries nested beneath it. */
function readOutline(pdfDoc: PDFDocument): Entry[] {
  const walk = (parent: PDFDict): Entry[] => {
    const entries: Entry[] = [];
    let current = parent.lookupMaybe(PDFName.of("First"), PDFDict);
    while (current) {
      const title = current.lookup(PDFName.of("Title"));
      entries.push({ title: title instanceof PDFHexString ? title.decodeText() : String(title), children: walk(current) });
      current = current.lookupMaybe(PDFName.of("Next"), PDFDict);
    }
    return entries;
  };
  const root = pdfDoc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  return root ? walk(root) : [];
}

function outlineOf(extensions: Extension[], content: unknown[]): Promise<Entry[]> {
  const editor = new ServerEditor({ extensions });
  const doc = editor.schema.nodeFromJSON({ type: "doc", content });
  const measurer = new TextMeasurer({ context: measureContext(createCanvas(800, 600).getContext("2d")) });
  const layout = runPipeline(doc, { pageConfig: PAGE_CONFIG, measurer, fontConfig: new ExtensionManager(extensions).buildBlockStyles() });
  return buildPdf(layout, editor).then(async (bytes) => readOutline(await PDFDocument.load(bytes)));
}

const titled = (type: string, text: string, attrs: Record<string, unknown> = {}) => ({ type, attrs, content: [{ type: "text", text }] });

describe("an outline block from outside core", () => {
  it("is bookmarked at the level its extension declares, with headings nested beneath it", async () => {
    const extensions = [StarterKit, Chapter];
    const editor = new ServerEditor({ extensions });
    const doc = editor.schema.nodeFromJSON({ type: "doc", content: [
      { type: "chapter", content: [{ type: "text", text: "Chapter One" }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Opening" }] },
      { type: "paragraph", content: [{ type: "text", text: "Body" }] },
    ] });
    const measurer = new TextMeasurer({ context: measureContext(createCanvas(800, 600).getContext("2d")) });
    const layout = runPipeline(doc, { pageConfig: PAGE_CONFIG, measurer, fontConfig: new ExtensionManager(extensions).buildBlockStyles() });

    const pdf = await PDFDocument.load(await buildPdf(layout, editor));
    expect(readOutline(pdf)).toEqual([{ title: "Chapter One", children: [{ title: "Opening", children: [] }] }]);
  });

  it("leaves out a block whose declared level is not a number, keeping the rest in order", async () => {
    const Untitled = Extension.create({
      name: "untitled",
      addNodes() {
        return { untitled: { group: "block", content: "inline*", outlineLevel: () => Number.NaN, toDOM: () => ["p", 0] } };
      },
      addExports() {
        return { pdf: { nodes: { untitled: (block, ctx) => ctx.draw.lines(block, ctx) } } };
      },
    });
    expect(await outlineOf([StarterKit, Untitled], [
      titled("heading", "One", { level: 1 }),
      titled("untitled", "Stray"),
      titled("heading", "Two", { level: 1 }),
    ])).toEqual([{ title: "One", children: [] }, { title: "Two", children: [] }]);
  });

  it("nests a heading deeper than the configured levels by its own level", async () => {
    expect(await outlineOf([StarterKit.configure({ heading: { levels: [1, 2, 3] } })], [
      titled("heading", "Section", { level: 2 }),
      titled("heading", "Detail", { level: 4 }),
      titled("heading", "Next", { level: 2 }),
    ])).toEqual([
      { title: "Section", children: [{ title: "Detail", children: [] }] },
      { title: "Next", children: [] },
    ]);
  });

  it("leaves out a heading whose text the proposed view removes, as the semantic outline does", async () => {
    // A mark the proposed view leaves out, as a tracked deletion is; declared
    // on the semantic lane, which says what the proposed view removes.
    const Struck = Extension.create({
      name: "struck",
      addMarks() {
        return { struck: { toDOM: () => ["s", 0] } };
      },
      addExports() {
        const lanes = { pdf: {}, semantic: { isRemoved: (node: { marks: readonly { type: { name: string } }[] }) => node.marks.some((mark) => mark.type.name === "struck") } };
        return lanes;
      },
    });
    expect(await outlineOf([StarterKit, Struck], [
      titled("heading", "One", { level: 1 }),
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Gone", marks: [{ type: "struck" }] }] },
      titled("heading", "Two", { level: 2 }),
    ])).toEqual([{ title: "One", children: [{ title: "Two", children: [] }] }]);
  });
});
