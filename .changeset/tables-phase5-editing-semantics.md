---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` — Tables Phase 5: cell-editing semantics for the opt-in Table
extension (`StarterKit.configure({ table: true })`).

- **Tab / Shift-Tab** move between cells; Tab past the last cell appends a row
  and lands the caret in its first cell.
- **Backspace / Delete** never escape a cell boundary — a Backspace at the start
  of a cell (or Delete at its end) is swallowed instead of merging cells or
  deleting the table, while ordinary in-cell deletion falls through to the
  normal handler. Boundary detection walks the full path from the cell down, so
  a Backspace inside a nested list at the cell's top outdents. On a multi-cell
  selection they clear the selected cells in one undoable step.

Cross-cell selection geometry lives in `table/cellSelection.ts`: a `CellRange`
is derived on demand from a text selection that spans cells, with a partially
covered merged cell normalized in whole.

Keys are wired through `Table.addKeymap()` and chained in `StarterKit` (the
canvas input path dispatches through the merged extension keymap, not
ProseMirror plugin key props); each guard returns false when it doesn't apply so
the chain falls through to List/CodeBlock Tab and the base Backspace/Delete.

Paste distribution into a cell rectangle is deferred to Phase 7 (its seam is the
paste transformer, and it needs the cross-cell drag selection Phase 6 adds).
