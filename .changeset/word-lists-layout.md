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
  line to the next tab stop, as Word's tab after the number does; when the
  next stop would leave less than an inch of the line, the text follows the
  number after a space, and a first word that still does not fit, but fits a
  line of its own, wraps to the next line, leaving the number alone on its
  line, as in Word; the caret, clicks, Home, End and selection keep to the
  word's line. The text is never drawn over the number. Existing lists move a
  quarter inch to the right.
- **Lists inside table cells are drawn.** A list in a cell (pasting one
  there makes one) used to lay out as one empty line, its text never painted
  on canvas or in PDF. A cell now lays out its blocks as the page body does:
  numbered, nested, indented and spaced, the number and the first word kept
  inside even a narrow cell, and a table nested in a cell shows its rows and
  its bottom border.
  A block that holds other blocks but is not a list or a table — a custom
  container, say — lays out the blocks it holds instead of one empty line
  (and still takes a line when it holds none), unless its node spec declares
  `layout: { kind: "block" }`, which keeps its own box and the painter it
  registered.
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
  headers and footers draw their numbers again. In the PDF a block's number
  is drawn once, after its handler, so a custom PDF handler that never calls
  `draw.lines` keeps it.
- **DOCX levels match the screen.** Numbering has nine levels with the same
  formats, glyphs and indents the editor draws; an item's further blocks
  export as Word's unnumbered continuation paragraphs, a table in an item with
  `w:tblInd` and a width that fits the rest of the column, and a sourced block
  indented with them; list properties are written in schema order. Not yet:
  every ordered list still shares one numbering instance and `order` is not
  exported, so in Word separate ordered lists continue each other's
  numbering.

**API changes**

- `@scrivr/core` exports `isListType` (moved here from track changes, and
  now what the list extension, Clear formatting, the semantic exporter and
  track changes ask), `bulletShape`, `bulletBox` and `listMarkerOf` (which
  answers how a block's marker is drawn: the face layout measured it in, the
  baseline of its first line, past any gap a full-width image leaves, and
  its `x`, past an image on the item's left that moves its line),
  with the types `BulletShape`, `BulletBox`, `ListMarker` and
  `ListMarkerFont`. `LayoutBlock.listMarkerFace` (new) carries the marker's
  face on every part of a split item, so a number left alone at a page
  bottom keeps its text's face.
- `ListItemStrategy` is removed, and blocks are no longer relabelled
  `blockType: "list_item"`. Core draws a block's list marker itself, over
  whatever painter draws the block, through the new `paintBlock` export —
  use it in any loop that paints laid-out blocks. **Migration:** a painter
  registered under `list_item` is never called now; register it under the
  node type (`paragraph`, …) instead.
- `isListType` holds only for a node whose content allows list items and
  nothing else.
- `nodeLayout` now defaults an undeclared node whose content is blocks to
  `{ kind: "transparent" }`: its blocks lay out in its place.
  `DEFAULT_NODE_LAYOUT` (`{ kind: "block" }`) is the default for undeclared
  nodes that hold inline content or nothing. **Migration:** a container node
  that holds blocks must declare `layout: { kind: "block" }` to keep its
  registered painter; left undeclared, its painter is never called.
- `LayoutBlock.listMarkerX` is now the marker's **left** edge (it was the
  right edge of a right-aligned marker).
- `BlockLayoutOptions.firstLineOffset` (new) adds to a node's own
  `textIndent` on the first line, and `firstLineOffsetAt` (new) gives it for
  a first line a float moves in, where Word puts the number at the line's
  start and the text at the next tab stop past it;
  `BlockLayoutOptions.keepAnchorLine` (new) keeps a line for a paragraph
  holding only floating images' anchors. `AvailableSegment.indentFrom` (new)
  records where a first line started before its indent moved it.
- `LineBreaker.breakIntoLines` takes `firstLineMayStayEmpty` (new: a first
  word that fits only the next line leaves the first line empty, as a list
  number's push does) and `firstLineIndent` (new: how far the provider's first
  line is indented, for a line a float starts some way in, so a float's
  narrowing is told apart from the indent's).
- Up and Down step over a line that holds no text: a number left alone on
  its line, and the gap a full-width image leaves in any paragraph, on the
  same page or across one.
- `DocxContext.textWidthTwips` (new, required): the width of the exported
  section's text column. Code that builds a `DocxContext` by hand must now
  set it; contexts from `@scrivr/docx` have it.
- `DocxNumberingLevel.format` accepts `"lowerLetter"` and `"lowerRoman"`, and
  takes optional `left` / `hanging` indents in twips.
