---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

PDF export paints the face the layout measured

The exporter derived a font from the family name in each span's CSS string —
a second, independent answer to a question layout had already settled. A
document measured in one face and painted in another put every glyph at
coordinates computed for different metrics, so spans overlapped and swallowed
the spaces between them.

`exportToPdf` now resolves a document's faces under `{ portable, embeddable }`
before layout, reports what it could not honour through `onFontShortfall`, and
embeds the resources the layout recorded. Spans pick their face by the
resolution they carry. The name-based guess remains only where nothing
resolved anything, so an application with no `FontProvider` is unaffected.

`PdfExportOptions.fontResolver` is deprecated: resolving bytes by family name
at export time is how a PDF comes to embed a face the layout never measured.

Also fixes the font lane being unreachable from `Editor`, which accepted no
`fonts` option, and `DocumentLayout.fontResolutions` never being populated.
