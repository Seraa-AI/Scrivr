/**
 * What an import never read. The parser is not changed to report it: the tree
 * it walks records each read, so a property nobody looks at shows up without
 * anyone having to remember to say so.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ServerEditor } from "@scrivr/core";
import type { DocxUnreadElement } from "@scrivr/core";
import { importDocx } from "./import";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { exportDocxBytes } from "../export/export";
import { attr, findChild, findChildren, markRead, parseOoxml, parsePart, ReadTracker } from "./xml";

const PARAGRAPH = `<w:document><w:body><w:p>
  <w:pPr><w:jc w:val="center"/><w:ind w:left="720"/><w:keepNext/></w:pPr>
  <w:proofErr w:type="spellStart"/>
  <w:r><w:t>Hi</w:t></w:r>
</w:p></w:body></w:document>`;

function tracked(xml: string) {
  const tracker = new ReadTracker();
  const root = parsePart(xml, "word/document.xml", tracker);
  if (!root) throw new Error("no root");
  return { tracker, root };
}

/** The paragraph properties of PARAGRAPH, found the way the parser finds them. */
function pPrOf(root: ReturnType<typeof tracked>["root"]) {
  const body = findChild(root, "w:body");
  const p = body && findChild(body, "w:p");
  const pPr = p && findChild(p, "w:pPr");
  if (!pPr) throw new Error("no pPr");
  return pPr;
}

const paths = (unread: DocxUnreadElement[]) => unread.map((u) => `${u.outcome} ${u.path}`);

describe("ReadTracker", () => {
  it("reports what was never looked at, once, at the top of what was skipped", () => {
    const { tracker, root } = tracked(PARAGRAPH);
    const jc = findChild(pPrOf(root), "w:jc");
    expect(jc && attr(jc, "w:val")).toBe("center");

    expect(paths(tracker.unread())).toEqual([
      "unread w:document/w:body/w:p/w:pPr/w:ind",
      "unread w:document/w:body/w:p/w:pPr/w:keepNext",
      "ignored w:document/w:body/w:p/w:proofErr",
      "unread w:document/w:body/w:p/w:r",
    ]);
  });

  it("does not count the siblings a helper searched past as read", () => {
    const { tracker, root } = tracked(PARAGRAPH);
    // Found by searching past w:jc and w:ind, which stay unread.
    expect(findChild(pPrOf(root), "w:keepNext")).toBeDefined();

    expect(paths(tracker.unread())).toContain("unread w:document/w:body/w:p/w:pPr/w:jc");
    expect(paths(tracker.unread())).toContain("unread w:document/w:body/w:p/w:pPr/w:ind");
  });

  it("counts a name only seen as examined, and one the import handles as read", () => {
    const { tracker, root } = tracked(PARAGRAPH);
    // A walk over `.children` that compares names and handles only w:keepNext.
    for (const child of pPrOf(root).children) {
      if (typeof child !== "string" && child.name === "w:keepNext") markRead(child);
    }

    const outcomes = paths(tracker.unread());
    expect(outcomes).toContain("examined w:document/w:body/w:p/w:pPr/w:jc");
    expect(outcomes).toContain("examined w:document/w:body/w:p/w:pPr/w:ind");
    expect(outcomes.some((o) => o.endsWith("/w:keepNext"))).toBe(false);
  });

  it("counts an element a search found but nothing read in as examined", () => {
    const { tracker, root } = tracked(PARAGRAPH);
    expect(findChild(pPrOf(root), "w:ind")).toBeDefined();
    expect(paths(tracker.unread())).toContain("examined w:document/w:body/w:p/w:pPr/w:ind");
  });

  it("counts repeats of one path as one entry", () => {
    const { tracker, root } = tracked(
      `<w:document><w:body><w:p/><w:p/><w:p/></w:body></w:document>`,
    );
    // Searching the body reads it; its paragraphs, passed over, stay unread.
    const body = findChild(root, "w:body");
    expect(body && findChildren(body, "w:tbl")).toEqual([]);
    expect(tracker.unread()).toEqual([
      { part: "word/document.xml", path: "w:document/w:body/w:p", outcome: "unread", count: 3 },
    ]);
  });

  it("changes nothing the parser sees", () => {
    const plain = parseOoxml(PARAGRAPH);
    const { root } = tracked(PARAGRAPH);
    expect(JSON.parse(JSON.stringify(root))).toEqual(JSON.parse(JSON.stringify(plain)));
  });
});

/** An exported document with `body` spliced in before its sectPr. */
async function docWithBody(body: string): Promise<Uint8Array> {
  const entries = unzipSync(await exportDocxBytes(new ServerEditor({ content: "anchor" })));
  const original = strFromU8(entries["word/document.xml"]!);
  entries["word/document.xml"] = strToU8(original.replace("<w:sectPr", body + "<w:sectPr"));
  return zipSync(entries);
}

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "../wordTestFiles", name)));

const letter = () => fixture("02-correspondence-c1c9a16460c1.docx");

describe("importDocx — trackUnread", () => {
  it("reports nothing unread unless asked", async () => {
    const { report } = await importDocx(new ServerEditor(), letter());
    expect(report.unread).toBeUndefined();
  });

  it("finds the paragraph spacing a Word letter states and the import never reads", async () => {
    const { report } = await importDocx(new ServerEditor(), letter(), { trackUnread: true });
    const unread = report.unread ?? [];
    expect(unread.some((u) => u.outcome === "unread" && u.path.endsWith("/w:pPr/w:spacing"))).toBe(true);
    // Run spacing is not unread: it is on the ignored list, as a known gap.
    const runSpacing = unread.filter((u) => u.path.endsWith("/w:rPr/w:spacing"));
    expect(runSpacing.map((u) => u.outcome)).toEqual(runSpacing.map(() => "ignored"));
    // The defaults every paragraph inherits.
    expect(unread.some((u) => u.part === "word/styles.xml" && u.path.includes("w:pPrDefault"))).toBe(true);
  });

  it("imports the same document with tracking on as off", async () => {
    const off = await importDocx(new ServerEditor(), letter());
    const on = await importDocx(new ServerEditor(), letter(), { trackUnread: true });
    const strip = (json: unknown) => JSON.stringify(json).replace(/"nodeId":"[^"]*"/g, "");
    expect(strip(on.doc.toJSON())).toBe(strip(off.doc.toJSON()));
    expect(on.diagnostics).toEqual(off.diagnostics);
  });
});

describe("importDocx — trackUnread on a real Word letter", () => {
  const administrative = () => fixture("01-administrative-f9355274cbfe.docx");
  const outcomesOf = (unread: DocxUnreadElement[], name: string) =>
    [...new Set(unread.filter((u) => u.path.endsWith(`/${name}`)).map((u) => u.outcome))];

  it("tells what the import reads, matches, skips on purpose and never looks at", async () => {
    const { report } = await importDocx(new ServerEditor(), administrative(), { trackUnread: true });
    const unread = report.unread ?? [];

    // Read: alignment, and a run's tab.
    expect(outcomesOf(unread, "w:jc")).toEqual([]);
    expect(outcomesOf(unread, "w:tab")).toEqual([]);
    // Matched by name, nothing in them read: the page size and margins.
    expect(outcomesOf(unread, "w:pgSz")).toEqual(["examined"]);
    expect(outcomesOf(unread, "w:pgMar")).toEqual(["examined"]);
    // Dropped on purpose.
    expect(outcomesOf(unread, "w:szCs")).toEqual(["ignored"]);
    expect(outcomesOf(unread, "w:proofErr")).toEqual(["ignored"]);
    // Never looked at.
    for (const name of ["w:ind", "w:keepNext", "w:tabs", "w:pPrDefault"]) {
      expect(outcomesOf(unread, name), name).toEqual(["unread"]);
    }
  });
});

describe("importDocx — trackUnread finds what the parser passes over", () => {
  it("reports a run element whose name the parser only compared", async () => {
    const bytes = await docWithBody(`<w:p><w:r><w:t>a</w:t><w:noBreakHyphen/><w:tab/><w:t>b</w:t></w:r></w:p>`);
    const { report } = await importDocx(new ServerEditor(), bytes, { trackUnread: true });
    const unread = paths(report.unread ?? []);
    expect(unread).toContain("examined w:document/w:body/w:p/w:r/w:noBreakHyphen");
    // A tab is handled by its name alone.
    expect(unread.some((u) => u.endsWith("/w:tab"))).toBe(false);
  });

  it("reports headers, footers and footnotes no extension walks", async () => {
    const { report } = await importDocx(new ServerEditor(), fixture("16-legal-319db254cfb3.docx"), { trackUnread: true });
    const parts = new Set((report.unread ?? []).map((u) => u.part));
    expect([...parts].some((part) => /^word\/header\d+\.xml$/.test(part))).toBe(true);
    expect([...parts].some((part) => /^word\/footer\d+\.xml$/.test(part))).toBe(true);
    expect(parts.has("word/footnotes.xml")).toBe(true);
  });
});

describe("importDocx — the ignored list", () => {
  it("does not warn about a property dropped on purpose", async () => {
    const { diagnostics, report } = await importDocx(new ServerEditor(), letter());
    expect(diagnostics.some((d) => d.markType === "szCs")).toBe(false);
    // Still counted: the report is the inventory.
    expect(report.counts["szCs"]?.dropped ?? 0).toBeGreaterThan(0);
  });
});
