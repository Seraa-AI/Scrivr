---
"@scrivr/core": patch
---

A cell selection deletes itself: `CellSelection.replace` empties each cell to
its default block (a paragraph), keeps the grid and leaves the caret in the
top-left cell, with whatever was typed or pasted there. Cut, Delete,
Backspace, typing and `tr.deleteSelection()` all go through it, so clipboard
cut no longer special-cases tables.

What changes for a reader: typing over a cell selection writes into the
top-left cell, as Word does, not the cell the drag ended in; a cell holding
only a horizontal rule or page break is emptied like any other; and cutting
cells that are already empty does nothing, keeping the selection, as Delete
does. `deleteSelection` returns null when nothing was deleted.
