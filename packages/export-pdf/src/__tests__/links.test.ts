/**
 * A link that only looks like a link is a rendering of a link. These assert
 * the exported PDF carries real annotations a reader can click.
 */

import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFHexString } from "pdf-lib";
import { buildPdf as buildPdfWithEditor } from "../index";
import { exportEditor, textLine, block, onePage } from "./fixtures";
import type { DocumentLayout, LayoutLine } from "@scrivr/core";

const buildPdf = (layout: DocumentLayout) =>
  buildPdfWithEditor(layout, exportEditor);

interface Link {
  uri: string;
  rect: number[];
}

/** Read every link annotation out of a finished PDF, page by page. */
async function linksIn(bytes: Uint8Array): Promise<Link[]> {
  const doc = await PDFDocument.load(bytes);
  const out: Link[] = [];
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict)) continue;
      if (annot.lookup(PDFName.of("Subtype")) !== PDFName.of("Link")) continue;
      const action = annot.lookup(PDFName.of("A"));
      const uri = action instanceof PDFDict ? action.lookup(PDFName.of("URI")) : undefined;
      const rect = annot.lookup(PDFName.of("Rect"));
      out.push({
        uri: uri instanceof PDFString || uri instanceof PDFHexString ? uri.decodeText() : "",
        rect: rect instanceof PDFArray ? rect.asArray().map((n) => Number(n.toString())) : [],
      });
    }
  }
  return out;
}

const linkMark = (href: string) => [{ name: "link", attrs: { href } }];

const oneLink = (href: string) =>
  onePage([block("paragraph", [textLine("click me", { marks: linkMark(href) })], { y: 100 })]);

describe("link annotations", () => {
  it.each([
    ["https://example.com/a)b", "https://example.com/a)b"],
    ["https://example.com/a(b", "https://example.com/a(b"],
    ["https://example.com/a\\b", "https://example.com/a\\b"],
    ["https://example.com/東京", "https://example.com/%E6%9D%B1%E4%BA%AC"],
    ["https://example.com/%E6%9D%B1?q=a%20b&next=/c#part", "https://example.com/%E6%9D%B1?q=a%20b&next=/c#part"],
  ])("round-trips the URI %s", async (href, expected) => {
    const links = await linksIn(await buildPdf(oneLink(href)));
    expect(links).toHaveLength(1);
    expect(links[0]!.uri).toBe(expected);
  });

  it("emits a clickable annotation for a link mark", async () => {
    const links = await linksIn(await buildPdf(oneLink("https://example.com/a")));
    expect(links).toHaveLength(1);
    expect(links[0]!.uri).toBe("https://example.com/a");
  });

  it("gives the annotation the extent of the linked text", async () => {
    const links = await linksIn(await buildPdf(oneLink("https://example.com")));
    const [x0, y0, x1, y1] = links[0]!.rect;
    expect(x1).toBeGreaterThan(x0!);
    expect(y1).toBeGreaterThan(y0!);
    // Sits inside the page, not at the origin.
    expect(x0).toBeGreaterThan(0);
    expect(y0).toBeGreaterThan(0);
  });

  it("emits nothing for unlinked text", async () => {
    const layout = onePage([block("paragraph", [textLine("plain")], { y: 100 })]);
    expect(await linksIn(await buildPdf(layout))).toEqual([]);
  });

  it("refuses a javascript: href", async () => {
    // eslint-disable-next-line no-script-url
    expect(await linksIn(await buildPdf(oneLink("javascript:alert(1)")))).toEqual([]);
  });

  it("merges spans of one anchor into a single annotation", async () => {
    // Same href, split across spans the way a bolded word inside a link is.
    const href = "https://example.com";
    const line: LayoutLine = {
      spans: [
        { kind: "text", text: "one ", font: "16px Helvetica", x: 0, width: 40, docPos: 0, marks: linkMark(href) },
        { kind: "text", text: "two", font: "bold 16px Helvetica", x: 40, width: 40, docPos: 4, marks: linkMark(href) },
      ],
      width: 80,
      lineHeight: 24,
      ascent: 18,
      descent: 6,
      cursorHeight: 20,
      textAscent: 18,
      xHeight: 8,
    };
    const links = await linksIn(
      await buildPdf(onePage([block("paragraph", [line], { y: 100 })])),
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.rect[2]! - links[0]!.rect[0]!).toBeGreaterThan(50);
  });

  it("splits two different targets on one line", async () => {
    const line: LayoutLine = {
      spans: [
        { kind: "text", text: "aa", font: "16px Helvetica", x: 0, width: 20, docPos: 0, marks: linkMark("https://a.example") },
        { kind: "text", text: "bb", font: "16px Helvetica", x: 20, width: 20, docPos: 2, marks: linkMark("https://b.example") },
      ],
      width: 40,
      lineHeight: 24,
      ascent: 18,
      descent: 6,
      cursorHeight: 20,
      textAscent: 18,
      xHeight: 8,
    };
    const links = await linksIn(
      await buildPdf(onePage([block("paragraph", [line], { y: 100 })])),
    );
    expect(links.map((l) => l.uri).sort()).toEqual(["https://a.example", "https://b.example"]);
  });

  it("annotates each line of a link that wrapped", async () => {
    const href = "https://example.com";
    const wrapped = block(
      "paragraph",
      [
        textLine("first half", { marks: linkMark(href) }),
        textLine("second half", { marks: linkMark(href) }),
      ],
      { y: 100 },
    );
    const links = await linksIn(await buildPdf(onePage([wrapped])));
    expect(links).toHaveLength(2);
    expect(links[0]!.rect[1]).not.toBe(links[1]!.rect[1]);
  });
});
