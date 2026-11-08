---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/export-semantic": patch
"@scrivr/export-pdf": patch
---

Lists lay out like Word's.

- **Nested lists and multi-block items are drawn.** Layout used to lay out
  only each list item's first paragraph, so an item nested with Tab, a second
  paragraph in an item (which Backspace at the start of an item makes), and any
  text in them vanished from the canvas and the PDF while staying in the
  document. Every block of an item is now laid out; only its first block
  carries the marker.
- **Word's geometry.** Each level's text sits half an inch further in than
  the level above (the first level half an inch from the margin, where it was a
  quarter inch), and the marker hangs a quarter inch before the text,
  left-aligned. A number too wide for that space moves left rather than into
  the text. Existing lists move a quarter inch to the right.
- **Markers by depth.** Bullets cycle •, ◦, ▪; ordered levels number
  1. / a. / i., each nested list counting from its own start. Lists nested
  past nine levels stay at the ninth.
- **Bullets are drawn as shapes**, on the canvas and in the PDF alike, so a
  second- or third-level bullet no longer prints as `?` with a standard PDF
  font.
- **`@scrivr/core` exports the list model:** `isListType`, `listKind`,
  `listStart`, `listLevel`, `listMarker`, `bulletShape`, `bulletBox`,
  `LIST_LEVELS` and `LIST_MARKER_HANGING`. `isListType` moved here from track
  changes; the list extension, Clear formatting, the semantic exporter and
  track changes all ask it what a list is.
