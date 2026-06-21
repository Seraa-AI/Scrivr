# Columns RFC — Newspaper (Snaking) Columns

> Status: **design / RFC** — not started. Proposes multi-column ("newspaper") text flow for Scrivr, built on the `ContentRegion` abstraction sketched in [`pagination-model.md`](./pagination-model.md) and the section substrate in [`sections-roadmap.md`](./sections-roadmap.md).

## Direction

Support text that **snakes**: it fills column 1 to the bottom of the content area, continues at the top of column 2, and only then advances to the next page. Column count is a **section-scoped** property (a run of the document is N-up), so a full-width title can sit above a 2-up body, matching Word/Pages/InDesign.

The layout engine is already column-ready at the measurement layer. `layoutBlock()` is stateless and lays out a block at any `(x, availableWidth)` ([`layout-pipeline-architecture.md`](./layout-pipeline-architecture.md):126 — "Table cells and column blocks already call it"). `CharacterMap` is already a unified 2D model keyed by `(page, lineIndex, x, contentWidth)`, so hit-testing and caret nav resolve across side-by-side regions without change. **The work is concentrated in pagination** — teaching it that a page is an ordered list of regions, not one box.

## Non-goals (v1)

- **Balanced columns** (equal-height fill). v1 is sequential fill. See Open Questions.
- **Unequal column widths.** v1 is `equalWidth`. The cache caveat below is why.
- **Column-spanning blocks** (a heading that breaks the snake to span all columns). Deferred; see Open Questions.
- **Tables inside columns.** Tables already run their own mini-pipeline; nesting is out of scope until both land independently.

## Columns ≠ Tables

The table work is a useful *measurement* analog but not a *flow* analog, and conflating them is the trap:

| | Tables | Newspaper columns |
|---|---|---|
| Block→region binding | A block lives in exactly one cell | A block is *assigned* to whichever region it lands in |
| Flow | Content never crosses cells | One continuous flow snakes across regions |
| Where it lives | `TableLayoutEngine` lays cells side-by-side and stops | `paginateFlow` walks the whole doc and advances region→region |

So we reuse `layoutBlock` (measure a paragraph at a column's width) but the snake logic is new and belongs in pagination.

## Standards baseline

### DOCX / OOXML — columns are a section property

```xml
<w:sectPr>
  <w:cols w:num="2" w:space="720" w:equalWidth="1"/>   <!-- 720 twips = 0.5in gutter -->
</w:sectPr>
```

- Unequal: `<w:cols w:num="2"><w:col w:w="4320" w:space="360"/><w:col w:w="4752"/></w:cols>` (deferred).
- **Column break:** `<w:br w:type="column"/>` — the exact sibling of `w:type="page"`, which the importer already parses and splits on (`packages/docx/src/import/parser.ts:196`).
- A section's `sectPr` lives in the **last paragraph's** `pPr`; the final section's at body level — the single default `<w:sectPr>` the exporter already emits (`packages/docx/src/export/defaults.ts:127`). The importer currently **drops** `<w:sectPr>` (`parser.ts:73` "Not modeled yet"); columns wire through that seam, giving near-free round trip.

### ProseMirror — keep the tree linear

PM has no native column flow (normally the browser's job via CSS multicol). Community editors model columns either as **container nodes** (`columns` > N × `column`, content `block+`) — which is *fixed side-by-side* content that does **not** snake, structurally identical to our table cells — or as a presentational CSS wrapper we can't borrow (no browser lays out our canvas). The `prosemirror-tables` precedent is the lesson: complex 2D layout is **a node/marker + a dedicated layout driver, never encoded as tree shape**. The content tree stays linear; the visual flow wraps. So newspaper columns are a **boundary/attribute**, not a container.

## Data model

Columns extend the section substrate already designed in `sections-roadmap.md`. No new top-level concept.

### Section settings (extend the existing shape)

```ts
// sections-roadmap.md Section.settings, extended:
settings: {
  // ...existing header/footer settings...
  columnCount: number;   // default 1
  columnGap: number;     // gutter in px, default 24 (~0.33in; DOCX default is 720 twips = 0.5in)
}
```

Storage stays `doc.attrs.sections: Section[]` (range-based `from`/`to`). A document with no section breaks is one implicit section with `columnCount: 1` — the degenerate case, identical to today.

### Nodes

- **`sectionBreak`** — already on the sections-roadmap migration path (step 2). An atom node carrying the section settings that apply *from this boundary forward*. This is the DOCX `sectPr`-on-a-paragraph representation, modeled as a delimiter so the flat doc tree is never re-parented. If sections land first, columns only add the two attrs above.
- **`columnBreak`** — a hard break that forces a region advance to the next column (new page if in the last column). Mirrors `pageBreak` exactly: atom, `group: "block"`, and the importer maps `<w:br w:type="column"/>` to it the same way it maps `w:type="page"` → `pageBreak`.

Until sections ship, a **doc-level fallback** (`doc.attrs.columnCount` / `columnGap`) lets the engine be built and verified first; the section reparenting of the attr is then mechanical. See Phasing.

## The `ContentRegion` engine

Per `pagination-model.md`:144, abstract the page/y cursor into a region cursor.

```ts
interface ContentRegion {
  pageIndex: number;
  columnIndex: number;
  x: number;       // absolute page-local left of this column's content box
  width: number;   // column content width
  top: number;     // region top (content-box top of the page)
  bottom: number;  // region bottom (content-box bottom; columns share full page height)
}
```

A page becomes an ordered `ContentRegion[]`. For a section with `columnCount = N`, gap `g`, content width `W`:

```
colWidth = (W - g*(N-1)) / N
region[i].x = contentLeft + i*(colWidth + g)
```

`paginateFlow`'s page-advance becomes a **region-advance**:

```
if blockBottom > region.bottom:
  if region.columnIndex < N-1:  advance to next column (same page)
  else:                         advance to first column of next page
```

`splitBlockAtBoundary` already exists for the overflow case — it splits at `region.bottom` instead of the old `pageBottom`. **Single-column is one region per page → today's behavior falls out unchanged.**

### The real refactor cost (not the happy path)

`pagination-model.md`:164 flags this honestly, and it's where the effort actually is:

1. **Three entangled cursors.** `paginateFlow` carries a Y cursor (`y`, `prevSpaceAfter`), a page cursor (`currentPage`, `pages`), and the split loop's own `currentPartStartY`. All three must collapse into the region cursor.
2. **Phase 1b early-termination** (`PageLayout.ts:733`) hard-codes `prevCurPage.blocks` scans *by page index*; these become *by region index*.
3. **Measurement / cache thrash** (`pagination-model.md`:166). Stage 1 measures at one `contentWidth` and the `WeakMap<Node, MeasureCacheEntry>` carries a single `availableWidth`. Equal-width columns are fine (every region on a page shares `colWidth`, so a block measured once is valid in any column). **Unequal widths would thrash** — which is why v1 is `equalWidth`. When unequal lands, the cache key gains `columnWidth` (mirrors the per-column key already noted for tables).

## Layout pipeline changes (by stage)

| Stage | File | Change |
|---|---|---|
| `collectLayoutItems` | `PageLayout.ts:1895` | Already walks top-level children linearly. Track the **active section settings** as it walks (toggle on `sectionBreak`); tag each item with its `columnCount`. No reparenting. |
| `buildBlockFlow` | `PageLayout.ts:1648` | Compute `availableWidth = colWidth` from the item's section `columnCount` (known before pagination). Measurement is otherwise unchanged. |
| `assignGlobalY` / floats | — | Unchanged for v1 (floats confined to their column is an Open Question; default v1 keeps float exclusions within the column box). |
| `paginateFlow` | `PageLayout.ts:1221` | The region-cursor refactor above. The bulk of the work. |
| `buildFragments` | `PageLayout.ts:2087` | Fragments gain `columnIndex` metadata; indexing is otherwise unchanged. `layout-pipeline-architecture.md`:251 — column splits are just `Block → N fragments`, same as page/row splits. |

## Rendering, selection, navigation

- **Rendering:** Blocks already carry absolute `x` and per-line positions from `layoutBlock`. The painter draws each fragment at its region `x` — no new painter. Optional vertical **rule line** between columns is a paint-only addition in the renderer (Open Question).
- **Hit-testing:** `CharacterMap.lineAtPoint` already filters by `x >= l.x && x < l.x + l.contentWidth` (`CharacterMap.ts`). A click in column 2 resolves to column-2 lines because their `x` differs. No change.
- **Caret nav:** `posBelow`/`posAbove` resolve by 2D line geometry, not by a single-column vertical-stack assumption. The one thing to **verify** (test contract, not code): at the bottom of column 1, ArrowDown should land at the top of column 2 (next region), because that's the next line by document order whose geometry sits down-and-right. This is the highest-risk nav case and gets explicit tests.

## Export parity

Per `feedback_pdf_parity`: any new layout the canvas renders must render in PDF, and tree-driven exports must round-trip.

- **PDF** (`@scrivr/export-pdf`): renders `LayoutPages` directly, so columns render for free once fragments carry region `x` — they already will. Add a column-rule paint only if the canvas paints one.
- **DOCX** (`@scrivr/docx`): emit `<w:cols w:num w:space>` into the section's `sectPr`; map `columnBreak` → `<w:br w:type="column"/>`. Import reads them back through the existing (currently no-op) `sectPr` branch.
- **Markdown**: no column concept; columns flatten to linear blocks (lossy, documented), same as other layout-only properties.

## Phased implementation

### Phase 1 — Engine (doc-level attr)

`doc.attrs.columnCount` / `columnGap`. Build the `ContentRegion` refactor in `paginateFlow`, sequential fill, equal width. Verify the whole snake + the entangled-cursor collapse + Phase 1b region keys against a single-section doc. This de-risks the hard part before touching the schema.

### Phase 2 — `columnBreak` node

Mirror `pageBreak`: schema node, command, keymap, forced region-advance, DOCX `<w:br w:type="column"/>` round trip.

### Phase 3 — Section scoping

Land (or extend) the `sectionBreak` substrate from `sections-roadmap.md`; reparent `columnCount`/`columnGap` from doc attr onto `Section.settings`. Engine is unchanged — only the attr source moves. Unlocks title-over-2-up.

### Phase 4 — Export round trip + UX

DOCX `<w:cols>` export/import; toolbar control (1 / 2 / 3 columns); column rule cosmetic.

### Deferred

Balanced columns; unequal widths; column-spanning blocks; float confinement policy; tables-in-columns.

## Open questions

1. **Fill strategy.** Sequential (v1, Word default) vs balanced (InDesign/Pages default look). Balanced needs an iterative height-target pass (measure → guess split → re-check) and is a real chunk of work — recommend deferring.
2. **Unequal column widths.** Needs the per-column cache key. Rare; defer.
3. **Column-spanning blocks.** Word's "span all columns" for headings/figures. Needs the region loop to handle a full-width block mid-section (close the open regions, emit one full-width region, resume). Moderate; defer to after Phase 3.
4. **Float confinement.** Does a square-wrapped image's exclusion stay inside its column or span the gutter? v1 default: confined to the column (reuses `ExclusionManager` within the column box). Revisit if a consumer wants spanning figures.
5. **Column rule line.** Cosmetic vertical rule between columns. Paint-only; low risk; bundle with Phase 4 if wanted.

## Files to create / modify

- `packages/core/src/layout/PageLayout.ts` — `ContentRegion`, region-cursor refactor in `paginateFlow`, region keys in Phase 1b, section-tagging in `collectLayoutItems`, `colWidth` in `buildBlockFlow`.
- `packages/core/src/model/schema.ts` + `extensions/built-in/` — `columnBreak` node (and `sectionBreak` if not already landed by sections work); column attrs on section settings.
- `packages/core/src/extensions/built-in/` — toolbar/command for column count and column break.
- `packages/docx/src/export/` + `import/` — `<w:cols>` and `<w:br w:type="column"/>` through the existing `sectPr` seam.
- `docs/pagination-model.md` — update the `### Columns` section to point at this RFC once the engine lands.
- Tests: `paginateFlow` region snake + split-at-region-bottom; `CharacterMap` ArrowDown col1→col2; DOCX `<w:cols>` round trip; single-column regression (degenerate region == today).

## Dependencies

- **Sections substrate** (`sections-roadmap.md`) for Phase 3. Phases 1–2 deliberately avoid this dependency via the doc-level attr so the engine can be built and proven first.
- No dependency on the table work beyond the shared `layoutBlock` contract, which is already stable.
