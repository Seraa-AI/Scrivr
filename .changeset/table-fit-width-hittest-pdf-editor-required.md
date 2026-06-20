---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

Table fit/hit-test fixes, and a **breaking** `buildPdf` signature change.

**`@scrivr/export-pdf` — BREAKING:** `buildPdf(layout, options?, editor?)` is now
`buildPdf(layout, editor, options?)` with `editor` **required**. PDF handlers for
extension nodes (e.g. `table`) are contributed through
`editor.getExportContributions()`, so calling `buildPdf` without an editor
silently dropped those blocks (blank table rows). Making the editor required
removes that footgun at the type level. The editor only needs the
`getExportContributions` surface, so a `ServerEditor` is sufficient for
server-side/test use. `exportToPdf(editor, options?)` is unchanged. Migration:
`buildPdf(layout)` → `buildPdf(layout, editor)`; `buildPdf(layout, opts)` →
`buildPdf(layout, editor, opts)`. A block whose node type still has no handler is
skipped with a one-time `console.warn` instead of failing silently.

**`@scrivr/core` — table column fit:** `TableLayoutEngine` now scales the
`table.grid` widths to fill the available content width (Word/Docs behaviour), so
a grid whose sum exceeds the page no longer overflows the margin, and a narrow
grid stretches to fill. `availableWidth` is threaded into the engine.

**`@scrivr/core` — table cursor navigation:** Home/End and vertical line
navigation (`lineStartPos`/`lineEndPos`/`posAbove`/`posBelow`) now resolve the
line in 2D (x and y). Previously they used a y-only lookup that, in a table row
where cells share a y band, could resolve the first cell's line instead of the
cell the cursor is in. The y-only `lineAtCoords` helper is removed; all
point-based lookups use the unified 2D resolver.

Other packages: lockstep version bump, no behavior change.
