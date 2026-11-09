# Engine declarations: sections, floats, marks and the rest

Status: Draft (2026-11-09), for sign-off.

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

### 3. Sections: the break declaration, plus where a section ends

A section break is a page break that sometimes is not one, and it ends a
section.

```ts
| { kind: "break"; breaks: "line" }
| { kind: "break"; breaks: "page"; startsOn?: (node: Node) => PageStart | null }

/** Which page the next block starts on; null when this node does not break. */
type PageStart = "nextPage" | "oddPage" | "evenPage";
```

- `Sections` declares `{ kind: "break", breaks: "page", startsOn }`, reading its
  `settings.breakType` (`continuous` → null). The walk's section branch goes.
- **New:** a node spec may declare `sectionBoundary: true`. `isSectionBreak`
  reads it instead of the name, and `deriveSections` is unchanged: the
  settings stay in `attrs.settings`, owned by the sections model.

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
- New: `breaks: "page"`'s `startsOn`, `PageStart`; spec fields
  `sectionBoundary`, `anchored`, `outlineLevel`; `anchoredOf`,
  `AnchoredPlacement`; `addPasteFiles()`; `PdfHandlers.embeds`.

## How it is checked

As in #239: every existing test keeps its assertions; a test-only extension,
written against the public API only, declares a custom section boundary, a
custom floating object, a custom font-changing mark and a custom outline block;
the vocabulary guards grow so `sectionBreak`, `image`, `bold`, `italic`,
`fontSize`, `fontFamily`, `paragraph` and `heading` cannot come back into
`layout/`, `renderer/`, `input/`, `fonts/`, `export-pdf/src` or the semantic
walker.

## Order

One PR per session, smallest first:

1. Marks, default block, style defaults (items 1, 2, 6). No new concept.
2. Sections (3).
3. Outline level on the spec (7).
4. Floats and images (4, 5). The largest.
5. Tables: their own RFC.

The list-number gap fix (user, 2026-11-09) stays the next PR, before 1.

## Decisions for sign-off

1. The three new spec fields (`sectionBoundary`, `anchored`, `outlineLevel`)
   over strategy- or export-lane hooks: they are read outside layout and
   export.
2. `addPasteFiles()` as a new hook for image file paste.
3. The order above, one PR each, or one integrated PR.

## What shipped

Nothing yet.
