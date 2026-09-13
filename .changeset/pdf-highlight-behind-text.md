---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

A highlight is painted behind its text in a PDF, not over it.

The exporter drew a mark's background after the glyphs and relied on it being
translucent enough to read through. The canvas does the opposite and says why
— *"Using pre (not post) so the text sits on top of the highlight. If we used
post, the highlight would cover the text."* — so an opaque highlight was legible
on screen and erased its own words in the export.

Backgrounds now paint first. Opacity means one thing again: the transparency
the author asked for, taken from the colour's own alpha unless a handler states
one. Highlight no longer has to compensate for a paint order it cannot see, and
a mark declaring an opaque background gets an opaque background instead of a
blank rectangle where its text used to be.
