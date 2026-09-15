---
"@scrivr/export-pdf": patch
---

A PDF reproduces the document on screen

The export laid the document out a second time against its own measurer, so the
file was internally consistent and different from the page it came from. Two
engines reading one font file disagree on advance widths by around half a
percent, which is enough to move a line break: a ten-page contract measured 325
lines on screen and 327 in the PDF.

It now reuses the editor's layout when the export resolves to the same faces
the screen did, which is the ordinary case. The discovery pass that existed
only to collect the document's font requests goes with it — the layout's own
resolution table is that list — so an export costs one full layout where it
cost three.

A face the browser can draw but nobody can embed, or one that had not finished
installing when the page was laid out, is a genuine disagreement; those still
typeset against the faces that will paint them, and report why.

Reused geometry is measured by a different engine than paints it, so each run
would end slightly short of its box. Character spacing spreads the difference
across the run's glyphs, and is zero when the layout was measured from the same
face.
