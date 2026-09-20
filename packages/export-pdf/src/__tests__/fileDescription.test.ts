/**
 * What the file says about itself, and how a reader gets around it.
 *
 * Both are invisible on the page and easy to leave out — which is how an
 * eleven-page agreement ends up known to every viewer, search index and
 * document system by its filename alone, with no way through it but scrolling.
 */

import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString } from "pdf-lib";
import { buildPdf } from "../index";
import { block, onePage, textLine, exportEditor, schema, PAGE_CONFIG } from "./fixtures";
import type { DocumentLayout } from "@scrivr/core";

/** A layout of headings at the given levels, one per page after the first. */
function outlineLayout(levels: readonly { level: number; text: string }[]): DocumentLayout {
  const pages = levels.map((heading, index) => ({
    pageNumber: index + 1,
    blocks: [
      {
        // The fixture builds empty nodes; an outline is made of heading text,
        // so the node carries its own.
        ...block("heading", [textLine(heading.text)]),
        node: schema.node("heading", { level: heading.level }, schema.text(heading.text)),
      },
    ],
  }));
  return { pages, pageConfig: PAGE_CONFIG } as unknown as DocumentLayout;
}

const FIXED_DATE = new Date("2026-01-02T03:04:05Z");

describe("the file's own description", () => {
  it("records the title and author it was given", async () => {
    const pdf = await buildPdf(outlineLayout([{ level: 1, text: "Agreement" }]), exportEditor, {
      metadata: { title: "Matter 4417 — executed", author: "Scrivr", date: FIXED_DATE },
    });
    const loaded = await PDFDocument.load(pdf);
    expect(loaded.getTitle()).toBe("Matter 4417 — executed");
    expect(loaded.getAuthor()).toBe("Scrivr");
  });

  it("guesses no title when it was given none", async () => {
    // A heading is not the document's name. "1. Definitions" as the title of
    // an agreement is worse in a search index than no title at all, so the
    // only titles written are the ones a caller supplies.
    const pdf = await buildPdf(outlineLayout([{ level: 1, text: "1. Definitions" }]), exportEditor, {
      metadata: { date: FIXED_DATE },
    });
    expect((await PDFDocument.load(pdf)).getTitle()).toBeUndefined();
  });

  it("names the application it was authored in", async () => {
    const pdf = await buildPdf(onePage([block("paragraph", [textLine("Body")])]), exportEditor, {
      metadata: { date: FIXED_DATE },
    });
    const loaded = await PDFDocument.load(pdf);
    expect(loaded.getCreator()).toBe("Scrivr");
    expect(loaded.getCreationDate()?.toISOString()).toBe(FIXED_DATE.toISOString());
  });
});

/** The outline as a viewer walks it: title, and the titles nested beneath it. */
function readOutline(pdfDoc: PDFDocument): { title: string; children: unknown[] }[] {
  const outlines = pdfDoc.catalog.lookup(PDFName.of("Outlines"), PDFDict);
  const walk = (firstKey: PDFDict): { title: string; children: unknown[] }[] => {
    const items: { title: string; children: unknown[] }[] = [];
    let current: PDFDict | undefined = firstKey.lookup(PDFName.of("First"), PDFDict);
    while (current) {
      const title = current.lookup(PDFName.of("Title"));
      const first = current.lookupMaybe(PDFName.of("First"), PDFDict);
      items.push({
        title: title instanceof PDFHexString ? title.decodeText() : String(title),
        children: first ? walk(current) : [],
      });
      current = current.lookupMaybe(PDFName.of("Next"), PDFDict);
    }
    return items;
  };
  return walk(outlines);
}

describe("bookmarks built from headings", () => {
  it("nests a heading under the nearest shallower one before it", async () => {
    const pdf = await buildPdf(
      outlineLayout([
        { level: 1, text: "Agreement" },
        { level: 2, text: "Definitions" },
        { level: 3, text: "Affiliate" },
        { level: 2, text: "Orders" },
        { level: 1, text: "Schedules" },
      ]),
      exportEditor,
      { metadata: { date: FIXED_DATE } },
    );
    const outline = readOutline(await PDFDocument.load(pdf));

    expect(outline.map((i) => i.title)).toEqual(["Agreement", "Schedules"]);
    expect(outline[0]?.children).toHaveLength(2);
  });

  it("points each bookmark at the page its heading is on", async () => {
    const pdf = await buildPdf(
      outlineLayout([
        { level: 1, text: "First" },
        { level: 1, text: "Second" },
      ]),
      exportEditor,
      { metadata: { date: FIXED_DATE } },
    );
    const loaded = await PDFDocument.load(pdf);
    const outlines = loaded.catalog.lookup(PDFName.of("Outlines"), PDFDict);
    const second = outlines
      .lookup(PDFName.of("First"), PDFDict)
      .lookup(PDFName.of("Next"), PDFDict)
      .lookup(PDFName.of("Dest"), PDFArray);

    // A destination leads with the page object it jumps to.
    expect(String(second.get(0))).toBe(String(loaded.getPage(1).ref));
  });

  it("writes no outline for a document with no headings", async () => {
    const pdf = await buildPdf(onePage([block("paragraph", [textLine("Body")])]), exportEditor, {
      metadata: { date: FIXED_DATE },
    });
    const loaded = await PDFDocument.load(pdf);
    expect(loaded.catalog.has(PDFName.of("Outlines"))).toBe(false);
  });

  it("leaves the outline out when the caller turns it off", async () => {
    const layout = outlineLayout([{ level: 1, text: "Agreement" }]);
    const withOutline = await PDFDocument.load(
      await buildPdf(layout, exportEditor, { metadata: { date: FIXED_DATE } }),
    );
    const without = await PDFDocument.load(
      await buildPdf(layout, exportEditor, { outline: false, metadata: { date: FIXED_DATE } }),
    );

    // Both directions, so this cannot pass by the outline never being built.
    expect(withOutline.catalog.has(PDFName.of("Outlines"))).toBe(true);
    expect(without.catalog.has(PDFName.of("Outlines"))).toBe(false);
  });
});
