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

**Clicking and typing where an anchored image overlaps text**

A `behind` image paints under the body text, but it was taking every click that
landed inside its rectangle. Clicking a word that happened to sit over one
selected the image instead of placing the caret, and the next Enter then split
the document at the image's anchor: the visible text never changed, so the
keypress read as ignored, while an empty paragraph accumulated on every press
until a hole opened in the page.

Z-order now decides who owns a point, in one place. `behind` yields to text
wherever text is painted and stays grabbable through the gaps; `front`,
`square` and `top-bottom` keep the point themselves. The hover cursor follows
the same rule, so the affordance matches what the click will do.

- **`@scrivr/core`** — new `resolvePointOwner()` owns the rule. Click routing,
  hover cursors and drags all read one answer, so they cannot disagree about a
  point; the three call sites that each re-derived it are gone. It is a pure
  function over placements, text lines and object rects, so the rule is tested
  without a document, a canvas or a DOM. New `CharacterMap.hasTextAt()` answers
  "is text painted here", the one primitive the rule needs.
- **`@scrivr/core`** — the hover cursor is resolved from that same answer, so it
  stops reading `move` over text a `behind` float yields to. Redundant cursor
  writes are skipped, since pointer moves mostly stay inside one region.
- **`@scrivr/core`** — Enter with an anchored object selected does nothing
  rather than splitting at its anchor. An inline image still splits, because it
  is content in the sentence.
- **`@scrivr/core`** — a `behind` or `front` float no longer pushes its own
  anchor paragraph to the next page. Those modes reserve no flow space, so
  moving the text left a gap the reader could not account for; the existing
  clamp keeps the image on its anchor's page instead.
