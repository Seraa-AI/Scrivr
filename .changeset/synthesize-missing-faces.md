---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

A weight or slant nobody owns is drawn, not dropped

An inventory holding one upright regular answered a request for bold with the
regular, so a document's headings came out as body text. Both lanes now stand
in for the missing face: the canvas strokes the glyph to thicken it and shears
it to lean it, and the PDF sets fill-and-outline with a line width and skews
its text matrix.

The engine does this itself rather than letting the browser, which is what
makes it safe. A browser's synthetic bold widens every glyph's advance and no
exporter can reproduce that; thickening a glyph in place and leaning it leave
advances untouched, so the geometry measured for the real face stays true and
both lanes alter it identically. The strength lives in one module for the same
reason.

`FontResolution.synthesis` already recorded what a face did not supply; this is
the half that acts on it. Substitutions are still reported — a stand-in is not
a designed face — so an application can tell "different typeface" from "bold
was thickened" and suggest registering the real one.
