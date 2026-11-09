/**
 * Which blocks a reader can jump to belongs to their extensions. This one is
 * written only against the public surface: a chapter title that declares its
 * own outline level, beside the built-in headings.
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
    return { chapter: { group: "block", content: "inline*", toDOM: () => ["h1", 0] } };
  },
  addExports() {
    return {
      pdf: {
        nodes: { chapter: (block, ctx) => ctx.draw.lines(block, ctx) },
        outline: { chapter: () => 1 },
      },
    };
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
});
