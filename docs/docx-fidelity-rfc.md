# DOCX Fidelity RFC — a Word file edited in Scrivr comes back as Word had it

Status: Draft (2026-11-04). Nothing here ships until it is agreed.

## Goal

A user uploads a Word document, edits it in Scrivr, and exports it. The `.docx`
they get back has their edits, and everything they did not touch is as Word had
it: the same page size and margins, fonts and sizes, spacing, and line and page
breaks.

Today that does not hold, and nobody can tell. Import drops much of what Word
wrote without saying so. Export cannot write back what import dropped. Nothing
in the test suite would notice either way.

## Direction

This RFC does two things, and the second is built on the first:

1. **An operational report on every DOCX import and export.** Each extension
   records, through the context its handler already receives, what it kept and
   what it dropped: paragraphs, line breaks, page breaks, images, tables, links.
   `importDocx` and `exportDocx` return that report next to `diagnostics`, so an
   app can say "imported 214 paragraphs and 37 line breaks; omitted 1 text box".
   This is public API.
2. **A test phase over documents people wrote in Word.** Twenty-five real
   documents are committed as fixtures. CI edits each one the way a user would,
   exports it, and checks that everything the edits did not touch still matches
   the original. It also snapshots each file's report, records the layout Scrivr
   gives it, and compares that with what Word saved in the file. The pattern follows the PDF op log
   (`packages/export-pdf/src/__tests__/opLog.ts`): record at a boundary,
   normalize the numbers, snapshot a baseline, and prove with a mutation test
   that the baseline can fail.

The report is what users see. The tests guard the report and measure the
distance to Word. One source of truth serves both, so a test can never disagree
with what a user was told.

## Where we actually are

We ran the 25 documents through import → layout → export → re-import. All 25
were saved by Microsoft Word, created between 2016 and September 2022 (before
ChatGPT), and edited across 11 to about 1,100 Word sessions. They come from the
public docx-corpus, 2–3 per document type (letters, forms, policies, reports,
legal, technical and others).

| Check | Result |
|---|---|
| Same page count as Word | 10 of 25 |
| Pages start where Word's do (Word's saved break positions) | 13 of 30 breaks |
| All text survives import | 21 of 25. One form keeps 2 of 8,464 characters |
| All imported text reaches a page | 24 of 25. One letter shows 78% |
| Same text after export → re-import | 25 of 25 |
| Same document after export → re-import (block ids aside, which import assigns fresh) | 21 of 25. Two gain a list item; in two, a run's marks change |

The causes, each traced to a file:

- **Paragraph and page settings are not imported.**
  `docx/src/import/parser.ts`, `parseParagraphProperties`, keeps a paragraph's
  style, alignment and list numbering. Spacing before and after, line height,
  indents, tab stops, keep-with-next, page size and margins are all dropped. So
  is the document's default paragraph formatting (`w:pPrDefault`). Layout then
  uses `defaultPageConfig`: A4 with 0.75-inch margins. Of the 25 files, 14 are US
  Letter (3 of them landscape), and 20 set paragraph spacing.
- **Text boxes are dropped.** `w:txbxContent` is never read. Five files use text
  boxes, and the form above keeps nearly all of its text in them.
- **Nested lists are not drawn.** `core/src/layout/PageLayout.ts`,
  `collectLayoutItems`, lays out only a list item's first child. A nested list
  is in the document but never reaches a page. This affects the editor too, not
  only import.
- **Theme fonts are ignored.** `docx/src/import/styles.ts` reads explicit font
  names but not theme references (`w:asciiTheme="minorHAnsi"`, which is Calibri
  in most files). Text falls back to Scrivr's default face.
- **The diagnostics point the wrong way.** Every file warns, almost always about
  complex-script properties (`szCs` 128 times, `bCs` 8 times), which change
  nothing for these documents. None of the losses above produces a diagnostic.

A generated document (a Master Services Agreement, measured separately) shows
the same drops: page size and margins, `w:ind` 84 times, `w:spacing`, table
alignment and cell margins. It reported 349 `szCs` diagnostics and nothing
else. So the gap is not specific to how people write; it is in what the
importer reads and what it reports.

The last cause is why a report is needed rather than more unit tests.
`unsupported-*` diagnostics fire only for an element the importer inspects and
rejects. Anything it never looks at is dropped silently and counted nowhere,
so its own account says the files with the worst losses are fine.

## Non-goals

- **Matching Word pixel for pixel.** Word's layout engine is not specified, and
  we cannot run Word in CI. The reference is what Word wrote into the file
  (§4), not a rendering of it.
- **Covering all of OOXML.** The phase measures what ordinary documents use. A
  feature that no fixture uses is out of scope until one does.
- **Fixing the gaps above.** Each fix is its own change, with a before and after
  in the report and the logs.
- **Replacing diagnostics.** Diagnostics stay the channel for warnings and
  errors. The report is the inventory; a diagnostic is a warning.

## 1. Why neither the diagnostics nor the tests can see this

`packages/docx/src/import/*.test.ts` builds its input with `exportDocxBytes` or
with hand-written XML. Both contain only what their author thought of. A
round-trip test passes whenever export and import agree, and they agree on
everything Scrivr cannot represent, because neither side writes it. Nothing
compares Scrivr's output with Word's.

The diagnostics cannot stand in for that comparison either. They report what a
handler refused, not what the parser never looked at, and the parser never
looks at most of what changes a layout.

## 2. Decision — extensions report what they kept and dropped

An extension owns every lane its node crosses, including both DOCX directions
(`docs/format-lane-ownership-rfc.md`). So the extension that imports or exports
a node is the one that says what became of it. Core does not count on an
extension's behalf.

Both contexts gain a `report` next to `diagnostics`:

```ts
// @scrivr/core, exports/docx.ts — on DocxContext and DocxImportContext
report: {
  /** The handler wrote (export) or built (import) `count` of `kind`. */
  kept(kind: string, count?: number): void;
  /** Something of `kind` did not make it across, and why. */
  dropped(kind: string, reason: string): void;
  /** It made it across, but not as Word had it ("spacing ignored"). */
  changed(kind: string, reason: string): void;
};
```

The dispatchers fill in what an extension cannot know about itself:

- **The owner.** `walker.ts` (export) and `transform.ts` (import) know which
  handler is running, so every entry carries the extension that made it.
- **Nodes with no handler.** The dispatcher records those as `dropped` with the
  reason `"no handler"`. Today they produce `unsupported-*` diagnostics, which
  stay as they are.

The result returns the report as data:

```ts
interface DocxReport {
  /** Per kind ("paragraph", "hardBreak", "pageBreak", "image", …). */
  counts: Record<string, { kept: number; dropped: number; changed: number }>;
  /** Every drop and change, with its owner and reason, in document order. */
  entries: DocxReportEntry[];
  /** Import only, when `trackUnread` is on: Word XML never read (§3). */
  unread?: DocxUnreadElement[];
}

interface DocxExportResult { bytes: Uint8Array; diagnostics: DocxDiagnostic[]; report: DocxReport }
interface DocxImportResult { doc: PmNode; diagnostics: DocxDiagnostic[]; report: DocxReport }
```

`report` is a new field on both results, so existing callers keep working.
Counting is a counter increment per handled node, so it is always on.

**Pages.** A `.docx` has no pages until Word lays it out, so export cannot count
pages. It counts what decides them: page breaks, and the page size and margins
it wrote or omitted. On import, the page settings Word wrote are reported as
kept or dropped. The page comparison itself is a layout question and lives in
the test phase (§5).

## 3. Decision — import can report what it never read

Counting handled nodes cannot see what the parser never looked at, and that is
the largest loss. So import gains an option:

```ts
importDocx(editor, bytes, { trackUnread: true });
```

With it on, `parseOoxml` returns its element tree wrapped in a `Proxy` that
records each read. That covers the helpers (`findChild`, `attr`, …) and the 53
places where the parser walks `.children` directly, without changing any of
them. The helpers search the unwrapped tree and mark only what they return.
Otherwise `findChild(pPr, "w:jc")` would count its sibling `w:spacing` as read.

Each element ends with one of these outcomes:

| Outcome | Meaning | Example today |
|---|---|---|
| `read` | Its attributes or children were read, or a helper returned it. An element with nothing but its name counts as read once its name is matched | `w:jc`, a run's `w:tab` |
| `examined` | Its name was matched, but nothing in it was read | `w:pgSz`, `w:pgMar` |
| `ignored` | On a reviewed list of properties dropped on purpose | `w:szCs`, `w:proofErr`, `rsid*` |
| `unread` | Never looked at — a silent drop | `w:ind`, `w:keepNext`, `w:tabs`, `w:pPrDefault` |

The option is off by default because a proxy on every element costs time on a
large file. The tests always turn it on. A spike on one of the corpus letters
gave the outcomes in the table, and of its 246 `w:spacing` elements, 154 were
`unread`; the 92 read were inside run properties.

The `ignored` list also fixes the diagnostics. A property on it stops producing
a warning. Moving a property onto it is a reviewed decision with a reason, not
a side effect.

## 4. Decision — the reference is what Word recorded in the file

Every `.docx` saved by Word carries its own account of the layout:

| Word records | Where | Used as |
|---|---|---|
| Page size and margins | `w:sectPr` → `w:pgSz`, `w:pgMar` | Expected page geometry |
| Where each page started when the file was last saved | `w:lastRenderedPageBreak` in `document.xml` | Expected page starts |
| Paragraph spacing, indents, line height | `w:pPr`, `w:pPrDefault`, styles | Expected block geometry |
| Fonts and sizes, including theme fonts | `w:rPr`, `w:rPrDefault`, `theme1.xml` | Expected faces |
| Page count | `docProps/app.xml` `<Pages>` | Cross-check only |

`lastRenderedPageBreak` is the strongest of these: it is Word's own pagination,
saved with the text. `<Pages>` and `<Lines>` in `app.xml` are often stale. One
of the 25 files claims 10 lines over 3 pages, so they are a cross-check and
never a gate.

## 5. The test phase

For each committed fixture, CI runs import → layout → export → re-import, and
an edit-then-export pass, and checks five things.

**The edited document — the goal, measured.** Each fixture is imported and given
the same scripted edits a user would make, through editor commands:

1. type a new paragraph at the end of the body;
2. insert a paragraph between two existing ones in the middle;
3. bold one word in an existing paragraph.

Then it is exported, and the exported XML is compared with the original file:

- **Untouched paragraphs keep Word's formatting.** The edits are known, so the
  paragraphs they did not touch are known too. For each one, the exported
  paragraph properties (`w:pPr`) and run properties (`w:rPr`) must equal the
  original's, ignoring `rsid*` attributes and proofing marks. Score: untouched
  paragraphs preserved, n of m.
- **Edits take the document's formatting.** The typed and inserted paragraphs
  must export with the style, font and size of the paragraphs around them, not
  Scrivr's defaults. The bolded word must keep every other run property it had.
  Score: edits matching their surroundings, n of 3.

The first score is the one this work exists to raise. Today it will be low,
because import drops paragraph properties and export cannot write them back.
Each Phase 3 fix moves it up, and the check stops it from sliding back.

**Import and export reports, snapshotted.** The `DocxReport` from §2 and §3,
written with entries in document order. A change that makes an extension keep
or drop something different changes the snapshot.

**Layout log — what Scrivr put on each page.** Test-only, read from the
`DocumentLayout` that `runPipeline` returns:

```ts
type LayoutOp =
  | { op: "page"; page: number; width: number; height: number; margins: Margins }
  | { op: "block"; page: number; type: string; x: number; y: number; width: number;
      height: number; spaceBefore: number; spaceAfter: number; lines: string[] };
// lines: the first 16 characters of each line, so a moved line break shows up
```

Numbers go through `normalizeDrawNumber` (three decimals, no negative zero).
The function moves from the PDF log into `@scrivr/core` and is exported there,
so the PDF log and this log share one rounding rule.

Snapshots are taken with a **fixed-width measurer**: a `TextMeasurer` whose
context gives every glyph the same advance. Real font metrics differ between
Linux CI and a laptop (CLAUDE.md, Test Setup), so a baseline built on them would
move for reasons unrelated to the change under test. With fixed widths, the log
isolates the decisions layout makes: spacing, page geometry and where blocks
split.

**Round trip.** Import → export → re-import should give the same document,
comparing node types, text, marks and attributes and ignoring `nodeId` (import
assigns fresh ids). Any difference is a bug in one direction or the other.
Today 4 of the 25 differ. Those 4 are stored as known differences, and a new
difference fails.

**The Word comparison.** Real font metrics this time. It compares Scrivr's
layout with §4 and records, per fixture: page starts matched, page geometry
matched, and text retained.

**How results are judged.** All the scores above are stored per fixture. A
known gap does not fail the build. It is logged,
and when `GITHUB_STEP_SUMMARY` is set the comparison is also written to the
GitHub CI job summary, so a reviewer reads it on the PR. A score below its
stored value is a regression and fails. A score that rises passes, and the
change updates the stored value. The snapshots (report and layout log) fail on
any difference, as the PDF log's do; updating one is a reviewed diff.

It all runs inside `pnpm test`, which `ci.yml` already runs, so there is no
workflow change.

## 6. Fixtures — documents people wrote in Word

**The 25 documents are committed** in `packages/docx/src/wordTestFiles/`. They
are the base for every later run. `package.json` publishes only `dist`, so they
do not ship to npm.

**Provenance is committed with them**, in `SOURCES.tsv`: the application and
version that saved each file, its created and modified dates, its number of edit
sessions (distinct `w:rsid` values), its word count, and its docx-corpus id.
They were chosen by provenance, not by analysing their text: saved by Word,
created before ChatGPT, edited over several sessions. The corpus id means any
file can be traced, or removed on request.

**Developers add fixtures in Word when a pattern is too thin.** Keep-with-next
appears in only 3 files and landscape pages in 3, for example. A new fixture is
written in Word itself, not generated as XML, so it carries Word's own
`lastRenderedPageBreak` and `pPrDefault`. It gets a provenance row that also
records the platform, since Word for Windows and Word for Mac paginate
differently. A fixture not saved by Word is rejected.

What the 25 cover:

| Pattern | Files using it, of 25 |
|---|---|
| Paragraph spacing / indents | 20 / 20 |
| Tab characters / custom tab stops | 17 / 9 |
| Lists | 13 |
| Images | 13 |
| Tables / shading | 12 / 11 |
| Hyperlinks / fields | 8 / 7 |
| Text boxes | 5 |
| Keep-with-next | 3 |
| US Letter (3 landscape) / A4 | 14 / 11 |

## 7. The baseline must be able to fail

A log diffed against a baseline it produced is green by construction. As in
`opLog.mutation.test.ts`, each recorder gets perturbations that a real change
could plausibly cause, and the diff must notice every one:

- **Report:** an extension stops calling `kept` → its count changes. A node
  loses its handler → a `"no handler"` drop appears. A property moves onto
  `ignored` → its outcome changes.
- **Unread tracking:** one `w:spacing` read is removed → that element becomes
  `unread`.
- **Layout:** one block's `spaceAfter` changes by 1px; one line break moves by
  one character; the page size changes to A4.
- **Edited document:** one `w:spacing` is removed from one untouched paragraph
  in the export → the untouched score drops. The typed paragraph exports with
  Scrivr's default font → the edit score drops.

If a field stops being recorded, the matching mutation test passes when it
should fail, which shows the field has gone missing.

## 8. Behaviour changes we accept

- `importDocx` and `exportDocx` return a `report`. Additive; no existing field
  changes.
- Both contexts gain `report`. An extension that never calls it still gets the
  dispatcher's entries.
- `importDocx` accepts `trackUnread`. Off by default, so nothing changes unless a
  caller asks.
- Properties on the `ignored` list stop producing diagnostics. This is the only
  change to existing output, and it removes noise: `szCs` alone produced 128
  warnings across the 25 files.

Nothing else. The test phase records today's behaviour, wrong output included.
A wrong rendering preserved in the baseline is a correct baseline. A fix
changes the report and the logs, and that diff is the fix's evidence.

## 9. Alternatives considered

| Alternative | Why not |
|---|---|
| Test-only recorders, no public report | Catches regressions, but the user is still not told what their file lost. The report serves both, from one source |
| Render each file in Word and diff pixels | Word does not run in CI, and its layout is not specified. What Word saved in the file (§4) is in every fixture and needs nothing installed |
| Diff the exported `.docx` bytes | Zip compression, part order and generated ids move without anything visible changing. The PDF log rejected byte diffs for the same reason |
| Generate fixtures as XML | Only contains what its author thought of — the blind spot this RFC exists to close. Real Word files carry Word's own pagination and defaults |
| More `unsupported-*` diagnostics | Diagnostics fire only for what the parser inspects. The losses are in what it never inspects (§3) |

## 10. Questions a reviewer will ask

- **Does the report slow down import or export?** Counting is one counter
  increment per handled node. The expensive part, unread tracking, is off unless
  a caller turns it on.
- **Can an extension forget to report?** It can, so the dispatcher records every
  node it hands to a handler, and every node with no handler, whether or not the
  extension says anything. The extension's own entries add detail, such as
  "spacing ignored", that the dispatcher cannot see.
- **Why not fix the gaps first?** Without the report and the scores, a fix
  cannot show what it changed or prove that it broke nothing else. The page-size
  fix alone moves every line on every page.
- **Will baselines churn between machines?** Snapshots use a fixed-width
  measurer, so no. Only the Word comparison uses real fonts, and it stores
  scores, not positions.
- **Why commit third-party documents?** They are the base every later run
  compares against, and Scrivr's own tests cannot produce what people write.
  Each has a provenance row with its corpus id, so any can be traced or removed.
- **Is "what Word saved" a fair reference?** For page size, margins, spacing and
  fonts it is exact: it is what Word itself uses. For page breaks it is what Word
  showed when the file was last saved, which is why page starts are scored
  rather than required.

## 11. Phases

Each is independently reviewable and shippable.

| Phase | Work | Gate |
|---|---|---|
| **0** | `report` on both contexts and results; dispatcher entries (owner, `"no handler"`); `normalizeDrawNumber` exported from core | Unit tests for the report; PDF baselines unchanged |
| **1** | Each built-in extension reports its lane: Paragraph, Heading, HardBreak, PageBreak, Image, Table, List, Link, … ; `trackUnread`; the `ignored` list | Every StarterKit extension with a DOCX handler reports; the spike's outcomes reproduce |
| **2** | The test phase (§5) over the 25 committed fixtures: edited-document check, report snapshots, layout log, round trip, Word comparison, mutation tests (§7) | Mutation-proven; the comparison reproduces "Where we actually are" |
| **3+** | The fixes, one change each, in this order: page size and margins; paragraph spacing and indents; theme fonts; nested-list layout; text boxes | The report and logs change only where the fix intends; the untouched-paragraph score rises |

The fix order follows reach. Page size changes every line of the 14 Letter
files. Spacing and indents appear in 20 of 25. Text boxes appear in 5.

## Decisions

Settled on 2026-11-04:

1. **The report is public API.** Apps can show users what an import or export
   kept and dropped (§2).
2. **The 25 documents are committed** as the base fixtures, with provenance
   (§6). Developers add Word-authored fixtures where a pattern is thin.
3. **Unread tracking records at the boundary.** The proxy wraps the parsed tree;
   the parser itself is not changed (§3). Confirmed by a spike.
4. **The Word comparison runs in GitHub CI**, inside `pnpm test`, and is written
   to the job summary (§5).
5. **A known gap does not fail the build.** It is logged. A regression fails: a
   score below its stored value, a new round-trip difference, or an unreviewed
   snapshot change (§5).
6. **`@scrivr/core` exports `normalizeDrawNumber`** (§5).

## Release

- **This RFC and the fixtures:** no changeset. Docs and test data only, as with
  earlier RFC-only changes.
- **Phase 0:** `patch` for `@scrivr/core` (new context field and export) and
  `@scrivr/docx` (new result field), as additive API in this repo is.
- **Phase 1:** `patch` for `@scrivr/core` and `@scrivr/docx`. Extensions start
  reporting, `trackUnread` is added, and the `ignored` list quiets diagnostics.
- **Phase 2:** empty changeset ("No release. Test-only: …"), as with the PDF
  op-log baseline.
- **Phase 3+:** each fix carries its own changeset.

## Files to create / modify

**Phase 0**
- `packages/core/src/exports/docx.ts` — `report` on `DocxContext` and
  `DocxImportContext`; `DocxReport` and its entry types
- `packages/core/src/exports/` — a module holding `normalizeDrawNumber`,
  re-exported from `packages/core/src/index.ts`
- `packages/docx/src/export/createContext.ts`, `import/context.ts` — the
  recorder behind `report`
- `packages/docx/src/export/walker.ts`, `import/transform.ts` — owner and
  `"no handler"` entries
- `packages/docx/src/export/export.ts`, `import/import.ts` — `report` on the
  results
- `packages/export-pdf/src/__tests__/opLog.ts` — imports `normalizeDrawNumber`
  from core

**Phase 1**
- Each StarterKit extension with `addImports()` / `addExports()` — `kept`,
  `dropped`, `changed` calls in its DOCX handlers
- `packages/docx/src/import/xml.ts` — the read-tracking proxy behind
  `trackUnread`
- `packages/docx/src/import/ignored.ts` — the reviewed `ignored` list

**Phase 2**
- `packages/docx/src/__tests__/fidelity/layoutLog.ts`, `wordReference.ts`
- `packages/docx/src/__tests__/fidelity/editedExport.test.ts` — the scripted
  edits and the untouched-paragraph check
- `packages/docx/src/__tests__/fidelity/*.baseline.test.ts`,
  `*.mutation.test.ts`, `roundTrip.test.ts`, `wordComparison.test.ts`
- `packages/docx/src/__tests__/fidelity/scores.json` — stored scores per fixture

## Dependencies

None. `runPipeline` is exported from `@scrivr/core` (`layout/index.ts`) and
takes a measurer, so the docx package can lay a document out without an editor
or a DOM, as `LayoutCoordinator.layoutForExport` already does.
