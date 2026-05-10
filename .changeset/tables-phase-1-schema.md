---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

Tables Phase 1 — schema + insert/delete + placeholder render. Tables can now be inserted, removed, serialised to JSON, and survive page boundaries with a one-bordered-box-per-row placeholder. Real cell layout, cell text rendering, and PDF parity land in Phase 4 (see `docs/tables.md`).

**@scrivr/core**

- New `Table` extension with four Word-shaped node specs: `table` (`grid: number[]`, `layout: "fixed"`, `isolating`), `tableRow` (`repeatHeader`, `allowBreakAcrossPages`), `tableCell` and `tableHeader` (`gridSpan`, `vMerge`, `hMerge`, `hAlign`, `vAlign`, `background`, `margins`, `borders`, all `isolating`).
- New commands `insertTable({ rows, cols })` and `deleteTable()`. Insert places the table after the current top-level block with uniform 100px columns, an empty paragraph in each cell, and parks the cursor in the first cell. Delete walks up to the surrounding `table` ancestor.
- New `LayoutBlock.cells?: CellSubBlock[]` field and `CellSubBlock` interface (Phase 1: always `[]`; Phase 4 fills it).
- New `layoutTableRow()` in `BlockLayout.ts` — stub that returns a fixed-height (32px) `kind: "tableRow"` block per row.
- New `TableLayoutEngine` re-export module (placeholder for Phase 4's full engine) and `TableRowStrategy` placeholder renderer that paints a single 1px gray bordered rectangle per row.
- `PageLayout.collectLayoutItems()` now expands `table` nodes into one `LayoutItem` per row. Pagination treats `tableRow` as atomic alongside `leaf` blocks: whole rows move to the next page on overflow, and a row taller than the content area clips on the next page (Word's `cantSplit` policy).
- `StarterKit` accepts `table?: false` and registers Table by default.
- New `insertTable` toolbar item (▦ icon) inserts a 3×3 table.
- New markdown serializer rules for `table` / `tableRow` / `tableCell` / `tableHeader`. Phase 1 emits GFM-style pipe tables: first row becomes the header, cells flatten to pipe-escaped single-line text. Block content, marks, and merged cells collapse to plain text (full markdown serializer with merged-cell skip lands in Phase 8). Without this, `getMarkdown()` would throw on any document containing an inserted table since StarterKit enables Table by default.
- Regression test: `new Editor({ content: { ...table... } })` hydrates the table into the proper `tableHeader` / `tableCell` / `tableRow` / `table` structure. Locks in compatibility with `EditorOptions.content` (added by the DefaultContent extension PR) and confirms the schema round-trips through the constructor's content path.

**@scrivr/react / @scrivr/plugins / @scrivr/export-pdf / @scrivr/export-markdown**

- Lockstep version bump only — no API changes. PDF export ignores tables for now (canvas placeholder only); Phase 4 adds the PDF table handler in lockstep with real cell rendering, per the parity rule.
