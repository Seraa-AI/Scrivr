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
  style and painter; a table in an item is indented with it.
- **Word's geometry.** Each level's text sits half an inch further in than
  the level above (the first level half an inch from the margin, where it was a
  quarter inch), and the marker hangs a quarter inch before the text,
  left-aligned. A number wide enough to reach its text moves the item's first
  line to the next tab stop, as Word's tab after the number does. Existing
  lists move a quarter inch to the right.
- **No block is indented past an inch from the right margin.** Any block's
  indent — a deeply nested list, or a paragraph's own `indent` — leaves at
  least an inch of the line for its text.
- **Markers by depth.** Bullets cycle •, ◦, ▪; ordered levels number
  1. / a. / i., each nested list counting from its own start. Lists nested
  past nine levels stay at the ninth. A list's start is kept within
  0–32767 on the page, in copied HTML and in markdown.
- **Numbers stay right while editing.** A renumbered item is laid out
  afresh, so Tab, Shift-Tab and joining items never leave an old number on
  screen.
- **Bullets are drawn as shapes**, on the canvas and in the PDF alike, so a
  second- or third-level bullet no longer prints as `?` with a standard PDF
  font. Numbers are drawn in the face and size the layout measured them in.
- **DOCX levels match the screen.** Numbering has nine levels with the same
  formats, glyphs and indents the editor draws; an item's further blocks
  export as Word's unnumbered continuation paragraphs, and a table in an item
  with `w:tblInd`, indented to the item's text; list properties are written in
  schema order. Not yet: every ordered list still shares one numbering
  instance and `order` is not exported, so in Word separate ordered lists
  continue each other's numbering.

**API changes**

- `@scrivr/core` exports `isListType` (moved here from track changes, and
  now what the list extension, Clear formatting, the semantic exporter and
  track changes ask), `bulletShape`, `bulletBox` and `listMarkerFont`, with the
  types `BulletShape`, `BulletBox` and `ListMarkerFont`.
- `ListItemStrategy` is removed. The canvas draws a block's list marker
  whatever strategy draws the block, so blocks are no longer relabelled
  `blockType: "list_item"`.
- `LayoutBlock.listMarkerX` is now the marker's **left** edge (it was the
  right edge of a right-aligned marker).
- `BlockLayoutOptions.firstLineOffset` (new) adds to a node's own
  `textIndent` on the first line.
- `DocxNumberingLevel.format` accepts `"lowerLetter"` and `"lowerRoman"`, and
  takes optional `left` / `hanging` indents in twips.
