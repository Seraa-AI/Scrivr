# Engine declarations: sections, floats, marks and the rest

Status: Approved (2026-11-09): all four decisions as proposed — sections as a
boundary item read by the region cursor, spec-level fields, `addPasteFiles()`,
and the phased order.

## Problem

Node declarations (#239) took page breaks, line breaks, PDF bookmarks and the
markdown paste fallback off node names. The user's direction, 2026-11-09:
"clean things up well for a proper base. include sectionBreaks and the rest."
This RFC covers the rest, except tables, which get their own RFC (`"tableRow"`
is a `LayoutBlockKind`; that is a layout model change, not a declaration).

What core, `export-pdf` and `export-semantic` still know by name, outside the
extensions that own the names and outside `core/src/table/` (the Table
extension's own module):

| Area | Where | What it knows |
|---|---|---|
| Sections | `model/sections.ts` `isSectionBreak`, `layout/layoutItems.ts` | `sectionBreak` ends a section, and starts a page unless continuous |
| Floats | `layout/AnchoredObjects.ts` `normalizeImageAttrs`; `BlockLayout.ts`, `PageLayout.ts`, `AnchoredObjectSolver.ts`, `SelectionController.ts`, `renderer/PointerController.ts`, `AnchoredObjectDebugOverlay.ts`, `Editor.convertImageToInlineAtVisualPosition` | Only an `image` floats; its placement is read from image attrs |
| Images elsewhere | `input/PasteTransformer.ts` (pasted files), `exports/semantic.ts` `semanticImage`, `export-pdf/src/index.ts` (which `src`s to embed) | An image is the node named `image`, with `src`, `width`, `height` |
| Marks | `layout/StyleResolver.ts` switch fallback, `fonts/collectFontRequests.ts`, `Editor.ts` active font family and size | `bold`, `italic`, `fontSize`, `fontFamily` change the font |
| Default block | `input/PasteTransformer.ts` plain-text paste and `mergesIntoNeighbour` | Plain text becomes `paragraph`s |
| Styles | `layout/FontConfig.ts` `defaultFontConfig` | `heading_1`…`heading_6` |
| Outline | `export-semantic/src/walker.ts` | Breadcrumbs are `heading`s at their raw `level` (deferred from #239) |

`model/lists.ts` (`isListType`, `listKind`) stays: the wrapper layout RFC kept
it in core's model on purpose.

## The future this lands into

Two approved plans shape where these declarations are read:

- **Resumable layout** (`docs/resumable-layout-rfc.md`, #222): "a region
  supplies geometry; a block consumes source content; pagination only decides
  which region the block receives next." A **region cursor** owns page, column
  and section progression; **producers** (paragraph, table) consume regions
  through `layoutNext(prepared, continuation, region)`; a **geometry
  coordinator** owns anchor placement and exclusions. Its Phase 1 is the region
  cursor: one region per page, page/Y/spacing advancement in one place.
- **Columns and sections** (`docs/columns-rfc.md`, `docs/sections-roadmap.md`):
  regions come from section settings; a section boundary closes one section's
  regions and opens the next.

So each declaration here names which of those owners reads it:

| Declaration | Read by |
|---|---|
| `breaks: "line"` (#239) | The paragraph producer: hard-break semantics are a paragraph's |
| `breaks: "page"` (#239), later `"column"` | The region cursor: a forced advance |
| `sectionBoundary` and the `boundary` item (3) | The region cursor: a section transition |
| `anchored` (4) | The geometry coordinator: placement and exclusions |
| Font modifiers (1) | Inline preparation, before any producer runs |
| `outlineLevel` (7) | Exports, after layout |

Nothing here builds the region cursor or a producer. It makes sure that when
they are built, they read declarations and never a node's name, and that
pagination already receives transitions through one field.

## Design

Each item builds on a declaration that exists, except two marked **New**.

### 1. Marks: the font modifiers already declared (no new concept)

`Bold`, `Italic`, `FontSize` and `FontFamily` already declare
`addFontModifiers()`, and `resolveFont` already prefers them.

- `resolveFont`'s switch fallback goes: a mark without a modifier does not
  change the font.
- `collectFontRequests` resolves each run through the same modifiers
  (`resolveFont` over the block's font, then read the weight, style and
  family), so the faces it asks for are the ones layout will measure. It takes
  the modifier map, as layout does.
- `Editor`'s "active font family" and "active font size" queries move to
  `FontFamily` and `FontSize`, which own those marks.

### 2. The default block (no new concept)

Plain-text paste builds the schema's default textblock
(`schema.topNodeType.contentMatch.defaultType`), which is `paragraph` in every
built-in schema, and `mergesIntoNeighbour` asks the same of the node.

### 3. Sections: a boundary the sections model owns, not a break

The columns plan (`docs/columns-rfc.md`, `docs/sections-roadmap.md`) settles
what a section break is: a **boundary** between sections, whose settings
(`breakType`, `columns`, later orientation and margins) the sections model
derives (`deriveSections`). `continuous` changes the regions mid-page; the
other types start the next section on a new, odd or even page. Once columns
land, pagination at a boundary closes the current section's regions and opens
the next section's, following the derived transition. A section break is
therefore not a page break with a condition, and this RFC does not make it
one.

- **New:** a node spec may declare `sectionBoundary: true`. `isSectionBreak`
  reads it instead of the name; `deriveSections` and the settings in
  `attrs.settings` are unchanged. The sections model stays core's, as
  `isListType` does: it says what a node is, and pagination asks it.
- **Layout items say what they are.** `LayoutItem`'s `isPageBreak` and
  `pageBreakType` become one field, `boundary`:

  ```ts
  type LayoutBoundary =
    | { kind: "break"; breaks: "page" }                       // a node that breaks the page
    | { kind: "section"; transition: SectionTransition };     // nextPage | oddPage | evenPage | continuous
  ```

  A continuous section emits a boundary too (today it emits nothing), so the
  columns work has the place where regions change already in the flow. Until
  then pagination treats it as it does today: a continuous boundary does not
  move the flow, the others start the next page as now. Output is unchanged.
- **Breaks are region advances.** `BreakKind` grows `"column"` when
  `columnBreak` lands (columns Phase 3): `"page"` advances to the next page's
  first region, `"column"` to the next region, which on a one-region page is
  the next page. Nothing is added now; the vocabulary is chosen so that
  `columnBreak` is a declaration, not an engine change.

This is the input the region cursor (resumable layout Phase 1, columns
Phase 1) consumes: `RegionCursorState` carries the active page, column and
section, and advances on exactly these boundaries. Until it exists,
`paginateFlow` reads the same field.

### 4. Floats: an inline node declares how it is anchored

**New:** a node spec may declare `anchored(node): AnchoredPlacement | null`.
`AnchoredPlacement` is today's `NormalizedImageAttrs`, renamed (`width`,
`height`, `wrapMode`, `xAlign`, `x`, `yOffset`, `zIndex`, `margin`); null, or
a `wrapMode` of `inline`, means it sits in the line.

- `Image` declares it; `normalizeImageAttrs` and its legacy-attr readers move
  into `Image`.
- Core reads it through one helper, `anchoredOf(node)`, everywhere it asks
  `type.name === "image"` today: span building, page layout, the solver,
  selection, pointer drag, the debug overlay.
- `convertImageToInlineAtVisualPosition` becomes an `Image` command; the attrs
  it writes are the image's.
- On the spec rather than `InlineStrategy`: selection and pointer code read it
  with no registry in reach, as `layout` is read today.

### 5. Images in paste and export (existing hooks)

- **Pasted files:** `PasteTransformer` stops building `image`. The image file
  path becomes a paste hook on `Image`, beside `addPasteTransforms`: given a
  `src` and size, it returns the node. **New hook** — `addPasteFiles()` — or,
  if you prefer no new hook, `Image` keeps the node and paste asks the schema
  for the node whose spec declares `anchored` and accepts `src` (fragile;
  not recommended).
- **Semantic:** `semanticImage` reads `anchoredOf` for size and wrap and the
  node's `src`/`alt`; the `image` name check goes to `Image`'s semantic handler.
- **PDF:** the exporter learns which `src`s to embed from
  `pdf.embeds?: Record<nodeName, (node) => string | null>`, declared by
  `Image`, instead of reading `src` off nodes named `image`.

### 6. Style defaults

`defaultFontConfig`'s `heading_N` entries go; `Heading.addBlockStyles()`
already registers them.

### 7. Outline level on the spec (the item deferred from #239)

**New field:** a node spec may declare `outlineLevel(node): number | null`.
The PDF bookmarks and the semantic outline both read it; `pdf.outline` (#239)
is removed in its favour, and `Heading` declares it once.

## Public API

Breaking, during beta (patch changesets):

- Removed: `resolveFont`'s built-in mark fallback; `normalizeImageAttrs` and
  `NormalizedImageAttrs` from core (now `Image`'s / `AnchoredPlacement`);
  `Editor.convertImageToInlineAtVisualPosition` (an `Image` command);
  `defaultFontConfig.heading_N`; `PdfHandlers.outline`.
- Changed: `LayoutItem` / `FlowBlock` `isPageBreak` and `pageBreakType`
  become `boundary: LayoutBoundary`.
- New: spec fields `sectionBoundary`, `anchored`, `outlineLevel`;
  `LayoutBoundary`; `anchoredOf`,
  `AnchoredPlacement`; `addPasteFiles()`; `PdfHandlers.embeds`.

## How it is checked

As in #239: every existing test keeps its assertions; a test-only extension,
written against the public API only, declares a custom section boundary, a
custom floating object, a custom font-changing mark and a custom outline block;
the vocabulary guards grow so `sectionBreak`, `image`, `bold`, `italic`,
`fontSize`, `fontFamily`, `paragraph` and `heading` cannot come back into
`layout/`, `renderer/`, `input/`, `fonts/`, `export-pdf/src` or the semantic
walker.

## Tables, as a producer

The tables RFC that follows should not start from `"tableRow"` as a
`LayoutBlockKind`. Resumable layout already names the table a **producer**
(cell regions, collective row-fragment acceptance, Phase 5 row splitting). The
seam to design there is how an extension declares its producer — a paragraph
is the default, `Table` declares its own — so the engine walks producers, not
`tableRow`s. That is the same step this RFC takes for breaks and floats, one
level up, and it is why tables get their own RFC.

## Order

One PR per session, smallest first:

1. Marks, default block, style defaults (items 1, 2, 6). No new concept.
2. Sections (3): `sectionBoundary` and the `boundary` item, output unchanged;
   ahead of columns Phase 1, which builds on it.
3. Outline level on the spec (7).
4. Floats and images (4, 5). The largest.
5. Tables: their own RFC.

The list-number gap fix (user, 2026-11-09) stays the next PR, before 1.

## Decisions for sign-off

1. Sections as a boundary item that the columns work extends, rather than a
   conditional page break.
2. The three new spec fields (`sectionBoundary`, `anchored`, `outlineLevel`)
   over strategy- or export-lane hooks: they are read outside layout and
   export.
3. `addPasteFiles()` as a new hook for image file paste.
4. The order above, one PR each, or one integrated PR.

## What shipped

### Phase 1 — marks, default block, style defaults

As designed, with these differences:

- **The editor's font queries stay on `Editor`**, but read the font the way
  layout does instead of moving to `FontFamily` and `FontSize`: one private
  `runFont(marks, block)` (the block's font, `blockFontOf`, with the marks
  applied through the font modifiers). `getActiveFontFamily`, its `mixed`
  check and `getActiveFontSize` all ask it, so a custom mark that changes the
  family or size is reported, and the weight and style handed to the font
  provider come from the run's font, a heading's bold included.
- **`blockFontOf(node, config)`** is the one place a block's base font is
  derived; `layoutBlock` and the editor both use it.
- **`collectFontRequests` takes `fontModifiers` and `fontConfig`** (the block
  styles, the document's family applied), and `prepareDocumentFonts` takes
  `{ fontModifiers, fontConfig, constraints }`, so a run is asked for in the
  face layout draws it in: `blockFontOf` with the marks applied, a heading's
  bold included. The layout coordinator's pre-reveal gate and the DOCX import
  pass them; `IBaseEditor.getFontModifiers()` and `getBlockStyles()` are new,
  and `applyPageFont` is exported. The weight/style mapping is shared with the
  layout resolver (`faceOf`).
- **`blockStyleOf(node, config)`** reads a block's `level` once, a level
  stored as text included, for its style and its font alike.
- **The built-in font modifiers ignore a value that names nothing**: a size
  that is not a finite number of at least 1px, an empty family. The run then
  keeps its block's font in layout, the font preflight and the readouts.
- A selection that covers no text reports the font the next typed character
  takes, in the first textblock it covers.
- **Headers and footers use the editor's block styles.** They were laid out
  with a copy of `defaultFontConfig`, so a heading in a header kept its look
  only through the defaults this phase removes. `chromeFontConfigOf` derives
  the band's styles from the editor's (a paragraph's spacing dropped, as
  before); the payload carries them so a band re-laid out while edited is
  styled as it was measured.
- **The default block** is `schema.topNodeType.contentMatch.defaultType` when
  it is a textblock, for plain-text paste and for which pasted block merges
  into its neighbours.
- `getBlockStyle` still falls back to the `paragraph` style for a node with
  none; that fallback moves with the next style work, not this phase.
- The vocabulary guard holds: no font mark read by name (`name ===`, `case`,
  `includes(`, `marks[`) under `layout/`, `renderer/`, `fonts/` or in
  `Editor.ts`; no `heading` style key under `layout/`; no `paragraph` literal
  under `input/`.

### Phase 2 — sections

As designed, with these differences:

- **`sectionBoundary`** is typed on `ScrivrNodeSpec` beside `layout`;
  `isSectionBreak` reads it, and `Sections` declares it.
- **`LayoutItem.boundary: LayoutBoundary`** replaces `isPageBreak` and
  `pageBreakType`; `pageStartPast(boundary)` says which page the next block
  starts on, or null for a continuous transition.
- **A continuous boundary is an item, not yet a flow.** On `FlowBlock`, the
  two fields become one, `pageStart`, set only on a boundary that moves the
  flow. Making a continuous boundary a zero-size flow would have meant teaching
  three cursors (the solver's natural start, the flow cursor, `paginateFlow`)
  to collapse margins through it — the cursors the region-cursor refactor
  (columns Phase 1) replaces. The item stream already names every transition
  in one place; the region cursor turns the continuous one into a flow when it
  has a use for it.
- **A section boundary is a leaf with a `settings` attr, between the
  document's own blocks.** A node that holds content, or has no `settings` to
  set, is not one, whatever it declares; one nested in a wrapper ends no
  section and takes no place in the flow, as `deriveSections` already read it.
  Headers and footers refuse section boundaries, as they refuse page breaks.
- The vocabulary guard keeps `sectionBreak` out of `layout/` and the sections
  model.
- **To check (older than this phase):** two next-page boundaries in a row lay
  out as Word does (an empty page between), but the solver's position model
  lands the block after them one page above where it is painted, so an image
  anchored right after them is placed a page early.

### Phase 3 — outline level on the spec

As designed, with these details:

- **`outlineLevel?: (node) => number | null`** is typed on `ScrivrNodeSpec`
  and read through one helper, `outlineLevelOf(node)`, which returns null for
  a node that declares none or answers with anything but a finite number.
- **`Heading` declares it**: its own `level`, a level stored as text read as
  the number it spells, 1 otherwise. `pdf.outline` and `PdfOutlineLevel`
  (#239) are removed.
- **The PDF bookmarks** read `outlineLevelOf` for every block.
- **The semantic lane** reads it in three places: the walker's breadcrumb
  (`headingLevel` is the declared level), the grouping's heading-led unit,
  and `toDocumentOutline`, which opens a section on a unit with a
  `headingLevel` rather than on the unit type. The grouping's "short lede" is
  the schema's default textblock, not a block named `paragraph`.
- A guard keeps heading and paragraph names out of the semantic walker,
  grouping and outline. The lane's part types (paragraph, heading,
  codeBlock) and list/table container labels still name nodes; they are not
  outline rules and move with the floats and tables work.
- A lede is a textblock that heads no section, as well as the schema's
  default. `outlineLevel` must be pure and must not throw: it runs for every
  block the outlines visit.
- **To check (older than this phase): the two outlines read one declaration
  but still visit different blocks.** A heading nested in a list, sourced
  block or table cell is a PDF bookmark but no semantic section; an empty
  heading is left out of the bookmarks but opens an untitled semantic section,
  which changes what nests under it; and with grouping on, a semantic
  section's title includes its lede while its children's breadcrumbs do not.

