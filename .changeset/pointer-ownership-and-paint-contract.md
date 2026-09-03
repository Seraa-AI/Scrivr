---
"@scrivr/core": patch
"@scrivr/ai": patch
"@scrivr/docx": patch
"@scrivr/export": patch
"@scrivr/export-markdown": patch
"@scrivr/export-pdf": patch
"@scrivr/export-semantic": patch
"@scrivr/plugins": patch
"@scrivr/react": patch
---

**Who owns a point, and whether a paint happened**

Two questions the browser answers for a DOM editor and this one has to answer
for itself. Both were being re-derived per call site, so fixing one place kept
leaving the others wrong.

**Ownership.** A `behind` image took every click inside its rectangle, text
included — so clicking a word that sat over one selected the image, and the
next Enter split the document at the image's anchor: the text never moved, the
keypress read as ignored, and an empty paragraph accumulated on every press.
`resolvePointOwner()` now decides once, by z-order, and click routing, hover
and drags all read that answer.

Ownership also distinguishes *painted* text from *claimed* space. A line's box
runs the full content width however short its text is, so a one-word paragraph
claimed hundreds of pixels of blank space. That space is still the line's for
caret placement — clicking past a short line puts the caret at its end — but it
is not text, and it no longer out-ranks an image sitting in the gap. Hover
follows the same rule, so the cursor stops offering a caret where the reader
sees a picture.

**Painting.** `renderPage` abandons a paint when the layout moves under it,
which is right, but it abandoned silently while `TileManager` recorded the
version as painted. A tile that believes it drew a version it never drew will
not repaint until something unrelated moves it. It now reports whether it
painted, and only a completed paint is recorded.

- **`@scrivr/core`** — `resolvePointOwner()`; `CharacterMap.hasTextAt()` keyed
  to the painted glyph run; hover cursor resolved from ownership; Enter with an
  anchored object selected does nothing rather than splitting at its anchor; a
  `behind`/`front` float no longer pushes its own anchor paragraph to the next
  page; `renderPage` returns whether it painted.
