---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
"@scrivr/docx": patch
---

**Upgrading from 1.0.20 — every breaking change in one place.**

This release rebuilt the font lane and moved PDF export onto a contract that
core owns, so more of the public surface moved than in any release so far. Each
change has its own note below with the reasoning; this is the checklist. All of
it ships as `patch` under the beta release policy — the version number does not
warn you, so this does.

**If you register fonts**

- `IBaseEditor` gains a required `fonts` member. A custom editor implementation
  has to supply one.
- A `FontResource` must now declare `embedding: { allowed: true }` to be
  embeddable. Omitting it reads as *unknown* permission, not permission, and
  `embedFaces` throws naming the family rather than silently substituting.
- Faces must be registered as `.ttf` or `.otf`. A `.woff`/`.woff2` is refused:
  it measured and shaped correctly but went into `FontFile2` as a container,
  which readers render as dots or silently substitute.
- `Editor.fontFamilies` is `readonly FontFamilyOption[]`, not `string[]`.
- `FontShortfall.resolved` is a `FontKey`, not a family name.
- A CSS font-family list is no longer treated as a single family name.

**If you wrote a PDF mark handler**

- `PdfSpanStyle` changed shape: colours are CSS strings rather than pdf-lib
  triples, and `font` is gone — a face belongs to layout, not to a mark.
- `PdfMarkHandler` receives `PdfMarkContext`, which exposes only `theme`,
  instead of the full `PdfContext`. A mark returns style data; it never draws.
- Both types now live in `@scrivr/core` and remain importable from either
  package.

**If you wrote a PDF node handler**

- It receives `PdfNodeContext`, not `PdfContext`: `doc`, `page`, `fonts` and
  `images` are not on that type. Paint through `ctx.draw.*` and render children
  through `ctx.blocks()`. Raw pdf-lib access stays on lifecycle hooks
  (`onBeforeExport` / `onAfterExport`) and on chrome handlers, which still
  receive the full `PdfContext`.
- `PdfContext` gains a required `blocks` member, so anything declaring its own
  structural `PdfContext` shape must add it.
- `ctx.draw.image(image, rect)` becomes
  `ctx.draw.image({ x, y, width, height, image: { src } })`, and
  `ctx.draw.imagePlaceholder(box, theme)` loses its second argument.
- `PdfDrawSurface` gained members — additive to call, breaking to *implement*.

**If you call `exportToPdf`**

- `PdfExportOptions.fontResolver` is removed; the font provider resolves bytes.
- Image URLs are now fetched under a policy: only public http(s) destinations,
  re-checked on every redirect, with caps on wait, size and hops. **If your
  images live on an internal host, pass `resolveImage`** to keep fetching them.
  It replaces the policy entirely, so it is equally how to be stricter when the
  documents are untrusted; `onImageRefused` reports what was turned away.

**If you import DOCX**

- Formatting a document states in its *styles* is now imported, not just what
  its runs repeat. Documents that previously imported unstyled will change
  appearance — this is the fix, but it does change output.
- `<w:b w:val="false"/>` and friends now cancel formatting a style supplies,
  where they were previously dropped.
- Apply an imported document with `applyImportedDocument(editor, doc)`.
  Replacing the content directly drops `doc.attrs`, which is where headers,
  footers and section settings live.

**Rendering differences you may notice**

- Highlight uses one colour for canvas and PDF; an alpha in a highlight colour
  becomes its opacity rather than being flattened and dimmed twice.
- Two PDF greys are now exactly `#9ca3af` instead of hand-transcribed
  approximations.
- A horizontal rule prints in `#999999`, the print-ready grey
  `defaultPdfTheme.hrColor` always declared, rather than the lighter `#cbd5e1`
  the canvas uses — the handler used to hold that slate as a literal and read
  no theme at all. Pass `exportPdf({ theme: { hrColor: "#cbd5e1" } })` to keep
  the previous ink.
- Text is no longer reduced to WinAnsi when it will be drawn in an embedded
  font, so scripts outside that repertoire survive the export.
