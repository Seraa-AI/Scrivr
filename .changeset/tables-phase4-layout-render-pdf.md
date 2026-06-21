---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` — Table Phase 4: real cell layout, rendering, cursor, and PDF
parity. Tables (opt-in via `StarterKit.configure({ table: true })`) are now a
usable feature, not a placeholder.

- **Layout** — `TableLayoutEngine` lays out each cell's child blocks inside its
  column box (width from the table's `grid`, minus padding) by reusing
  `layoutBlock`, and sizes each row to its tallest cell. Cell `x` is absolute,
  cell/child `y` is relative to the row top, so the layout stays
  position-independent and reuses across page placements. Table rows are
  re-measured fresh (bypass the block measure cache) so cell span positions stay
  correct.
- **Rendering** — `TableRowStrategy` paints cell borders/backgrounds and the
  cell text (reusing the body-text `drawBlock` path), with the top border
  suppressed for `vMerge` continuations so a vertical merge reads as one cell.
- **Cursor** — `populateCharMap` descends into cells, so clicking a cell places
  the caret inside it and typing works like any other block.
- **PDF parity** — table rows export to PDF. The handler is owned by the Table
  extension (`addExports({ pdf: { nodes: { tableRow } } })`) using a structural
  PDF-context shape, so core stays free of `pdf-lib`.

Demo: tables are enabled in the playground (`apps/docs`).

Other packages: lockstep version bump, no behavior change.
