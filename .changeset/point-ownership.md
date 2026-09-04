---
"@scrivr/core": patch
---

**Who owns a point**

A question the browser answers for a DOM editor and this one has to answer for
itself. It was being re-derived per call site, so fixing one place kept leaving
the others wrong.

A `behind` image took every click inside its rectangle, text included — so
clicking a word that sat over one selected the image, and the next Enter split
the document at the image's anchor: the text never moved, the keypress read as
ignored, and an empty paragraph accumulated on every press. `resolvePointOwner()`
now decides once, by z-order, and click routing, hover and drags all read that
answer.

Ownership also distinguishes *painted* text from *claimed* space. A line's box
runs the full content width however short its text is, so a one-word paragraph
claimed hundreds of pixels of blank space. That space is still the line's for
caret placement — clicking past a short line puts the caret at its end — but it
is not text, and it no longer out-ranks an image sitting in the gap. Hover
follows the same rule, so the cursor stops offering a caret where the reader
sees a picture.

- **`@scrivr/core`** — `resolvePointOwner()`; `CharacterMap.hasTextAt()` keyed
  to the painted glyph run; hover cursor resolved from ownership; Enter with an
  anchored object selected does nothing rather than splitting at its anchor; a
  `behind`/`front` float no longer pushes its own anchor paragraph to the next
  page.
