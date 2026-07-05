---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/plugins` — page headers and footers now export to DOCX, including images.

Headers and footers set in the editor now appear in the exported Word document as
real `<w:hdr>` / `<w:ftr>` parts referenced from the section. Different-first-page
is supported (`<w:titlePg/>` + a first-page part), page-number / total-pages /
date tokens export as live Word field codes (`PAGE`, `NUMPAGES`, `DATE`), and
images placed in a header or footer export with their bytes and a part-scoped
relationship (`word/_rels/header1.xml.rels`).

`@scrivr/core` — paragraph and heading exports now emit `<w:jc>` for the `align`
attribute, so centered / right-aligned / justified text keeps its alignment in
Word (previously dropped to left). `prepareDocxImages(ctx, doc)` is exported so
contributions that render their own sub-documents can pull images through the
same fetch/media path as the body.

`@scrivr/core` / `@scrivr/docx` — the DOCX export context gained reusable
capabilities the HeaderFooter contribution is the first to use: `ctx.walkContent`
(render a sub-document through the same node/mark handlers as the body) and
`ctx.parts.add({ kind, build })` (register an extra OOXML part; relationships
allocated inside `build` are scoped to that part's own `.rels`). Footnotes,
comments, and text boxes can reuse the same seam.
