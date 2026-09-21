---
"@scrivr/export-pdf": patch
---

Give ligatures their real width in the exported PDF.

pdf-lib derives a font's widths and text layer from its cmap, so a glyph only
shaping can reach - every ligature - got neither, and a reader fell back to a
one-em default width for it. Aptos sets `ff` at 0.67em, so `Effective` painted
as `Eff ective` and overran the word after it. The glyphs the pages actually
drew are now added to the list pdf-lib reads, just before the document is
saved; they carry their own codepoints, so `ff` also copies back out as `ff`.
