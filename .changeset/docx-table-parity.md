---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` + `@scrivr/docx` — DOCX export and import for tables, so the
table extension round-trips through Word the same way it already does through
PDF.

Export is extension-owned: `Table.addExports()` now contributes `docx` node
handlers (`table` / `tableRow` / `tableCell` / `tableHeader`) alongside the
existing `pdf` handler, keeping `@scrivr/docx` free of table-specific
knowledge. The walker dispatches them like any other node — a `table` becomes
`<w:tbl>` with `<w:tblPr>` (single-line borders matching the canvas grid) +
`<w:tblGrid>` (column widths px→twips), each row a `<w:tr>` (with
`<w:tblHeader/>` when `repeatHeader` is set), each cell a `<w:tc>` carrying
`<w:gridSpan>`, `<w:vMerge>`, and `<w:shd w:fill>` for the background.

Import mirrors the list precedent — nested structural blocks are
package-handled (not extension-dispatched) so the recursion has the full
handler set. `parser.ts` claims `<w:tbl>` into a new `DocxBlock` table shape
(grid twips→px, rows, cells with gridSpan/vMerge/background); `transform.ts`'s
`buildTableNode` builds the `table` node, reconstructing a `<w:tblHeader/>` row
as `repeatHeader` + `tableHeader` cells so header semantics survive the trip.

A table imported into a schema without the table nodes warns
(`schema-missing-table`) and drops, the same non-fatal way a list does when
`bulletList`/`listItem` are absent.

Tests: round-trip coverage in `@scrivr/docx` (rows/cells/text, grid widths,
header row + background, and the emitted OOXML elements). The pre-existing
"unsupported element" policy tests move from `<w:tbl>` (now supported) to
`<w:sdt>`.

Other packages: lockstep version bump, no behavior change.
