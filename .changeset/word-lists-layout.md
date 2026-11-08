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
  document. Every block of an item is now laid out, with the number on its
  first block — as in Word, even when that paragraph holds only a floating
  image, which then keeps one line for its number. A heading or code block in
  an item keeps its own style and painter; a table in an item is indented with
  it.
- **Word's geometry.** Each level's text sits half an inch further in than
  the level above (the first level half an inch from the margin, where it was a
  quarter inch), and the marker hangs a quarter inch before the text,
  left-aligned. A number wide enough to reach its text moves the item's first
  line to the next tab stop, as Word's tab after the number does; with no stop
  left on the line, the text follows the number after a space and is never
  drawn over it. Existing lists move a quarter inch to the right.
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
  font. Numbers are drawn in the face and size of the item's first text, past
  any image that opens the line, on the canvas and in the PDF. Lists in
  headers and footers draw their numbers again.
- **DOCX levels match the screen.** Numbering has nine levels with the same
  formats, glyphs and indents the editor draws; an item's further blocks
  export as Word's unnumbered continuation paragraphs, a table in an item with
  `w:tblInd` and a width that fits the rest of the column, and a sourced block
  indented with them; list properties are written in schema order. Not yet: every ordered list still shares one numbering
  instance and `order` is not exported, so in Word separate ordered lists
  continue each other's numbering.

**API changes**

- `@scrivr/core` exports `isListType` (moved here from track changes, and
  now what the list extension, Clear formatting, the semantic exporter and
  track changes ask), `bulletShape`, `bulletBox` and `listMarkerFont`, with the
  types `BulletShape`, `BulletBox` and `ListMarkerFont`.
- `ListItemStrategy` is removed, and blocks are no longer relabelled
  `blockType: "list_item"`. Core draws a block's list marker itself, over
  whatever painter draws the block, through the new `paintBlock` export —
  use it in any loop that paints laid-out blocks. **Migration:** a painter
  registered under `list_item` is never called now; register it under the
  node type (`paragraph`, …) instead.
- `isListType` holds only for a node whose content allows list items and
  nothing else.
- `LayoutBlock.listMarkerX` is now the marker's **left** edge (it was the
  right edge of a right-aligned marker).
- `BlockLayoutOptions.firstLineOffset` (new) adds to a node's own
  `textIndent` on the first line; `BlockLayoutOptions.keepAnchorLine` (new)
  keeps a line for a paragraph holding only floating images' anchors.
- `DocxContext.textWidthTwips` (new): the width of the exported section's
  text column.
- `DocxNumberingLevel.format` accepts `"lowerLetter"` and `"lowerRoman"`, and
  takes optional `left` / `hanging` indents in twips.
