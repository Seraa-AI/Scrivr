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
import { attr, findChild, parseOoxml, ReadTracker } from "./xml";

const PARAGRAPH = `<w:document><w:body><w:p>
  <w:pPr><w:jc w:val="center"/><w:ind w:left="720"/><w:keepNext/></w:pPr>
  <w:proofErr w:type="spellStart"/>
  <w:r><w:t>Hi</w:t></w:r>
</w:p></w:body></w:document>`;

function tracked(xml: string) {
  const tracker = new ReadTracker();
  const root = parseOoxml(xml, { tracker, part: "word/document.xml" });
  if (!root) throw new Error("no root");
  return { tracker, root };
}

const paths = (unread: DocxUnreadElement[]) => unread.map((u) => `${u.outcome} ${u.path}`);

describe("ReadTracker", () => {
  it("reports what was never looked at, once, at the top of what was skipped", () => {
    const { tracker, root } = tracked(PARAGRAPH);
    const body = findChild(root, "w:body");
    const p = body && findChild(body, "w:p");
    const pPr = p && findChild(p, "w:pPr");
    const jc = pPr && findChild(pPr, "w:jc");
    expect(jc && attr(jc, "w:val")).toBe("center");

    expect(paths(tracker.unread())).toEqual([
      "unread w:document/w:body/w:p/w:pPr/w:ind",
      "unread w:document/w:body/w:p/w:pPr/w:keepNext",
      "unread w:document/w:body/w:p/w:r",
    ]);
  });

  it("does not count the siblings a helper searched past as read", () => {
    const { tracker, root } = tracked(PARAGRAPH);
    const body = findChild(root, "w:body");
    const p = body && findChild(body, "w:p");
    const pPr = p && findChild(p, "w:pPr");
    // Found by searching past w:jc and w:ind, which stay unread.
    expect(pPr && findChild(pPr, "w:keepNext")).toBeDefined();

    expect(paths(tracker.unread())).toContain("unread w:document/w:body/w:p/w:pPr/w:jc");
    expect(paths(tracker.unread())).toContain("unread w:document/w:body/w:p/w:pPr/w:ind");
  });

  it("tells a name matched and nothing read from a name matched on an empty element", () => {
    const { tracker, root } = tracked(PARAGRAPH);
    const body = findChild(root, "w:body");
    const p = body && findChild(body, "w:p");
    const pPr = p && findChild(p, "w:pPr");
    // A walk over `.children` that matches names and reads nothing else.
    for (const child of pPr?.children ?? []) {
      if (typeof child !== "string" && (child.name === "w:ind" || child.name === "w:keepNext")) continue;
    }

    const outcomes = paths(tracker.unread());
    expect(outcomes).toContain("examined w:document/w:body/w:p/w:pPr/w:ind");
    expect(outcomes).toContain("examined w:document/w:body/w:p/w:pPr/w:jc");
    // Nothing but its name: matching it is reading all of it.
    expect(outcomes.some((o) => o.endsWith("/w:keepNext"))).toBe(false);
  });

  it("leaves out what is dropped on purpose", () => {
    const { tracker } = tracked(PARAGRAPH);
    expect(paths(tracker.unread()).some((o) => o.includes("w:proofErr"))).toBe(false);
  });

  it("counts repeats of one path as one entry", () => {
    const { tracker, root } = tracked(
      `<w:document><w:body><w:p/><w:p/><w:p/></w:body></w:document>`,
    );
    expect(findChild(root, "w:body")).toBeDefined();
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

const letter = () =>
  new Uint8Array(readFileSync(join(__dirname, "../wordTestFiles/02-correspondence-c1c9a16460c1.docx")));

describe("importDocx — trackUnread", () => {
  it("reports nothing unread unless asked", async () => {
    const { report } = await importDocx(new ServerEditor(), letter());
    expect(report.unread).toBeUndefined();
  });

  it("finds the paragraph spacing a Word letter states and the import never reads", async () => {
    const { report } = await importDocx(new ServerEditor(), letter(), { trackUnread: true });
    const unread = report.unread ?? [];
    expect(unread.some((u) => u.outcome === "unread" && u.path.endsWith("/w:pPr/w:spacing"))).toBe(true);
    // Run spacing is read: the parser turns every run property into a mark.
    expect(unread.some((u) => u.path.endsWith("/w:rPr/w:spacing"))).toBe(false);
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

describe("importDocx — the ignored list", () => {
  it("does not warn about a property dropped on purpose", async () => {
    const { diagnostics, report } = await importDocx(new ServerEditor(), letter());
    expect(diagnostics.some((d) => d.markType === "szCs")).toBe(false);
    // Still counted: the report is the inventory.
    expect(report.counts["szCs"]?.dropped ?? 0).toBeGreaterThan(0);
  });
});
