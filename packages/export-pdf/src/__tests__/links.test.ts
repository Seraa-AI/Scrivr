/**
 * A link that only looks like a link is a rendering of a link. These assert
 * the exported PDF carries real annotations a reader can click.
 */

import { describe, it, expect } from "vitest";
import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFString,
  PDFHexString,
  PDFNumber,
} from "pdf-lib";
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
        rect:
          rect instanceof PDFArray
            ? rect.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : NaN))
            : [],
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
    ["https://example.com/a b", "https://example.com/a%20b"],
    ["https://example.com/東京", "https://example.com/%E6%9D%B1%E4%BA%AC"],
    ["https://example.com/%E6%9D%B1?q=a%20b&next=/c#part", "https://example.com/%E6%9D%B1?q=a%20b&next=/c#part"],
  ])("round-trips the URI %s", async (href, expected) => {
    const links = await linksIn(await buildPdf(oneLink(href)));
    expect(links).toHaveLength(1);
    expect(links[0]!.uri).toBe(expected);
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

  it("follows mailto: and tel:", async () => {
    expect((await linksIn(await buildPdf(oneLink("mailto:a@b.com"))))[0]?.uri).toBe(
      "mailto:a@b.com",
    );
    expect((await linksIn(await buildPdf(oneLink("tel:+15551234"))))[0]?.uri).toBe(
      "tel:+15551234",
    );
  });

  // A downloaded PDF has no base URL, so these resolve to nothing. An
  // annotation over them would put a hand cursor on text that does not
  // navigate — worse than leaving the text merely styled.
  it.each(["#section-2", "/about", "foo.html", "//cdn.example/x"])(
    "emits no annotation for the unresolvable target %s",
    async (href) => {
      expect(await linksIn(await buildPdf(oneLink(href)))).toEqual([]);
    },
  );

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

  it("sizes the hit area to the text, not to a line an image inflated", async () => {
    // A baseline-aligned inline object taller than the text inflates
    // `line.ascent`; the link's clickable box must still be the text's.
    const linked = { name: "link", attrs: { href: "https://example.com" } };
    const inflated: LayoutLine = {
      spans: [
        { kind: "text", text: "link", font: "16px Helvetica", x: 0, width: 40, docPos: 0, marks: [linked] },
      ],
      width: 40,
      lineHeight: 120,
      ascent: 100, // an image on this line pushed the line box up
      descent: 6,
      cursorHeight: 20,
      textAscent: 18,
      xHeight: 8,
    };
    const links = await linksIn(
      await buildPdf(onePage([block("paragraph", [inflated], { y: 100 })])),
    );
    const height = links[0]!.rect[3]! - links[0]!.rect[1]!;
    // (textAscent 18 + descent 6) * 0.75 pt/px — not (100 + 6) * 0.75.
    expect(height).toBeCloseTo(18, 5);
  });

  it("does not span the hole a float leaves in a line", async () => {
    // A float splits a line into segments, so link text either side of it
    // arrives as two spans with a gap between. Joining them would put a hit
    // area over the image sitting in the gap.
    const href = "https://example.com";
    const linked = { name: "link", attrs: { href } };
    const segmented: LayoutLine = {
      spans: [
        { kind: "text", text: "left", font: "16px Helvetica", x: 0, width: 60, docPos: 0, marks: [linked] },
        // 200px of float sits between; the next segment starts well past it.
        { kind: "text", text: "right", font: "16px Helvetica", x: 260, width: 60, docPos: 5, marks: [linked] },
      ],
      width: 320,
      lineHeight: 24,
      ascent: 18,
      descent: 6,
      cursorHeight: 20,
      textAscent: 18,
      xHeight: 8,
    };
    const links = await linksIn(
      await buildPdf(onePage([block("paragraph", [segmented], { y: 100 })])),
    );
    expect(links).toHaveLength(2);
    // Neither rectangle reaches across the gap.
    for (const link of links) {
      expect(link.rect[2]! - link.rect[0]!).toBeLessThan(60);
    }
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
