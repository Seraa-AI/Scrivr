---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

PDF export paints the face the layout measured

**Breaking: `PdfExportOptions.fontResolver` is removed.** It resolved bytes by
family name at export time, which is precisely how a PDF comes to embed a face
the layout never measured. Give the editor a `FontProvider` instead — one
inventory, one answer, both lanes.

The exporter used to derive a font from the family name in each span's CSS
string: a second, independent answer to a question layout had already settled.
A document measured in one face and painted in another put every glyph at
coordinates computed for different metrics, so spans overlapped and swallowed
the spaces between them.

`exportToPdf` now resolves a document's faces under `{ portable, embeddable }`
before layout, reports what it could not honour through `onFontShortfall`, and
embeds the resources the layout recorded. Spans, table cells and list markers
all pick the face the geometry came from. The name-based guess remains only
where nothing resolved anything, so an application with no `FontProvider` is
unaffected.

Also fixes three ways the lane was unreachable: `Editor` accepted no `fonts`
option, `DocumentLayout.fontResolutions` was never populated, and table cells
were laid out without the resolver — measured in a family nobody owned and
painted in a standard face.
