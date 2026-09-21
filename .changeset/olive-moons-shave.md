---
"@scrivr/export-pdf": patch
---

Embed a subset of each face, built with fontkit v2.

pdf-lib drives fontkit v1, whose subsetter silently drops the outlines of fonts
whose `loca` is in the long format - Inter is one - leaving correct advances
around blank paper. v2 subsets both formats correctly; the one call pdf-lib
makes that v2 renamed is adapted where the fontkit instance is registered.

Subsetting also removes the ligature defect at its source: a subset's widths
and `ToUnicode` are built from the glyphs the pages drew rather than from the
cmap, so a ligature no longer falls back to a reader's one-em default width.
Exported documents get much smaller with it - a twelve-page agreement went from
1.1 MB to 154 KB.
