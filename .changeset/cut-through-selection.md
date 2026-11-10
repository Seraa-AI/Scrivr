---
"@scrivr/core": patch
---

A cell selection deletes itself: `CellSelection.replace` empties each cell to
a paragraph, keeps the grid and leaves the caret in the top-left cell, with
what was typed there. Cut, Delete, typing and `tr.deleteSelection()` all go
through it, so clipboard cut no longer special-cases tables. Before, a plain
`deleteSelection` on a cell selection left the caret at the end of the last
cell. `clearSelectedCellsTr` is gone; `deleteSelection` covers it.
