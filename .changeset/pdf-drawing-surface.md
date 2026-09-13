---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

A PDF handler draws in layout pixels, without pdf-lib.

`ctx.draw` gains `text`, `line` and `rect` alongside `lines`, and `image` now
takes a box and an image handle rather than a pdf-lib object. Coordinates are
layout pixels measured from the page's top-left, colours are core's `Rgb`, and
the surface owns the conversion to points and the flip to a bottom-left origin
— so a handler performs neither.

`horizontalRule` is why this exists: a handler for a horizontal line was
computing `pageHeight - midY * PT_PER_PX` and importing `rgb` from pdf-lib to
pick a grey. The built-in handlers no longer reference pdf-lib at all.

`PdfDrawHelpers.image` changes shape, and `PdfBox` replaces its inline
rectangle type. Drawn output is unchanged; the op-log baseline did not move.
