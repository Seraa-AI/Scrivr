# Columns RFC — Newspaper (Snaking) Columns

> Status: **design / RFC** — engine not started. Multi-column ("newspaper") text flow for Scrivr, built on the region contract in [`resumable-layout-rfc.md`](./resumable-layout-rfc.md) and the section substrate in [`sections-roadmap.md`](./sections-roadmap.md).

## Direction

Support text that **snakes**: it fills column 1 to the bottom of the content area, continues at the top of column 2, and only then advances to the next page. Column count is a **section-scoped** property (a run of the document is N-up), so a full-width title can sit above a 2-up body, matching Word/Pages/InDesign.

How content is consumed, where it breaks and which region comes next is the contract in the [resumable layout RFC](./resumable-layout-rfc.md). This document owns what is specific to columns: the model, the region geometry a section generates, Word's behaviour, and the feature's phases. Where this document and the contract disagree, the contract wins.

`layoutBlock()` lays out a block at any `(x, availableWidth)`, so measurement is column-ready. The rest is not: three places decide page breaks today, floats are placed on pages, and the arrow keys and drag geometry assume one region per page.

<a id="word-measured"></a>
## Word's behaviour, measured

Word for Mac 16.111, Letter page, 1in margins, Arial 12 at exactly 20pt, widow control off, two columns of 216pt with a 36pt gap (x 72 and 324), compatibility mode 15 unless said. Positions read from Word itself.

| Case | Word |
|---|---|
| Title, 11 lines in 2 columns, continuous break, full width | Balanced 6 + 5. The next section starts under the taller column |
| The same, ended by a next-page break | Not balanced: 11 + 0 |
| The same, in the final section | Not balanced |
| 70 lines over two pages, then a continuous break | Page 1 full (31 + 31); page 2 balanced 4 + 4 |
| 5 lines in 2 columns then 7 in 3, both continuous | 3 + 2, then 3 + 3 + 1 |
| A block with 60pt after it at the foot of column 1 | Those 60pt count: the next section starts below them |
| `noColumnBalance`, mode 12 and 14 | Not balanced; next section starts at the largest bottom |
| `noColumnBalance`, mode 15 | **Ignored**: balanced |
| A column break inside the section | What follows it starts column 2; nothing is moved back over the break |
| `before` 12pt, landing at the top of column 2 below a title | Kept: text starts 12pt down |
| `before` 10pt after an `after` of 20pt, same place | Adds nothing |
| `before` 12pt, landing at the top of column 2 of a page-tall section, or of page 2 | Dropped |
| `after` 20pt, then a continuous break, then `before` 30pt | 30pt between them: collapsed, as in one column |
| A float anchored in column 2, reaching over column 1 | Column 1's text wraps it. The anchor moved down and the float stayed |
| A float anchored in column 1, reaching over column 2 | Column 2's text wraps it |
| A 400pt float in a 216pt column | Stays 400pt wide |
| A top-and-bottom float, 100pt wide, in column 2 | Clears column 2 only |
| A float in a balanced section | Counted in the balance (the gap is in column 1's height) |
| A line taller than the page, met in column 1 | Skips column 2, lands alone on the next page |
| A table row that does not fit in column 1 | Splits into column 2 |
| A row whose second cell cannot start | Moves whole |

ECMA-376 agrees on the default: "Typically, column balancing is automatically performed on the contents of sections with multiple columns" (`noColumnBalance`). Not measured: the arrow keys (Word's scripting has no command for them), unequal widths, and widow control, which is on by default in Word and can move one line between balanced columns.

## Non-goals (v1)

- **Balanced fill anywhere Word does not balance.** Before a continuous break it does, and v1 follows (resumable layout RFC, Phase 5).
- **Unequal column widths.** v1 is `equalWidth`. The measure cache carries one width per block.
- **Column-spanning blocks** (a heading that breaks the snake to span all columns). Deferred; see Open Questions.
- **Splitting a table row between columns.** A table in a column works: its units are atomic there, as on a page. Splitting a row is the resumable layout RFC's Phase 7 and blocks nothing here.

## Columns ≠ Tables

The table work is a useful *measurement* analog but not a *flow* analog, and conflating them is the trap:

| | Tables | Newspaper columns |
|---|---|---|
| Block→region binding | A block lives in exactly one cell | A block is *assigned* to whichever region it lands in |
| Flow | Content never crosses cells | One continuous flow snakes across regions |
| Streams | Separate streams, one per cell, accepted together | One stream through every region |
| Where it lives | The Table extension's `CompositeLayout`, laid out by `layout/compositeLayout.ts` | The fill loop, over regions a section's run generates |

They share the fill machinery (`fillRegion`, the flow container) and own their content differently: a column owns no node.

## Standards baseline

### DOCX / OOXML — columns are a section property

```xml
<w:sectPr>
  <w:cols w:num="2" w:space="720" w:equalWidth="1"/>   <!-- 720 twips = 0.5in gutter -->
</w:sectPr>
```

- Unequal: `<w:cols w:num="2"><w:col w:w="4320" w:space="360"/><w:col w:w="4752"/></w:cols>` (deferred).
- **Column break:** `<w:br w:type="column"/>` — the exact sibling of `w:type="page"`, which the importer already parses and splits on (`packages/docx/src/import/parser.ts`).
- A section's `sectPr` lives in the **last paragraph's** `pPr`; the final section's at body level — the single default `<w:sectPr>` the exporter already emits (`packages/docx/src/export/defaults.ts`). The importer reads only header and footer references from the body `sectPr`; section breaks and `<w:cols>` are not modelled yet.
- **`<w:type>` describes how *its own* section starts**, while our `sectionBreak.breakType` describes how the next one does. The import and export shift it by one section (measured: a next-page break is written on the section *after* it).

### ProseMirror — keep the tree linear

PM has no native column flow (normally the browser's job via CSS multicol). Community editors model columns either as **container nodes** (`columns` > N × `column`, content `block+`) — which is *fixed side-by-side* content that does **not** snake, structurally identical to our table cells — or as a presentational CSS wrapper we can't borrow (no browser lays out our canvas). The `prosemirror-tables` precedent is the lesson: complex 2D layout is **a node/marker + a dedicated layout driver, never encoded as tree shape**. The content tree stays linear; the visual flow wraps. So newspaper columns are a **boundary/attribute**, not a container.

## Data model

Columns extend the section substrate already designed in `sections-roadmap.md`. No new top-level concept.

### Section settings (extend the existing shape)

```ts
// sections-roadmap.md Section.settings, extended:
settings: {
  // ...existing header/footer settings...
  columns: {
    count: number;       // default 1
    gap: number;         // px; default 24
    equalWidth: true;    // unequal widths are deferred
  }
}
```

Sections are derived from `sectionBreak` boundaries; ranges are never persisted.
Each intermediate break carries the settings of the section it terminates, and
`doc.attrs.finalSection` carries the final section. A document with no
section breaks is one implicit section with `columns.count: 1` — the degenerate
case, identical to today. See `sections-roadmap.md` for the ownership and
normalization invariants.

### Nodes

- **`sectionBreak`** — an atom node carrying the settings of the section it
  terminates. This exactly matches paragraph-level DOCX `sectPr` ownership and
  keeps the body tree flat. Layout obtains the following section's settings
  from the next terminator (or `finalSection`) through
  `deriveSections(doc)`.
- **`columnBreak`** — a hard break that forces a region advance to the next column (new page if in the last column). Mirrors `pageBreak` exactly: atom, `group: "block"`, and the importer maps `<w:br w:type="column"/>` to it the same way it maps `w:type="page"` → `pageBreak`.

There is deliberately no temporary `doc.attrs.columnCount` fallback. The
region-cursor refactor can be verified with one generated region per page; the
first public column settings land directly in `SectionSettings`.

## Region geometry

For a run with `count = N`, gap `g`, and the page's content box `W` wide:

```text
width = (W - g*(N-1)) / N
box[i] = { x: i * (width + g), width }
```

That is all a section says to the engine: an ordered list of boxes, and how the run ends (`model/sectionFlow.ts`). Core never sees `columns`. Pages, tops, bottoms, progression, closing and balancing are the resumable layout RFC's §5. One box per run is today's layout.

## What each part needs

| Part | Change |
|---|---|
| `collectLayoutItems` | None to the walk. A section boundary becomes the end of a run |
| `buildBlockFlow` | Width from the item's run, not from the page margins |
| Global Y, floats | **Not** unchanged, as an earlier version said. Exclusions are page-scoped and read per region; the settle works by touched region; a placement can invalidate an earlier region of the same page |
| `paginateFlow` | Emits what the fill loop landed |
| `buildFragments` | Page blocks stay in reading order, which is no longer y order |
| Phase 1b tail reuse | Keys on region and run structure; never starts inside a run that balances |

## Rendering, selection, navigation

- **Rendering:** blocks carry absolute `x`, so the painter draws each part where it sits. A vertical **rule line** between columns is paint-only (Open Question). `AiSuggestion`'s stripe and `SourcedBlock`'s gutter read `margins.left` and must read the block's region.
- **Headers and footers:** Columns divide the body content box only. Page chrome
  remains full-width and renders once per physical page. When a continuous
  section starts mid-page, the first section present on that page owns its
  header/footer; the new section's chrome takes effect on the first later page
  it owns. Pagination records this page-to-section ownership explicitly. See
  `sections-roadmap.md`.
- **Hit-testing:** `CharacterMap.lineAtPoint` filters by x as well as y, so a click in column 2 resolves there. The gutter resolves to the nearest line.
- **Caret nav needs code.** `posBelow` takes the next line *down the page*, so at the foot of column 1 it goes past column 2 altogether, and even given the right line it would resolve the old x back into column 1. The rule is in the resumable layout RFC's §9: within a region by y, then to the region next in reading order with x moved by the difference of their origins.
- **Node rects** union per page; across columns they need one rect per region.
- **Drag** maps page y to global Y by page. With two regions it needs the region under the pointer.
- **Pageless** has no column bottom: one column.

## Export parity

Per `feedback_pdf_parity`: any new layout the canvas renders must render in PDF, and tree-driven exports must round-trip.

- **PDF** (`@scrivr/export-pdf`): draws each block at its own `x`, so column text should follow. An `x` does not prove parity: the op log of a multi-column document is compared with the canvas (floats, justified lines, links, outline destinations), and a column rule is painted only if the canvas paints one.
- **DOCX** (`@scrivr/docx`): emit `<w:cols w:num w:space>` into the section's `sectPr`; map `columnBreak` → `<w:br w:type="column"/>`. Import has no section breaks yet; that work reads `<w:cols>` and shifts `<w:type>` (above).
- **Markdown**: no column concept; columns flatten to linear blocks (lossy, documented), same as other layout-only properties.

## Phased implementation

Section substrate landed (`SectionSettings`, `sectionBreak`, `finalSection`, `deriveSections`, commands); `columns.count` is carried and reads as `1` everywhere. The engine phases are the resumable layout RFC's:

| Here | There |
|---|---|
| Regions and cursor, one per page | Phase 1 |
| Paragraph continuation, flow filling | Phase 2 |
| Exclusions by region | Phase 3 |
| **Sequential equal-width columns**, `continuous` and `nextPage` transitions | Phase 4 |
| **Balancing** before a continuous break, released with the above | Phase 5 |

Then, on this RFC: `columnBreak` (schema node, command, keymap, a run ending, DOCX `<w:br w:type="column"/>`); DOCX `<w:cols>` round trip; the toolbar control and column rule.

Deferred: unequal widths; column-spanning blocks.

## Open questions

1. ~~**Fill strategy.**~~ Word balances before a continuous break and nowhere else (measured above). Decision pending in the resumable layout RFC §14.2.
2. **Unequal column widths.** Needs the per-column cache key. Rare; defer.
3. **Column-spanning blocks.** Word's "span all columns" for headings/figures. Needs the region loop to handle a full-width block mid-section (close the open regions, emit one full-width region, resume). Moderate; deferred.
4. ~~**Float confinement.**~~ Word does not confine a float to its column. Decision pending in the resumable layout RFC §14.4.
5. **Column rule line.** Cosmetic vertical rule between columns. Paint-only; low risk; with the toolbar control if wanted.

## Dependencies

- **Sections substrate** (`sections-roadmap.md`) is Phase 0. Columns do not need
  the later section-aware header/footer controller and surface work.
- **Resumable layout Phases 1–3** come first. Table row splitting (Phases 6–7) does not.

## What shipped

The section substrate (#146). Nothing of the column engine.
