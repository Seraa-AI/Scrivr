---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/export-semantic": patch
"@scrivr/export-pdf": patch
"@scrivr/docx": patch
---

Lists lay out, print and export like Word's.

- **Nested lists and multi-block items are drawn.** Layout used to lay out
  only each list item's first paragraph, so an item nested with Tab, a second
  paragraph in an item (which Backspace at the start of an item makes), and any
  text in them vanished from the canvas and the PDF while staying in the
  document. Every block of an item is now laid out; the marker goes on the
  item's first visible line. A heading or code block in an item keeps its own
  style; a table in an item is indented with it.
- **Word's geometry.** Each level's text sits half an inch further in than
  the level above (the first level half an inch from the margin, where it was a
  quarter inch), and the marker hangs a quarter inch before the text,
  left-aligned. A number too wide for that space stays in the number column
  and moves the item's first line of text to the next tab stop, as Word does.
  However deep a list nests, an inch of the line is left for its text.
  Existing lists move a quarter inch to the right.
- **Markers by depth.** Bullets cycle •, ◦, ▪; ordered levels number
  1. / a. / i., each nested list counting from its own start. Lists nested
  past nine levels stay at the ninth. A list's start is kept within
  0–32767.
- **Numbers stay right while editing.** A renumbered item is laid out
  afresh, so Tab, Shift-Tab and joining items never leave an old number on
  screen.
- **Bullets are drawn as shapes**, on the canvas and in the PDF alike, so a
  second- or third-level bullet no longer prints as `?` with a standard PDF
  font. Markers take their line's size by one rule on screen and in PDF.
- **DOCX matches the screen.** Numbering has nine levels with the same
  formats, glyphs and indents the editor draws; an item's further blocks
  export as Word's unnumbered continuation paragraphs, indented to the item's
  text. `DocxNumberingLevel` gains `lowerLetter` / `lowerRoman` and optional
  `left` / `hanging` indents.
- **`@scrivr/core` exports `isListType`** (moved here from track changes, and
  now what the list extension, Clear formatting, the semantic exporter and
  track changes ask), and for drawing markers `bulletShape`, `bulletBox` and
  `listMarkerFont`.
