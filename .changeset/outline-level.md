---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
"@scrivr/export-semantic": patch
---

A block declares its outline level on its node spec (`outlineLevel`), read
by both the PDF bookmarks and the semantic outline, so a custom block heads a
section in both. `Heading` declares it; headings bookmark, nest and head
breadcrumbs as before.

- `outlineLevelOf(node)` reads the declaration.
- The semantic walker, its heading-led grouping and `toDocumentOutline` read
  the declared level instead of the name `heading`.

**Breaking:**

- `addExports().pdf.outline` and `PdfOutlineLevel` are removed: declare
  `outlineLevel` on the node spec instead.
- A node whose semantic handler returns `{ type: "heading" }` but whose spec
  declares no `outlineLevel` no longer opens a section in `toDocumentOutline`
  or heads breadcrumbs: declare `outlineLevel` on its spec.
