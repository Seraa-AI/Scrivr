# Extension declarations: how a node tells the engine what it is

**TL;DR.** The engine no longer knows which nodes exist. It knows how a node
*takes part* in layout, rendering, input and export, and every node says that
about itself through a declaration on its spec or its extension. Paragraphs,
lists, breaks, sections, headings, images and tables are all built this way,
so a new kind of content is an extension, not a change to core.

This page is for anyone writing an extension or working on the engine. The
design behind each declaration lives in its RFC (linked below); this is the
map.

## The rule

> A node's layout, look and behaviour are declared by its extension. The
> engine reads declarations and never checks a node's (or mark's) name.

Two things hold the rule in place:

- **A test-only extension per declaration**, written only against
  `@scrivr/core`'s public API, that uses the declaration for something new.
  If the engine needed a name, that test could not pass.
- **Vocabulary guards** — tests that fail when a node or mark name appears in
  the engine's own code: `core/src/layout/engineVocabulary.test.ts`,
  `export-pdf/src/__tests__/exporterVocabulary.test.ts`,
  `export-semantic/src/__tests__/outlineVocabulary.test.ts`.

## What a node or mark can declare

| It is… | Declare | Read by | Proof (test-only extension) |
|---|---|---|---|
| A wrapper that indents, restyles or hangs a marker before what it holds | `layout: { kind: "transparent", wrap }` + `addMarkerPainters()` | layout walk, canvas and PDF marker painters | checkbox task list — `core/src/extensions/customMarker.test.ts` |
| A page or line break | `layout: { kind: "break", breaks: "page" \| "line" }` | layout walk (page), span builder (line), semantic text, AI diff, header/footer guard | scene break, line separator — `core/src/extensions/customBreaks.test.ts` |
| The end of a section | `sectionBoundary: true` (a leaf with a `settings` attr) | sections model (`deriveSections`), layout boundaries | chapter end — `core/src/extensions/customSectionBoundary.test.ts` |
| A heading in the outline | `outlineLevel(node)` | PDF bookmarks, semantic breadcrumbs and `toDocumentOutline`; titles via `outlineTitleOf` | chapter title — `export-pdf/src/__tests__/customOutline.test.ts`, `export-semantic/src/__tests__/customOutline.test.ts` |
| A floating object | `anchored: { read(node), write(patch) }` | layout, float solver, selection, drag, resize, return-to-line, semantic image, AI image layout | badge, clip — `core/src/extensions/customAnchoredObject.test.ts`, `ai/…/AiToolkit.images.test.ts` |
| A block made of side-by-side regions, placed unit by unit | `layout: { kind: "composite", composite: { units, regions } }` | layout walk, region layout, pagination, hit-testing, canvas and PDF | comparison block — `core/src/extensions/customComposite.test.ts`, `export-pdf/src/__tests__/customComposite.test.ts` |
| A mark that changes the font | `addFontModifiers()` | layout, font preflight, the editor's font readouts | heavy / huge / typewriter — `core/src/extensions/customFontMark.test.ts` |
| Markdown it reads | `addMarkdownParserTokens()` | markdown paste, `parseMarkdown` | strikethrough `~~` — `core/src/input/PasteMarkdown.test.ts` |
| Pasted files it takes | `addPasteFiles()` | paste, load-time placeholder sweep | photo node — `core/src/extensions/customPasteFiles.test.ts` |
| An embedded file in a PDF | `addExports().pdf.embeds` | PDF image fetching | photo block — `export-pdf/src/__tests__/customEmbeds.test.ts` |

Contracts worth knowing:

- A declaration's callbacks (`outlineLevel`, `anchored.read/write`,
  `regions`, font modifiers) run for every block they apply to: they must be
  pure and must not throw.
- A break and a section boundary are honoured only on a leaf; a node that
  holds content and declares one lays out as what it is.
- A composite's `units()` should return at least one unit, and a region node
  should hold at least one block to take a caret.

## Writing a new extension

Start from the closest row above, then:

1. Declare it on the node spec (or the extension hook). Don't reach into core.
2. Write a test-only extension first, against the public API, that shows the
   behaviour — and watch it fail before the declaration is honoured.
3. If the behaviour needs something no declaration offers, that is a new
   concept: draft a short RFC in `docs/` before writing code.

Some things that are now an extension, not a core change: a task list (a
wrapper with a checkbox marker), legal numbering (a list option), a
two-column comparison or form grid (a composite), a callout or video that
floats (anchored), a custom heading style that appears in the PDF bookmarks
and the AI's outline (outline level), a mark that changes size or weight
(font modifier).

## Why it matters for the rest of the work

- **Canvas, PDF and the semantic export stay in step** because they read the
  same declaration. Lists, markers, regions and floats follow from it; only a
  painter's decoration is written per surface, side by side.
- **Columns** land on declarations that already exist: the section boundary
  item and the page/line break are the region cursor's inputs, and a column
  break is one more `breaks` value.
- **Resumable layout and row splitting**: a composite unit is where a table
  producer plugs in; row splitting becomes a unit's break policy.
- **DOCX and AI** read the same placement and outline declarations, so a
  custom floating object or heading round-trips without special cases.

## Still name-aware — the living list

Update this list as each item lands.

| Where | What it knows by name | Next step |
|---|---|---|
| `input/ClipboardSerializer.ts` | every copied slice runs the Table's `collapseRowSpans` | a copy-time HTML transform hook beside the paste transforms; Table declares it (**next PR**) |
| `model/sanitizeDocUrls.ts` | per-node URL gates (`image` → `safeImageUrl`, `link` → `safeUrl`) | a URL-attr declaration on the spec |
| `export-semantic` walker | editable part types (`paragraph`, `heading`, `codeBlock`) and list/table container labels | part declarations, after tables |
| `layout/FontConfig.ts` `getBlockStyle` | falls back to the `paragraph` style for a node with none | the schema's default textblock |

Known bugs older than this work, recorded in the RFCs' "To check":

- DOCX export reads an image's raw wrap attrs, so a legacy right-floated image exports inline.
- The React image menu can make a legacy right-aligned image jump left.
- A `trackedDelete` run with no records is treated differently by the two outlines.
- Parts after a nested heading inside a unit miss it in their breadcrumb.
- Two next-page breaks in a row place an image anchored after them one page early.

## Where the designs live

- Wrapper layout (lists): `docs/wrapper-layout-rfc.md` (#238)
- Node declarations (breaks, outline, markdown paste): `docs/node-declarations-rfc.md` (#239)
- Engine declarations (marks, sections, outline on the spec, floats, files): `docs/engine-declarations-rfc.md` (#241–#244)
- Composite layout (tables): `docs/composite-layout-rfc.md`
- The future these land into: `docs/resumable-layout-rfc.md`, `docs/columns-rfc.md`, `docs/sections-roadmap.md`
