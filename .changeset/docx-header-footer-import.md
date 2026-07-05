---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/plugins` — page headers and footers now import from DOCX, completing the round-trip.

A `.docx` with headers/footers (exported by Scrivr, or any document using the
`<w:fldSimple>` field form) now reconstructs its chrome on import: header/footer
text, page-number / total-pages / date tokens, images, and different-first-page
all land back on the document's `headerFooter` policy.

`@scrivr/core` / `@scrivr/docx` — the DOCX import context gained the inverse of
the export-side part seam: `ctx.section` exposes the `<w:sectPr>` header/footer
references (previously dropped), and `ctx.walkPart(relId)` reads a header/footer
part and walks its content back through the same node/mark handlers as the body,
with relationships resolved against the part's own `word/_rels/{part}.rels`. A new
`field` inline kind carries `<w:fldSimple>` fields through Stage 1 so extensions
can map them back to nodes. The older `<w:fldChar>` run-sequence field form is not
yet parsed.
