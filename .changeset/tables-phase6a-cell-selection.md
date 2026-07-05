---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` — Table cell selection, built on a real `CellSelection`.

You can now **drag across table cells to select a rectangle**, **Shift-click a
second cell to extend the selection**, and **Backspace/Delete or type to clear
the selected cells**. Copy/cut round-trips the selection to an HTML `<table>`
(with `colspan`/`rowspan` for merged cells) plus tab/newline text, so it pastes
into Docs/Word/Notion as a grid. Because the cell selection is now a real
ProseMirror selection, undo, collaboration, and clipboard all work without any
special cases.

Selecting **across a table boundary** now matches Word/Google Docs: a drag that
runs from body text through a table selects the leading text, the **whole table**
(every cell washed), and the trailing text as one continuous selection — pointer
drag and Shift+Arrow behave identically at the boundary. Clicking inside a cell
places the caret exactly where you click (it no longer jumps to a neighbouring
cell near a cell edge or in padding). **Double-click selects the word and
triple-click the cell's text** — only a drag or Shift-click selects whole cells.

Under the hood this replaces the Phase-6 plugin shadow (a stored range + a
collapsed caret) with a `CellSelection` registered entirely through the selection
seam — a behavior, a hit tester, and a gesture. A text selection defers the
interior of any node that opts into painting its own wash
(`NodeSpec.selectionWash`), and untrusted serialized selections validate and
degrade to a caret instead of throwing.
