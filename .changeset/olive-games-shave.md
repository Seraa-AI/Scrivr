---
"@scrivr/core": patch
"@scrivr/docx": patch
"@scrivr/plugins": patch
---

**Breaking for what a DOCX import produces:** the formatting a document states
in its styles is now imported, not just what its runs repeat.

Word records most formatting once, in a style, and says nothing on the runs
that use it. The importer read only `<w:rPr>`, so everything an author set
through a style was lost. In the agreement this was built against, the
document's own typeface — Aptos at 10.5pt — is declared solely in the `Normal`
style and not one of its 596 runs repeats it.

`ctx.styles` on the import context resolves a style through `docDefaults` and
its whole `basedOn` ancestry; direct run properties layer over the result, so a
run that states something still wins. It fills the slot the context's own
documentation had reserved for it.

`ctx.styles.raw(styleId)` hands back the style element for properties no
generic reader can interpret — a table style's `<w:tblStylePr w:type="band1Horz">`
means nothing without knowing which rows band — so the extension that owns the
node reads them itself, the same division `walkBlocks` already uses for content.

Also: a page-number field now carries the run's marks. It was created without
them, so it stood in the editor's default face beside footer text that did not.
