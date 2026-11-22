/**
 * The report a real export or import returns.
 *
 * A converter with every StarterKit handler keeps a plain document whole, so
 * these tests build what it cannot keep — a node nobody exports, an element the
 * parser has no reading for, a run property nobody claims — and check that
 * each loss is counted and named.
 *
 * They import from the package entry, as a consumer does, so a re-export that
 * goes missing fails here.
 */

import { describe, it, expect } from "vitest";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import {
  Extension,
  Field,
  ServerEditor,
  SourcedBlockExtension,
  StarterKit,
  type FormatContribution,
} from "@scrivr/core";
import {
  HANDLER_RETURNED_NOTHING,
  NO_HANDLER,
  NO_PARSER,
  OVERRIDES_OWNER,
  LEFT_OUT,
  PART_UNREADABLE,
  WRAPPER_DECLINED,
  exportDocx,
  exportDocxBytes,
  importDocx,
  insideDropped,
  noSchemaNode,
  walkDocument,
  xml,
  type DocxReport,
  type DocxReportCount,
  type DocxReportEntry,
  type DocxReporter,
  type DocxUnreadElement,
  type HandlerOwner,
  type WalkerHandlerOwners,
  type WalkerHandlers,
} from "./index";

const UnhandledNode = Extension.create({
  name: "unhandledNode",
  addNodes() {
    return {
      unhandledNode: {
        group: "block",
        content: "inline*",
        toDOM: () => ["div"],
        parseDOM: [{ tag: "div.unhandled" }],
      },
    };
  },
});

/** Reports through `ctx.report` from both a handler and a hook, as an extension would. */
const Callout = Extension.create({
  name: "callout",
  addNodes() {
    return {
      callout: {
        group: "block",
        content: "inline*",
        toDOM: () => ["aside"],
        parseDOM: [{ tag: "aside" }],
      },
    };
  },
  addExports() {
    return {
      docx: {
        nodes: {
          callout: (_node, children, ctx) => {
            ctx.report.changed("callout", "exported as a plain paragraph");
            return xml("w:p", undefined, children);
          },
        },
        onBeforeExport(ctx) {
          ctx.report.dropped("calloutIcon", "Word has no callout icon");
        },
      },
    };
  },
});

/** A mark whose only DOCX handler wraps its runs, the way a hyperlink's does. */
const Stamp = Extension.create({
  name: "stamp",
  addMarks() {
    return { stamp: { toDOM: () => ["span", { class: "stamp" }, 0] } };
  },
  addExports() {
    return {
      docx: { markWrappers: { stamp: (runs) => xml("w:customXml", undefined, [...runs]) } },
    };
  },
});

function paragraphDoc(editor: ServerEditor): void {
  editor.setContent({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "plain " },
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "hardBreak" },
          { type: "text", text: "after the break" },
        ],
      },
      { type: "pageBreak" },
      { type: "paragraph", content: [{ type: "text", text: "second page" }] },
    ],
  });
}

function markedDoc(editor: ServerEditor, mark: Record<string, unknown>): void {
  editor.setContent({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "site", marks: [mark] }] }],
  });
}

/** An exported document with `body` spliced in before its sectPr. */
async function docWithBody(body: string): Promise<Uint8Array> {
  const bytes = await exportDocxBytes(new ServerEditor({ content: "anchor" }));
  const entries = unzipSync(bytes);
  const original = strFromU8(entries["word/document.xml"]!);
  entries["word/document.xml"] = strToU8(original.replace("<w:sectPr", body + "<w:sectPr"));
  return zipSync(entries);
}

/**
 * An exported document with a default header reading `text`. `part` replaces
 * the header part's XML, or `null` leaves the part out of the package.
 */
async function docWithHeader(text: string, part?: string | null): Promise<Uint8Array> {
  const entries = unzipSync(await exportDocxBytes(new ServerEditor({ content: "body" })));
  const document = strFromU8(entries["word/document.xml"]!);
  entries["word/document.xml"] = strToU8(
    document.replace("<w:sectPr>", '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1"/>'),
  );
  const rels = strFromU8(entries["word/_rels/document.xml.rels"]!);
  entries["word/_rels/document.xml.rels"] = strToU8(
    rels.replace(
      "</Relationships>",
      '<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>',
    ),
  );
  const header = `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:hdr>`;
  if (part !== null) entries["word/header1.xml"] = strToU8(part ?? header);
  return zipSync(entries);
}

/** Walks every header and footer reference, as a header/footer extension does. */
const PartReader = Extension.create({
  name: "partReader",
  addImports() {
    return {
      docx: {
        onImportComplete(doc, ctx) {
          for (const { relId } of [...ctx.section.headers, ...ctx.section.footers]) ctx.walkPart(relId);
          return doc;
        },
      },
    };
  },
});

function dropsOf(report: DocxReport): DocxReportEntry[] {
  return report.entries.filter((entry) => entry.outcome === "dropped");
}

describe("exportDocx — report", () => {
  it("counts what a plain document carried across, with nothing dropped", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit] });
    paragraphDoc(editor);
    const { report } = await exportDocx(editor);

    expect(report.counts["paragraph"]?.kept).toBe(2);
    expect(report.counts["hardBreak"]?.kept).toBe(1);
    expect(report.counts["pageBreak"]?.kept).toBe(1);
    expect(report.counts["bold"]?.kept).toBe(1);
    expect(report.counts["text"]?.kept).toBe(4);
    expect(report.entries).toEqual([]);
  });

  it("records a node with no handler as dropped, owned by nobody", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit, UnhandledNode] });
    editor.setContent({
      type: "doc",
      content: [{ type: "unhandledNode", content: [{ type: "text", text: "x" }] }],
    });
    const { report, diagnostics } = await exportDocx(editor);

    expect(report.entries).toEqual([
      { outcome: "dropped", kind: "unhandledNode", reason: "no handler", owner: null, count: 1 },
    ]);
    // The report adds to the diagnostics; it does not replace them.
    expect(diagnostics.some((d) => d.code === "unsupported-node")).toBe(true);
    // The "drop" policy bubbles the text up, so it still crossed.
    expect(report.counts["text"]?.kept).toBe(1);
  });

  it("records the text a placeholder stands in for as dropped with its node", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit, UnhandledNode] });
    editor.setContent({
      type: "doc",
      content: [{ type: "unhandledNode", content: [{ type: "text", text: "x" }] }],
    });
    const { report } = await exportDocx(editor, { unsupported: "placeholder" });

    expect(report.counts["text"]).toEqual({ kept: 0, dropped: 1, changed: 0 });
    expect(report.entries).toContainEqual({
      outcome: "dropped",
      kind: "text",
      reason: "inside a unhandledNode that was dropped",
      owner: null,
      count: 1,
    });
  });

  it("names the extension behind a handler's or a hook's own entries", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit, Callout] });
    editor.setContent({
      type: "doc",
      content: [{ type: "callout", content: [{ type: "text", text: "note" }] }],
    });
    const { report } = await exportDocx(editor);

    expect(report.entries).toEqual([
      {
        outcome: "dropped",
        kind: "calloutIcon",
        reason: "Word has no callout icon",
        owner: "callout",
        count: 1,
      },
      {
        outcome: "changed",
        kind: "callout",
        reason: "exported as a plain paragraph",
        owner: "callout",
        count: 1,
      },
    ]);
    // A change note does not replace the kept count.
    expect(report.counts["callout"]).toEqual({ kept: 1, dropped: 0, changed: 1 });
  });

  it("owns an override's outcome as the call's, and takes the node's content with it", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit] });
    editor.setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "kept" }] },
        { type: "paragraph", content: [{ type: "text", text: "gone", marks: [{ type: "bold" }] }] },
      ],
    });
    const { report } = await exportDocx(editor, {
      overrides: {
        nodes: {
          paragraph: (node, children) =>
            node.textContent === "gone" ? [] : xml("w:p", undefined, children),
        },
      },
    });

    expect(report.counts["paragraph"]).toEqual({ kept: 1, dropped: 1, changed: 0 });
    expect(report.counts["text"]).toEqual({ kept: 1, dropped: 1, changed: 0 });
    expect(report.counts["bold"]).toEqual({ kept: 0, dropped: 1, changed: 0 });
    expect(report.entries).toEqual([
      {
        outcome: "dropped",
        kind: "paragraph",
        reason: "handler returned nothing",
        owner: "overrides",
        count: 1,
      },
      {
        outcome: "dropped",
        kind: "text",
        reason: "inside a paragraph that was dropped",
        owner: "overrides",
        count: 1,
      },
      {
        outcome: "dropped",
        kind: "bold",
        reason: "inside a paragraph that was dropped",
        owner: "overrides",
        count: 1,
      },
    ]);
  });

  it("counts a link once, under the extension whose wrapper wrote it", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit] });
    markedDoc(editor, { type: "link", attrs: { href: "https://example.com" } });
    const { report } = await exportDocx(editor);

    expect(report.counts["link"]).toEqual({ kept: 1, dropped: 0, changed: 0 });
    expect(report.entries).toEqual([]);
  });

  it("records a link its wrapper left unwrapped as dropped, under the wrapper's owner", async () => {
    // The wrapper writes the hyperlink, so its decision is the link's outcome
    // even though the property handler still styled the run.
    const editor = new ServerEditor({ extensions: [StarterKit] });
    markedDoc(editor, { type: "link", attrs: { href: "https://example.com" } });
    const { report } = await exportDocx(editor, {
      overrides: { markWrappers: { link: (run) => run } },
    });

    expect(report.counts["link"]).toEqual({ kept: 0, dropped: 1, changed: 0 });
    expect(report.entries).toEqual([
      {
        outcome: "dropped",
        kind: "link",
        reason: "wrapper left the run unwrapped",
        owner: "overrides",
        count: 1,
      },
    ]);
  });

  it("counts a mark only a wrapper carries, and does not warn that it is unsupported", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit, Stamp] });
    markedDoc(editor, { type: "stamp" });
    const { report, diagnostics } = await exportDocx(editor);

    expect(report.counts["stamp"]).toEqual({ kept: 1, dropped: 0, changed: 0 });
    expect(diagnostics.some((d) => d.code === "unsupported-mark")).toBe(false);
  });
});

describe("importDocx — report", () => {
  it("counts what a plain document carried across, in Word's vocabulary", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit] });
    paragraphDoc(editor);
    const bytes = await exportDocxBytes(editor);
    const { report } = await importDocx(new ServerEditor({ extensions: [StarterKit] }), bytes);

    expect(report.counts["paragraph"]?.kept).toBe(2);
    expect(report.counts["hardBreak"]?.kept).toBe(1);
    expect(report.counts["pageBreak"]?.kept).toBe(1);
    // Word's name for bold, as the parser reads it.
    expect(report.counts["b"]?.kept).toBeGreaterThanOrEqual(1);
    expect(dropsOf(report)).toEqual([]);
  });

  it("files a styled paragraph under the extension that claims its style", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit] });
    editor.setContent({
      type: "doc",
      content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }],
    });
    const bytes = await exportDocxBytes(editor);
    const importer = new ServerEditor({ extensions: [StarterKit] });

    const claimant = importer
      .getFormatContributions()
      .find((c: FormatContribution) => c.imports.docx?.paragraphStyles?.["Heading1"] !== undefined);
    expect(claimant?.extension).toBe("heading");

    // The style's handler decides, not the paragraph's: replacing it with one
    // that declines files the drop under the replacement.
    const { report } = await importDocx(importer, bytes, {
      overrides: { paragraphStyles: { Heading1: () => null } },
    });
    expect(report.entries).toContainEqual({
      outcome: "dropped",
      kind: "paragraph",
      reason: "handler returned nothing",
      owner: "overrides",
      count: 1,
    });
  });

  it("records an element the parser cannot read as dropped, owned by nobody", async () => {
    const bytes = await docWithBody("<w:customXml><w:p><w:r><w:t>x</w:t></w:r></w:p></w:customXml>");
    const { report } = await importDocx(new ServerEditor(), bytes);

    expect(report.entries).toContainEqual({
      outcome: "dropped",
      kind: "w:customXml",
      reason: "no parser",
      owner: null,
      count: 1,
    });
  });

  it("counts a run property nobody claims as one entry, however many runs carry it", async () => {
    const run = `<w:r><w:rPr><w:lang w:val="en-US"/></w:rPr><w:t>x</w:t></w:r>`;
    const bytes = await docWithBody(`<w:p>${run}${run}${run}</w:p>`);
    const { report, diagnostics } = await importDocx(new ServerEditor(), bytes);

    expect(report.entries.filter((e) => e.kind === "lang")).toEqual([
      { outcome: "dropped", kind: "lang", reason: "no handler", owner: null, count: 3 },
    ]);
    // Too common to warn about, but still in the inventory.
    expect(diagnostics.some((d) => d.markType === "lang")).toBe(false);
  });

  it("names the override behind a handler that built nothing, and behind a hook", async () => {
    // No extension reads `w:lang`, so nothing answers once the override declines.
    const bytes = await docWithBody(
      `<w:p><w:r><w:rPr><w:lang w:val="en-US"/></w:rPr><w:t>x</w:t></w:r></w:p>`,
    );
    const { report } = await importDocx(new ServerEditor({ extensions: [StarterKit] }), bytes, {
      overrides: {
        marks: { lang: () => null },
        onImportComplete(doc, ctx) {
          ctx.report.changed("document", "reviewed by the caller");
          return doc;
        },
      },
    });

    expect(report.entries).toContainEqual({
      outcome: "dropped",
      kind: "lang",
      reason: "handler returned nothing",
      owner: "overrides",
      count: 1,
    });
    expect(report.entries).toContainEqual({
      outcome: "changed",
      kind: "document",
      reason: "reviewed by the caller",
      owner: "overrides",
      count: 1,
    });
  });

  it("takes a paragraph's runs with it when its handler builds nothing", async () => {
    const bytes = await docWithBody(`<w:p><w:r><w:t>gone</w:t></w:r></w:p>`);
    const { report, doc } = await importDocx(new ServerEditor({ extensions: [StarterKit] }), bytes, {
      overrides: {
        blocks: {
          paragraph: (_block, content, ctx) => {
            // An empty result built nothing; `null` would hand the paragraph
            // on to the Paragraph extension.
            if (content.some((node) => node.text === "gone")) return [];
            const paragraph = ctx.schema.nodes["paragraph"];
            return paragraph ? paragraph.create(null, content) : null;
          },
        },
      },
    });

    expect(doc.textContent).not.toContain("gone");
    expect(report.entries).toContainEqual({
      outcome: "dropped",
      kind: "text",
      reason: "inside a paragraph that was dropped",
      owner: "overrides",
      count: 1,
    });
  });

  it("files what a handler reports under its own owner when a later one declined to it", async () => {
    const LangReader = Extension.create({
      name: "langReader",
      addImports() {
        return {
          docx: {
            marks: {
              lang: (_mark, ctx) => {
                ctx.report.changed("lang", "kept as plain text");
                return null;
              },
            },
          },
        };
      },
    });
    const bytes = await docWithBody(
      `<w:p><w:r><w:rPr><w:lang w:val="en-US"/></w:rPr><w:t>x</w:t></w:r></w:p>`,
    );
    const { report } = await importDocx(
      new ServerEditor({ extensions: [StarterKit, LangReader] }),
      bytes,
      { overrides: { marks: { lang: () => null } } },
    );

    expect(report.entries).toContainEqual({
      outcome: "changed",
      kind: "lang",
      reason: "kept as plain text",
      owner: "langReader",
      count: 1,
    });
  });

  const UNTAGGED_CONTROL =
    `<w:sdt><w:sdtContent><w:p><w:r><w:t>inside</w:t></w:r></w:p></w:sdtContent></w:sdt>`;

  it("drops a content control nothing handles, and keeps its content", async () => {
    const bytes = await docWithBody(UNTAGGED_CONTROL);
    const { report, doc } = await importDocx(new ServerEditor({ extensions: [StarterKit] }), bytes);

    expect(doc.textContent).toContain("inside");
    expect(report.entries).toContainEqual({
      outcome: "dropped",
      kind: "sdt",
      reason: "no handler",
      owner: null,
      count: 1,
    });
  });

  it("names the extension whose content-control handler declined one", async () => {
    // SourcedBlock reads only the controls it tagged, so an untagged one
    // reaches its handler and comes back with nothing; the content is unwrapped.
    const bytes = await docWithBody(UNTAGGED_CONTROL);
    const editor = new ServerEditor({ extensions: [StarterKit, SourcedBlockExtension] });
    const { report, doc } = await importDocx(editor, bytes);

    expect(doc.textContent).toContain("inside");
    expect(report.entries).toContainEqual({
      outcome: "dropped",
      kind: "sdt",
      reason: "handler returned nothing",
      owner: "sourcedBlock",
      count: 1,
    });
    expect(report.counts["text"]?.dropped).toBe(0);
  });

  it("counts formatting Word sets to its default as kept, not dropped", async () => {
    // Each says "no formatting": automatic colour, no highlight, no shading,
    // and a font hint that names no face. None of them is a loss.
    const rPr =
      `<w:rFonts w:hint="eastAsia"/><w:color w:val="auto"/>` +
      `<w:highlight w:val="none"/><w:shd w:val="clear" w:color="auto" w:fill="auto"/>`;
    const bytes = await docWithBody(`<w:p><w:r><w:rPr>${rPr}</w:rPr><w:t>plain</w:t></w:r></w:p>`);
    const { report } = await importDocx(new ServerEditor({ extensions: [StarterKit] }), bytes);

    for (const kind of ["rFonts", "color", "highlight", "shd"]) {
      expect(report.counts[kind], kind).toEqual({ kept: 1, dropped: 0, changed: 0 });
    }
    expect(dropsOf(report)).toEqual([]);
  });

  it("still records a theme font as dropped, under the extension that could not read it", async () => {
    const bytes = await docWithBody(
      `<w:p><w:r><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/></w:rPr><w:t>x</w:t></w:r></w:p>`,
    );
    const { report } = await importDocx(new ServerEditor({ extensions: [StarterKit] }), bytes);

    expect(report.entries).toContainEqual({
      outcome: "dropped",
      kind: "rFonts",
      reason: "theme font not resolved",
      owner: "fontFamily",
      count: 1,
    });
  });

  it("records what a block nothing imports held as dropped inside it", async () => {
    const cell = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
    const table = `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>${cell("a")}${cell("b")}</w:tr></w:tbl>`;
    const { report } = await importDocx(new ServerEditor({ extensions: [StarterKit] }), await docWithBody(table));

    expect(dropsOf(report).map(({ kind, reason, count }) => [kind, reason, count])).toEqual([
      ["table", NO_HANDLER, 1],
      ["paragraph", insideDropped("table"), 2],
      ["text", insideDropped("table"), 2],
    ]);
  });

  it("counts a link once, however many runs it spans", async () => {
    const runs = ["one", "two", "three"].map((t) => `<w:r><w:t xml:space="preserve">${t} </w:t></w:r>`).join("");
    const bytes = await docWithBody(`<w:p><w:hyperlink w:anchor="top">${runs}</w:hyperlink></w:p>`);
    const { report } = await importDocx(new ServerEditor({ extensions: [StarterKit] }), bytes);

    expect(report.counts["hyperlink"]?.kept).toBe(1);
    expect(report.counts["text"]?.kept).toBe(4);
  });

  it("counts a link once: kept where it lands, else dropped once", async () => {
    const lostImage =
      '<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="9525" cy="9525"/>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdNope"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    const link = (inner: string) => docWithBody(`<w:p><w:hyperlink w:anchor="top">${inner}</w:hyperlink></w:p>`);
    const text = "<w:r><w:t>click</w:t></w:r>";
    for (const extensions of [[StarterKit], [StarterKit.configure({ image: false })]]) {
      const editor = () => new ServerEditor({ extensions });
      // Kept where it lands, however many of its images were lost.
      for (const inner of [lostImage + text, lostImage + lostImage + text, text + lostImage]) {
        const { report } = await importDocx(editor(), await link(inner));
        expect(report.counts["hyperlink"]).toMatchObject({ kept: 1, dropped: 0 });
      }
      // Lost once when nothing under it lands.
      const { report } = await importDocx(editor(), await link(lostImage + lostImage));
      expect(report.counts["hyperlink"]).toMatchObject({ kept: 0, dropped: 1 });
    }
  });

  it("counts a content control nothing carries once, however many runs it holds", async () => {
    const runs = ["a", "b", "c"].map((t) => `<w:r><w:t>${t}</w:t></w:r>`).join("");
    const sdt = `<w:p><w:sdt><w:sdtPr><w:tag w:val="mystery"/></w:sdtPr><w:sdtContent>${runs}</w:sdtContent></w:sdt></w:p>`;
    for (const extensions of [[StarterKit], [StarterKit, Field]]) {
      const { report } = await importDocx(new ServerEditor({ extensions }), await docWithBody(sdt));

      expect(dropsOf(report).filter((entry) => entry.kind === "sdt").map((entry) => entry.count)).toEqual([1]);
    }
  });

  it("counts a lost table's content as the same table kept would count it", async () => {
    const runs =
      '<w:r><w:t></w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>' +
      '<w:hyperlink w:anchor="top"><w:r><w:t>one</w:t></w:r><w:r><w:t>two</w:t></w:r></w:hyperlink>';
    const cell = `<w:tc><w:p><w:pPr><w:pStyle w:val="Loud"/></w:pPr>${runs}</w:p></w:tc>`;
    const table = `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr>${cell}</w:tr></w:tbl>`;
    // A paragraph style that sets formatting its runs inherit.
    const entries = unzipSync(await docWithBody(table));
    const styles = strFromU8(entries["word/styles.xml"]!);
    entries["word/styles.xml"] = strToU8(
      styles.replace("</w:styles>", '<w:style w:type="paragraph" w:styleId="Loud"><w:rPr><w:i/></w:rPr></w:style></w:styles>'),
    );
    const bytes = zipSync(entries);
    const kept = (await importDocx(new ServerEditor({ extensions: [StarterKit.configure({ table: true })] }), bytes)).report;
    const lost = (await importDocx(new ServerEditor({ extensions: [StarterKit] }), bytes)).report;

    const content = (kind: string) => !["table", "tableRow", "tableCell", "tableHeader", "paragraph"].includes(kind);
    // What the table held: kept with it, less what the document outside it keeps either way.
    const keptContent = Object.fromEntries(
      Object.entries(kept.counts)
        .filter(([kind]) => content(kind))
        .map(([kind, count]) => [kind, count.kept - (lost.counts[kind]?.kept ?? 0)]),
    );
    const lostContent = Object.fromEntries(
      dropsOf(lost).filter((entry) => entry.reason === insideDropped("table") && content(entry.kind)).map((entry) => [entry.kind, entry.count]),
    );
    expect(lostContent).toEqual(keptContent);
    expect(Object.keys(keptContent).sort()).toEqual(["b", "hyperlink", "i", "text"]);
  });

  it("records a header nothing reads as dropped, with a warning", async () => {
    const { report, diagnostics } = await importDocx(new ServerEditor({ extensions: [StarterKit] }), await docWithHeader("HEADER"));

    expect(dropsOf(report)).toEqual([{ outcome: "dropped", kind: "w:hdr", reason: NO_HANDLER, owner: null, count: 1 }]);
    expect(diagnostics.map((d) => d.code)).toContain("header-footer-unread");
  });

  it("records a header part it cannot read as dropped, under the extension that asked for it", async () => {
    const unreadable = [null, "", "<w:ftr/>"];
    for (const part of unreadable) {
      const editor = new ServerEditor({ extensions: [StarterKit, PartReader] });
      const { report } = await importDocx(editor, await docWithHeader("HEADER", part));

      expect(dropsOf(report).map((entry) => [entry.kind, entry.reason, entry.owner])).toEqual([["w:hdr", PART_UNREADABLE, "partReader"]]);
    }
  });

  it("records one header serving two slots as one part lost, read or not", async () => {
    const cases: Array<{ extensions: Extension[]; part: null | undefined; code: string }> = [
      { extensions: [StarterKit], part: undefined, code: "header-footer-unread" },
      { extensions: [StarterKit, PartReader], part: null, code: "header-footer-part-missing" },
    ];
    for (const { extensions, part, code } of cases) {
      const entries = unzipSync(await docWithHeader("HEADER", part));
      const document = strFromU8(entries["word/document.xml"]!);
      entries["word/document.xml"] = strToU8(
        document.replace("<w:sectPr>", '<w:sectPr><w:headerReference w:type="first" r:id="rIdHeader1"/>'),
      );
      const { report, diagnostics } = await importDocx(new ServerEditor({ extensions }), zipSync(entries));

      expect(dropsOf(report).map((entry) => [entry.kind, entry.count])).toEqual([["w:hdr", 1]]);
      expect(diagnostics.filter((d) => d.code === code)).toHaveLength(1);
    }
  });

  it("records nothing lost for a header an extension reads", async () => {
    const editor = new ServerEditor({ extensions: [StarterKit, PartReader] });
    const { report } = await importDocx(editor, await docWithHeader("HEADER"));

    expect(dropsOf(report)).toEqual([]);
  });

  it("imports a paragraph whose style id is a name Object already has", async () => {
    const paragraphs = ["constructor", "toString", "__proto__"]
      .map((id) => `<w:p><w:pPr><w:pStyle w:val="${id}"/></w:pPr><w:r><w:t>${id}</w:t></w:r></w:p>`)
      .join("");
    const bytes = await docWithBody(paragraphs);
    const { doc, report } = await importDocx(new ServerEditor({ extensions: [StarterKit] }), bytes);

    expect(doc.textContent).toContain("constructor");
    expect(doc.textContent).toContain("toString");
    expect(doc.textContent).toContain("__proto__");
    expect(dropsOf(report)).toEqual([]);
  });

  describe("a field nothing handles", () => {
    // StarterKit has no field handler. The field inherits its paragraph
    // style's run properties: bold, which StarterKit claims, and outline,
    // which nothing does.
    async function unhandledField(editor: ServerEditor): Promise<Uint8Array> {
      const entries = unzipSync(await exportDocxBytes(editor));
      entries["word/styles.xml"] = strToU8(
        strFromU8(entries["word/styles.xml"]!).replace(
          "</w:styles>",
          `<w:style w:type="paragraph" w:styleId="Loud"><w:rPr><w:b/><w:outline/></w:rPr></w:style></w:styles>`,
        ),
      );
      entries["word/document.xml"] = strToU8(
        strFromU8(entries["word/document.xml"]!).replace(
          "<w:sectPr",
          `<w:p><w:pPr><w:pStyle w:val="Loud"/></w:pPr><w:fldSimple w:instr=" PAGE "/></w:p><w:sectPr`,
        ),
      );
      return zipSync(entries);
    }

    it("takes its formatting with it", async () => {
      const editor = new ServerEditor({ extensions: [StarterKit] });
      const { report } = await importDocx(editor, await unhandledField(editor));

      expect(report.entries).toContainEqual({
        outcome: "dropped",
        kind: "field",
        reason: "no handler",
        owner: null,
        count: 1,
      });
      for (const kind of ["b", "outline"]) {
        expect(report.entries).toContainEqual({
          outcome: "dropped",
          kind,
          reason: "inside a field that was dropped",
          owner: null,
          count: 1,
        });
      }
    });

    it("does not fail a throwing import over formatting nobody claims on it", async () => {
      // The field's own drop is not fatal, so neither is the formatting it took.
      const editor = new ServerEditor({ extensions: [StarterKit] });
      const { diagnostics } = await importDocx(editor, await unhandledField(editor), {
        unsupported: "throw",
      });
      expect(diagnostics.some((d) => d.code === "unsupported-mark")).toBe(false);
    });
  });

  it("records a content control's content as dropped when its handler returns an empty list", async () => {
    const bytes = await docWithBody(UNTAGGED_CONTROL);
    const { report, doc } = await importDocx(new ServerEditor({ extensions: [StarterKit] }), bytes, {
      overrides: { blocks: { sdt: () => [] } },
    });

    expect(doc.textContent).not.toContain("inside");
    expect(report.entries).toContainEqual({
      outcome: "dropped",
      kind: "text",
      reason: "inside a sdt that was dropped",
      owner: "overrides",
      count: 1,
    });
  });
});

describe("the report's vocabulary, as a consumer imports it", () => {
  it("names each reason and owner the converter writes", () => {
    // An app matches entries on these rather than on copied strings, so a
    // rewording reaches it through the constant.
    expect([NO_HANDLER, NO_PARSER, HANDLER_RETURNED_NOTHING, WRAPPER_DECLINED]).toEqual([
      "no handler",
      "no parser",
      "handler returned nothing",
      "wrapper left the run unwrapped",
    ]);
    expect(PART_UNREADABLE).toBe("part could not be read");
    expect(OVERRIDES_OWNER).toBe("overrides");
    expect(insideDropped("table")).toBe("inside a table that was dropped");
    expect(noSchemaNode("hardBreak")).toBe("the schema has no hardBreak node");
  });

  it("types a walk's handlers, their owners and its report from the package entry", () => {
    const editor = new ServerEditor({ extensions: [StarterKit] });
    paragraphDoc(editor);
    const owners: WalkerHandlerOwners = { nodes: { paragraph: "paragraph" } };
    const handlers: WalkerHandlers = { nodes: {}, marks: {}, owners };
    const owner: HandlerOwner = owners.nodes?.["paragraph"] ?? null;
    const count: DocxReportCount = { kept: 0, dropped: 0, changed: 0 };
    const reporter: DocxReporter = { kept: () => {}, dropped: () => {}, changed: () => {} };

    expect(typeof walkDocument).toBe("function");
    expect([handlers.owners, owner, count.kept, typeof reporter.kept]).toEqual([
      owners,
      "paragraph",
      0,
      "function",
    ]);
  });
});

/** The entries `owner` recorded as changed, as `kind: reason`. */
function changesBy(report: DocxReport, owner: string): string[] {
  return report.entries
    .filter((entry) => entry.outcome === "changed" && entry.owner === owner)
    .map((entry) => `${entry.kind}: ${entry.reason}`);
}

const PIXEL = "data:image/png;base64,AA==";

describe("exportDocx — what each extension says it could not write", () => {
  const exportOf = async (content: unknown[], table = false) => {
    const kit = table ? StarterKit.configure({ table: true }) : StarterKit;
    const editor = new ServerEditor({ extensions: [kit, SourcedBlockExtension] });
    editor.setContent({ type: "doc", content });
    const result = await exportDocx(editor);
    editor.destroy();
    return result.report;
  };

  it("names the paragraph and heading attributes Word is not given", async () => {
    const attrs = { indent: 2, textIndent: 24, fontFamily: "Georgia" };
    const report = await exportOf([
      { type: "paragraph", attrs, content: [{ type: "text", text: "p" }] },
      { type: "heading", attrs: { level: 2, ...attrs }, content: [{ type: "text", text: "h" }] },
    ]);

    const unwritten = ["indent not written", "first-line indent not written", "font not written"];
    expect(changesBy(report, "paragraph")).toEqual(unwritten.map((reason) => `paragraph: ${reason}`));
    expect(changesBy(report, "heading")).toEqual(unwritten.map((reason) => `heading: ${reason}`));
  });

  it("says nothing about a paragraph whose attributes are all written", async () => {
    const report = await exportOf([{ type: "paragraph", attrs: { align: "center" }, content: [{ type: "text", text: "p" }] }]);
    expect(changesBy(report, "paragraph")).toEqual([]);
  });

  it("names the image attributes Word is not given", async () => {
    const report = await exportOf([{
      type: "paragraph",
      content: [{ type: "image", attrs: { src: PIXEL, alt: "A cat", zIndex: 2, verticalAlign: "middle" } }],
    }]);
    expect(changesBy(report, "image")).toEqual([
      "image: alt text not written",
      "image: stacking order not written",
      "image: vertical alignment not written",
    ]);
  });

  it("drops a colour or a font it cannot write, and says why", async () => {
    const report = await exportOf([{
      type: "paragraph",
      content: [
        { type: "text", text: "a", marks: [{ type: "color", attrs: { color: "not-a-colour" } }] },
        { type: "text", text: "b", marks: [{ type: "fontFamily", attrs: { family: "" } }] },
      ],
    }]);
    expect(report.entries).toContainEqual({ outcome: "dropped", kind: "color", reason: "not a color DOCX can write", owner: "color", count: 1 });
    expect(report.entries).toContainEqual({ outcome: "dropped", kind: "fontFamily", reason: "no font named", owner: "fontFamily", count: 1 });
    expect(report.counts["color"]).toEqual({ kept: 0, dropped: 1, changed: 0 });
  });

  it("names what Word is given in place of what the document says", async () => {
    const report = await exportOf([{
      type: "paragraph",
      content: [
        { type: "text", text: "a", marks: [{ type: "fontSize", attrs: { size: 15 } }] },
        { type: "text", text: "c", marks: [{ type: "link", attrs: { href: "https://example.com", title: "Example" } }] },
      ],
    }]);
    expect(changesBy(report, "fontSize")).toEqual(["fontSize: rounded to a half point"]);
    expect(changesBy(report, "link")).toEqual(["link: title not written"]);
    // 16px is 12pt exactly, so there is nothing to say.
    const exact = await exportOf([{ type: "paragraph", content: [{ type: "text", text: "a", marks: [{ type: "fontSize", attrs: { size: 16 } }] }] }]);
    expect(changesBy(exact, "fontSize")).toEqual([]);
  });

  it("names a table cell background Word is given differently, or not at all", async () => {
    const cell = (background: string) => ({ type: "tableCell", attrs: { background }, content: [{ type: "paragraph" }] });
    const report = await exportOf(
      [{ type: "table", attrs: { grid: [100, 100] }, content: [{ type: "tableRow", content: [cell("rgba(255, 0, 0, 0.5)"), cell("nonsense")] }] }],
      true,
    );
    expect(changesBy(report, "table")).toEqual([
      "tableCell: translucent background blended onto white",
      "tableCell: background not written: not a color",
    ]);
  });

  it("names a sourced block whose source link does not fit in Word", async () => {
    const report = await exportOf([{
      type: "sourcedBlock",
      attrs: { instanceId: "i", kind: "clause", resourceId: "r".repeat(300), versionId: "v" },
      content: [{ type: "paragraph", content: [{ type: "text", text: "body" }] }],
    }]);
    expect(changesBy(report, "sourcedBlock")).toEqual(["sourcedBlock: source link not written: over 255 characters"]);
  });
});

describe("importDocx — what each extension says it could not keep", () => {
  const run = (rPr: string, text = "x") => `<w:r><w:rPr>${rPr}</w:rPr><w:t>${text}</w:t></w:r>`;
  const importOf = async (body: string) =>
    (await importDocx(new ServerEditor({ extensions: [StarterKit] }), await docWithBody(body))).report;

  it("names formatting it keeps in a simpler form", async () => {
    const report = await importOf(
      `<w:p>${run(`<w:u w:val="double"/>`)}${run(`<w:sz w:val="23"/>`)}` +
        `${run(`<w:highlight w:val="green"/>`)}${run(`<w:shd w:val="pct25" w:color="auto" w:fill="FF0000"/>`)}` +
        `${run(`<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="MS Mincho"/>`)}</w:p>`,
    );
    expect(changesBy(report, "underline")).toEqual([`u: "double" underline imported as single`]);
    expect(changesBy(report, "fontSize")).toEqual(["sz: rounded to a whole pixel"]);
    expect(changesBy(report, "highlight")).toEqual([
      "highlight: color not kept: the editor has one highlight color",
      `shd: pattern "pct25" not kept`,
      "shd: color not kept: the editor has one highlight color",
    ]);
    expect(changesBy(report, "fontFamily")).toEqual(["rFonts: one font kept of several named"]);
  });

  it("says why it built nothing for formatting it cannot read", async () => {
    const report = await importOf(
      `<w:p>${run(`<w:sz w:val="big"/>`)}${run(`<w:rFonts w:asciiTheme="minorHAnsi"/>`)}</w:p>` +
        `<w:p><w:hyperlink r:id="rIdMissing">${run("")}</w:hyperlink></w:p>`,
    );
    expect(report.entries).toContainEqual({ outcome: "dropped", kind: "sz", reason: "not a valid size", owner: "fontSize", count: 1 });
    expect(report.entries).toContainEqual({ outcome: "dropped", kind: "rFonts", reason: "theme font not resolved", owner: "fontFamily", count: 1 });
    expect(report.entries).toContainEqual({ outcome: "dropped", kind: "hyperlink", reason: "no usable target", owner: "link", count: 1 });
  });

  it("drops a link it cannot resolve once, however many runs it spans", async () => {
    const report = await importOf(`<w:p><w:hyperlink r:id="rIdMissing">${run("")}${run("")}${run("")}</w:hyperlink></w:p>`);

    expect(report.counts["hyperlink"]).toMatchObject({ kept: 0, dropped: 1 });
  });

  it("says why an image it cannot find is missing", async () => {
    const drawing =
      `<w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><a:graphic><a:graphicData>` +
      `<pic:pic><pic:blipFill><a:blip r:embed="rIdMissing"/></pic:blipFill></pic:pic>` +
      `</a:graphicData></a:graphic></wp:inline></w:drawing>`;
    const report = await importOf(`<w:p><w:r>${drawing}</w:r></w:p>`);
    expect(report.entries).toContainEqual({ outcome: "dropped", kind: "image", reason: "image part not found", owner: "image", count: 1 });
  });

  it("takes an image out of what it kept when a code block leaves it behind", async () => {
    const editor = new ServerEditor();
    editor.setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "code ", marks: [{ type: "bold" }] }, { type: "image", attrs: { src: PIXEL } }] }],
    });
    const entries = unzipSync(await exportDocxBytes(editor));
    const documentXml = strFromU8(entries["word/document.xml"]!);
    entries["word/document.xml"] = strToU8(documentXml.replace("<w:p>", `<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr>`));
    const { report, doc } = await importDocx(new ServerEditor(), zipSync(entries));

    expect(doc.child(0).type.name).toBe("codeBlock");
    for (const kind of ["image", "b"]) {
      expect(report.counts[kind], kind).toEqual({ kept: 0, dropped: 1, changed: 0 });
      expect(report.entries).toContainEqual({ outcome: "dropped", kind, reason: LEFT_OUT, owner: "codeBlock", count: 1 });
    }
  });

  it("reports nothing lost for a code block Scrivr wrote", async () => {
    const editor = new ServerEditor();
    editor.setContent({ type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: "let x = 1;" }] }] });
    const { report, doc } = await importDocx(new ServerEditor(), await exportDocxBytes(editor));

    expect(doc.child(0).type.name).toBe("codeBlock");
    expect(report.entries.filter((entry) => entry.owner === "codeBlock")).toEqual([]);
  });

  it("counts no loss for formatting a code block leaves behind that carried nothing", async () => {
    const noFormatting = `<w:rFonts w:hint="eastAsia"/><w:color w:val="auto"/><w:highlight w:val="none"/><w:shd w:val="clear" w:fill="auto"/>`;
    const report = await importOf(`<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr>${run(noFormatting, "let x;")}</w:p>`);

    expect(dropsOf(report)).toEqual([]);
  });

  it("counts formatting a code block leaves behind inside a content control", async () => {
    const control = `<w:sdt><w:sdtPr><w:tag w:val="mystery"/></w:sdtPr><w:sdtContent>${run("<w:b/>")}</w:sdtContent></w:sdt>`;
    const report = await importOf(`<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr>${control}</w:p>`);

    expect(report.counts["b"]).toMatchObject({ kept: 0, dropped: 1 });
  });

  it("records a handler's own drop whatever came before it in the document", async () => {
    const Lossy = Extension.create({
      name: "lossy",
      addImports() {
        return {
          docx: {
            paragraphStyles: {
              Lossy: (_block, content, ctx) => {
                ctx.report.dropped("b", "lossy");
                return ctx.schema.nodes["paragraph"]!.create(null, content);
              },
            },
          },
        };
      },
    });
    for (const order of ["first", "last"]) {
      const heading = `<w:p>${run("<w:b/>", "H")}</w:p>`;
      const lossy = `<w:p><w:pPr><w:pStyle w:val="Lossy"/></w:pPr>${run("", "x")}</w:p>`;
      const editor = new ServerEditor({ extensions: [StarterKit, Lossy] });
      const { report } = await importDocx(editor, await docWithBody(order === "first" ? heading + lossy : lossy + heading));

      expect(report.entries, order).toContainEqual({ outcome: "dropped", kind: "b", reason: "lossy", owner: "lossy", count: 1 });
    }
  });

  it("does not count a field twice when a code block leaves behind one nothing built", async () => {
    const bytes = await docWithBody(
      `<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr><w:r><w:t>page </w:t></w:r><w:fldSimple w:instr=" PAGE "/></w:p>`,
    );
    const { report } = await importDocx(new ServerEditor(), bytes);
    expect(report.counts["field"]).toEqual({ kept: 0, dropped: 1, changed: 0 });
  });
});

describe("importDocx — unread, as a consumer imports it", () => {
  it("lists what the import never read, from the package entry", async () => {
    const bytes = await docWithBody(`<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`);
    const { report } = await importDocx(new ServerEditor(), bytes, { trackUnread: true });
    const keepNext: DocxUnreadElement | undefined = report.unread?.find((u) => u.path.endsWith("/w:pPr/w:keepNext"));
    expect(keepNext).toEqual({ part: "word/document.xml", path: "w:document/w:body/w:p/w:pPr/w:keepNext", outcome: "unread", count: 1 });
  });
});
