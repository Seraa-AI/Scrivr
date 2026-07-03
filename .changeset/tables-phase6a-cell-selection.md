---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` — Tables Phase 6a: mouse cell selection for the opt-in Table
extension.

You can now **drag across table cells to select a rectangle** and see it
highlighted, and **Backspace/Delete clears the selected cells** — the Phase 5
multi-cell clear that was previously unreachable by mouse (table cells are
`isolating`, so a drag can't produce a spanning text selection).

- Cell hit-testing (`cellAtCoords`) maps a point to a cell from the laid-out
  cell rects.
- A persisted cell-selection range (`cellSelectionPlugin`) holds the dragged
  `{anchor, head}` cells, remaps through edits, and clears on any other
  selection change. `selectedCells()` resolves mouse and keyboard selections
  identically.
- The selection overlay paints the selected cells (`theme.selectionFill`).

Merge/split of a selected range follows in Phase 6b. A vMerge continuation row
of a selected merged cell isn't filled yet (cosmetic).
