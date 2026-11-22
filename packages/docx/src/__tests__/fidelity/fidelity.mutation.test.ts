import { describe, it, expect, beforeAll } from "vitest";
import type {
  DocumentLayout,
  DocxReport,
  DocxReportEntry,
  DocxUnreadElement,
  LayoutPage,
  PageConfig,
} from "@scrivr/core";
import { ServerEditor } from "@scrivr/core";
import { exportDocx, exportDocxBytes } from "../../export/export";
import type { DocxImportResult } from "../../import/import";
import { FIXTURES, editorWith, importFixture } from "./fixtures";
import { fixedWidthMeasurer, layOut, recordLayout, serializeLayout } from "./layoutLog";
import { serializeReports } from "./reportLog";
import { TYPED_AT_END, scoreEditedExport } from "./editedExport";
import { roundTripDifferences } from "./roundTrip";
import { failures, judge, judgeKnown, type Fraction } from "./scores";
import { paragraphsOfDocx, type WordParagraph } from "./wordReference";

/**
 * Proof that the fidelity baselines can fail.
 *
 * A log diffed against a baseline it produced is green by construction. So
 * each perturbation below is one a real change could plausibly cause, applied
 * to what a real fixture recorded, and the stored form is required to notice
 * it. If a field stops being recorded, the matching test here fails.
 *
 * Most perturb what goes into a recorder — a report, a layout, a set of
 * paragraphs, a table of scores — and leave the converter alone: what is under
 * test is whether the stored form tells two outcomes apart.
 */

const fixture = FIXTURES.find((f) => f.name.startsWith("01-"));
if (!fixture) throw new Error("fixture 01-* is missing from wordTestFiles");

describe("the report baseline notices", () => {
  let imported: DocxImportResult;
  let exported: DocxReport;
  let baseline: string;
  beforeAll(async () => {
    imported = await importFixture(fixture);
    exported = (await exportDocx(editorWith(imported.doc))).report;
    baseline = serializeReports(imported.report, exported);
  });
  const recorded = (report: DocxReport) => serializeReports(report, exported);

  it("an extension that stops counting an item it kept", () => {
    const counts: DocxReport["counts"] = imported.report.counts;
    const found = Object.entries(counts).find(([, c]) => c.kept > 0);
    if (!found) throw new Error("fixture 01 kept nothing");
    const [kind, count] = found;
    const report: DocxReport = { ...imported.report, counts: { ...counts, [kind]: { ...count, kept: count.kept - 1 } } };
    expect(recorded(report)).not.toEqual(baseline);
  });

  it("a node that loses its handler", () => {
    const noHandler: DocxReportEntry = { outcome: "dropped", kind: "paragraph", reason: "no handler", owner: null, count: 1 };
    const report: DocxReport = { ...imported.report, entries: [...imported.report.entries, noHandler] };
    expect(recorded(report)).not.toEqual(baseline);
  });

  it("a property moved onto the ignored list", () => {
    const unread: DocxUnreadElement[] = imported.report.unread ?? [];
    const at = unread.findIndex((u) => u.outcome === "unread");
    expect(at).toBeGreaterThanOrEqual(0);
    const ignored = (u: DocxUnreadElement): DocxUnreadElement => ({ ...u, outcome: "ignored" });
    const report: DocxReport = { ...imported.report, unread: unread.map((u, i) => (i === at ? ignored(u) : u)) };
    expect(recorded(report)).not.toEqual(baseline);
  });

  it("a w:spacing the parser stops reading", () => {
    // Unread elements are tallied by path, so one more unread `w:spacing` on a
    // path already listed shows as its count going up.
    const unread: DocxUnreadElement[] = imported.report.unread ?? [];
    const spacing = unread.findIndex((u) => u.outcome === "unread" && u.path.endsWith("/w:spacing"));
    expect(spacing).toBeGreaterThanOrEqual(0);
    const report: DocxReport = {
      ...imported.report,
      unread: unread.map((u, i) => (i === spacing ? { ...u, count: u.count + 1 } : u)),
    };
    expect(recorded(report)).not.toEqual(baseline);
  });
});

describe("the layout baseline notices", () => {
  type LaidBlock = LayoutPage["blocks"][number];
  type LaidLine = LaidBlock["lines"][number];

  let layout: DocumentLayout;
  let baseline: string;
  beforeAll(async () => {
    const { doc } = await importFixture(fixture);
    layout = layOut(editorWith(doc), fixedWidthMeasurer());
    baseline = serializeLayout(recordLayout(layout));
  });

  /** The layout with the first block on page one that `match`es replaced by `change` of it. */
  const changed = (match: (block: LaidBlock) => boolean, change: (block: LaidBlock) => LaidBlock): DocumentLayout => {
    const first = layout.pages[0];
    if (!first) throw new Error("fixture 01 laid out no pages");
    const at = first.blocks.findIndex(match);
    expect(at).toBeGreaterThanOrEqual(0);
    const blocks = first.blocks.map((block, i) => (i === at ? change(block) : block));
    return { ...layout, pages: [{ ...first, blocks }, ...layout.pages.slice(1)] };
  };

  /** The index of a line's first text span of two characters or more, or -1. */
  const textSpanAt = (line: LaidLine | undefined) =>
    line ? line.spans.findIndex((s) => s.kind === "text" && s.text.length >= 2) : -1;

  /** A line with the text of its span at `at` rewritten. */
  const rewriteSpan = (line: LaidLine, at: number, edit: (text: string) => string): LaidLine => ({
    ...line,
    spans: line.spans.map((s, i) => (i === at && s.kind === "text" ? { ...s, text: edit(s.text) } : s)),
  });

  it("one block's space after changed by a pixel", () => {
    const moved = changed(() => true, (block) => ({ ...block, spaceAfter: block.spaceAfter + 1 }));
    expect(serializeLayout(recordLayout(moved))).not.toEqual(baseline);
  });

  it("a line break moved by one character", () => {
    const moved = changed(
      (block) => textSpanAt(block.lines[0]) >= 0 && textSpanAt(block.lines[1]) >= 0,
      (block) => {
        const [first, second, ...rest] = block.lines;
        if (!first || !second) throw new Error("matched a block with fewer than two lines");
        const from = second.spans[textSpanAt(second)];
        const head = from?.kind === "text" ? from.text.charAt(0) : "";
        return {
          ...block,
          lines: [
            rewriteSpan(first, textSpanAt(first), (t) => t + head),
            rewriteSpan(second, textSpanAt(second), (t) => t.slice(1)),
            ...rest,
          ],
        };
      },
    );
    expect(serializeLayout(recordLayout(moved))).not.toEqual(baseline);
  });

  it("the page size changed from A4 to US Letter", async () => {
    // Page size is an input to layout, not a field of a laid-out block, so this
    // one lays the document out again rather than perturbing the recorded log.
    const { doc } = await importFixture(fixture);
    const usLetter = { pageWidth: 816, pageHeight: 1056, margins: { top: 96, right: 96, bottom: 96, left: 96 } } satisfies PageConfig;
    const onLetter = serializeLayout(recordLayout(layOut(editorWith(doc), fixedWidthMeasurer(), usLetter)));
    expect(onLetter).not.toEqual(baseline);
  });
});

describe("the edited-document scores notice", () => {
  const original = paragraphsOfDocx(fixture.bytes);

  it("one w:spacing removed from one untouched paragraph", () => {
    const spaced = original.findIndex((p) => p.pPr.includes("<w:spacing") && p.text.trim().length > 0);
    expect(spaced).toBeGreaterThanOrEqual(0);
    const perfect = scoreEditedExport(original, original, null);
    expect(perfect.untouched[0]).toBe(perfect.untouched[1]);

    const exported = original.map((p, i) =>
      i === spaced ? { ...p, pPr: p.pPr.replace(/<w:spacing[^>]*><\/w:spacing>/, "") } : p,
    );
    expect(scoreEditedExport(original, exported, null).untouched[0]).toBe(perfect.untouched[0] - 1);
  });

  it("the typed paragraph exported in Scrivr's default font", () => {
    // Typed after a paragraph whose first text carries a face or size of its
    // own, so a default-formatted paragraph differs from it.
    const at = original.findIndex((p) => /w:rFonts|w:sz /.test(p.segments[0]?.rPr ?? ""));
    const from = original[at];
    if (!from) throw new Error("fixture 01 has no paragraph with its own face or size");
    const typed = (pPr: string, rPr: string): WordParagraph => ({
      text: TYPED_AT_END,
      pPr,
      segments: [{ text: TYPED_AT_END, rPr }],
    });
    const exportedWith = (paragraph: WordParagraph) => [...original.slice(0, at + 1), paragraph];

    const matching = scoreEditedExport(original, exportedWith(typed(from.pPr, from.segments[0]?.rPr ?? "")), null);
    const defaulted = scoreEditedExport(original, exportedWith(typed("", "")), null);
    expect(matching.edits[0]).toBe(1);
    expect(defaulted.edits[0]).toBe(0);
  });
});

describe("the edited-document scores notice, from a real export", () => {
  // What Scrivr actually writes, not a perfect copy, of a fixture whose text
  // keeps its formatting, so the score is off the floor and a loss on top of
  // it can still lower it.
  const keeper = FIXTURES.find((f) => f.name.startsWith("04-"));
  if (!keeper) throw new Error("fixture 04-* is missing from wordTestFiles");
  const original = paragraphsOfDocx(keeper.bytes);
  let exported: WordParagraph[];
  let scored: number;
  beforeAll(async () => {
    const { doc } = await importFixture(keeper);
    exported = paragraphsOfDocx(await exportDocxBytes(editorWith(doc)));
    scored = scoreEditedExport(original, exported, null).untouched[0];
  });

  it("a kept paragraph with text exported with an alignment Word did not give it", () => {
    expect(scored).toBeGreaterThan(0);
    const unique = (text: string) => original.filter((o) => o.text === text).length === 1;
    const kept = exported.findIndex(
      (p) => p.text.trim().length > 0 && unique(p.text) && !p.pPr.includes("w:jc") && original.some((o) => o.text === p.text && o.pPr === p.pPr),
    );
    expect(kept).toBeGreaterThanOrEqual(0);
    const realigned = exported.map((p, i) => (i === kept ? { ...p, pPr: "<w:pPr><w:jc w:val=\"right\"></w:jc></w:pPr>" } : p));
    expect(scoreEditedExport(original, realigned, null).untouched[0]).toBe(scored - 1);
  });
});

describe("the round trip notices", () => {
  const list = (second: Record<string, unknown>) =>
    new ServerEditor({
      content: { type: "doc", content: [{ type: "bulletList", content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [second] }] },
      ] }] },
    }).getState().doc;

  it("a list split in two", () => {
    const item = (text: string) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    const doc = (lists: unknown[][]) =>
      new ServerEditor({ content: { type: "doc", content: lists.map((items) => ({ type: "orderedList", content: items })) } }).getState().doc;
    expect(roundTripDifferences(doc([[item("a"), item("b")]]), doc([[item("a")], [item("b")]]))).not.toEqual([]);
  });

    it("a change inside a list, as the item it is in", () => {
    const before = list({ type: "text", text: "second" });
    const after = list({ type: "text", text: "second", marks: [{ type: "bold" }] });
    expect(roundTripDifferences(before, after)).toEqual(['changed: bulletList > listItem > paragraph "second"']);
  });
});

describe("the score gates fail on a regression", () => {
  it("a fraction below its stored value", () => {
    const stored = { fixture: { untouched: [3, 10] satisfies Fraction } };
    expect(judge(stored, { fixture: { untouched: [2, 10] } }).regressions).toHaveLength(1);
    expect(judge(stored, { fixture: { untouched: [3, 10] } }).regressions).toEqual([]);
  });

  it("a stored metric the run no longer measures", () => {
    expect(judge({ fixture: { untouched: [3, 10] } }, { fixture: {} }).regressions).toHaveLength(1);
  });

  it("an improvement nobody recorded, in CI only", () => {
    const verdict = judge({ fixture: { untouched: [3, 10] } }, { fixture: { untouched: [4, 10] } });
    expect(verdict.regressions).toEqual([]);
    expect(failures("check", verdict, true)).toHaveLength(1);
    expect(failures("check", verdict, false)).toEqual([]);
  });

  it("one more of a known round-trip difference", () => {
    const stored = { fixture: ['changed: paragraph ""'] };
    expect(judgeKnown(stored, { fixture: ['changed: paragraph ""', 'changed: paragraph ""'] }).regressions).toHaveLength(1);
    expect(judgeKnown(stored, { fixture: ['changed: paragraph ""'] }).regressions).toEqual([]);
  });
});
