---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
"@scrivr/plugins": patch
"@scrivr/docx": patch
---

Inline atoms carry the face they were measured in, and a shortfall names a face

An inline atom — a page-number token, a date — is sized against a font, and the
span recorded none. So a PDF handler painting one had to name a family: header
and footer tokens were drawn in `10px sans-serif` while the canvas drew them in
the surrounding run's resolved face at the run's size, and the box around them
was reserved against a third. An object span now carries its face and
resolution as a text span does, and the atom's context hands the handler a
`PdfFontHandle` carrying it. This was the last path choosing a face by name.

**Breaking: `FontShortfall.resolved` is a `FontKey`, not a family name.**
An inventory holding one weight of a family answers a request for bold with its
regular, and Scrivr does not synthesize the difference — a browser's synthetic
bold widens each glyph's advance while a PDF's stroked equivalent does not, so
faking it would put canvas and PDF back into disagreement about where every
following character sits. Reporting the family alone could not distinguish "a
different typeface" from "bold was lost"; `resolved.weight` and
`resolved.style` now can. `shortfall.resolved` becomes `shortfall.resolved.family`.

DOCX import diagnostics name the face rather than the family, so a substituted
bold reads "Inter Bold" rather than "Inter".
