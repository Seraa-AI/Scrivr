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
      docx: { markWrappers: { stamp: (run) => xml("w:customXml", undefined, [run]) } },
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
    const editor = new ServerEditor({ extensions: [StarterKit] });
    paragraphDoc(editor);
    const bytes = await exportDocxBytes(editor);
    const { report } = await importDocx(new ServerEditor({ extensions: [StarterKit] }), bytes, {
      overrides: {
        marks: { b: () => null },
        onImportComplete(doc, ctx) {
          ctx.report.changed("document", "reviewed by the caller");
          return doc;
        },
      },
    });

    expect(report.entries).toContainEqual({
      outcome: "dropped",
      kind: "b",
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
            if (content.some((node) => node.text === "gone")) return null;
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
      reason: "handler returned nothing",
      owner: "fontFamily",
      count: 1,
    });
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
