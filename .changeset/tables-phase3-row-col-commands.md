---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` — Table Phase 3: structural row/column commands, mapped to Word.

The Table extension (opt-in via `StarterKit.configure({ table: true })`) now
exposes the structural editing commands on top of the existing
`insertTable`/`deleteTable`:

- `addRowBefore` / `addRowAfter` — insert an empty row above/below the
  selected cell's row. Inserting a row through a vertical merge extends the
  merge (a `continue` cell is added) instead of splitting it.
- `deleteRow` — remove the selected row. Deleting the top row of a vertical
  merge promotes the continuation below to the new master so the merge
  survives one row shorter. Deleting the last remaining row removes the whole
  table (an empty table is invalid).
- `addColumnBefore` / `addColumnAfter` — insert an empty column left/right of
  the selected cell and extend `table.grid`. Inserting through a horizontal
  `gridSpan` grows that cell's span rather than adding a stray cell.
- `deleteColumn` — remove the selected column and shrink `table.grid`. A cell
  whose span covers the deleted column shrinks by one; deleting the last
  column removes the table.
- `goToNextCell` / `goToPreviousCell` — move the selection between cells in
  document order. Binding these to `Tab`/`Shift-Tab` (with new-row-on-overflow)
  is the editing-guards plugin's job in a later phase.

Edits are fine-grained `setNodeMarkup` / `insert` / `delete` steps against the
live document, so cells untouched by a command keep their `Node` identity and
the measurement cache stays warm. `tableIntegrityPlugin` continues to repair
any residual structural drift after each command.

Other packages: lockstep version bump, no behavior change.
