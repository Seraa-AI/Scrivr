---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` — Tables Phase 5: editing semantics for the opt-in Table
extension (`StarterKit.configure({ table: true })`).

A new `tableEditingGuards()` plugin makes cell editing match Word/Docs:

- **Tab / Shift-Tab** move between cells; Tab past the last cell appends a row
  and lands the caret in its first cell.
- **Backspace / Delete** never escape a cell boundary — a Backspace at the start
  of a cell (or Delete at its end) is swallowed instead of merging cells or
  deleting the table, while ordinary in-cell deletion falls through to the
  normal handler. On a multi-cell selection they clear the selected cells in one
  undoable step.
- **Paste into a multi-cell selection** distributes: a pasted table fills the
  target rectangle cell-for-cell (row-major, clipped), and any other payload
  fills every selected cell with a copy.

Cross-cell selection geometry lives in `table/cellSelection.ts`: a `CellRange`
is derived on demand from a text selection that spans cells, with a partially
covered merged cell (gridSpan / vMerge) normalized in whole. Key handling runs
in the plugin's `handleKeyDown` prop, ordered before the merged extension keymap
so it defers to the default Backspace/Delete by returning false — no keymap
collision. A persisted cell selection with a drag-select overlay and merge/split
follows in Phase 6.
