# Table Extension Implementation Plan

## Direction

Tables should be implemented as a Scrivr-owned, Word-grounded table engine. Do not add `prosemirror-tables` as a runtime dependency in `@scrivr/core`.

Use `prosemirror-tables` as reference material only. Its command behavior, table map algorithm, and normalization rules are useful, but its package brings `prosemirror-view` and DOM-oriented plugin props that do not fit Scrivr's canvas-only architecture.

The target shape:

1. Word-compatible schema concepts.
2. Internal table map and commands.
3. Canvas-native layout/render/selection.
4. DOCX-friendly import/export mapping later.

## Word Baseline

MS-OE376's Word deviations confirm the v1 scope:

- Use fixed table layout. Word supports `tblLayout: autofit | fixed`; v1 ships fixed only.
- Use row-level page overflow. Word can split rows, but v1 moves the whole row to the next page for predictable output.
- Use a fixed cell padding constant. Word's `tcMar` is per-cell; defer per-cell margins until the styling layer exists.
- Paint simple cell-level borders. Word's border conflict resolution between table, row, cell, and spacing rules is deferred polish.
- Store column widths at table level, matching Word's `tblGrid`.

Defer these Word features explicitly:

- Floating tables (`tblpPr`, `tblOverlap`) — future anchored-object integration.
- AutoFit table layout and `doNotAutofitConstrainedTables` — separate intrinsic sizing project.
- Repeated header rows (`tblHeader`) — add after row pagination is stable.
- Table styles and conditional formatting (`tblStyle`, `tblLook`, `cnfStyle`) — requires a styling layer.
- `textDirection`, `bidiVisual`, `tcFitText`, and `noWrap`.

## Schema

Use four node types:

```ts
table       group: "block", content: "tableRow+"
tableRow   content: "(tableCell | tableHeader)+"
tableCell  content: "block+"
tableHeader content: "block+"
```

Canonical attrs:

```ts
table: {
  layout: "fixed",        // future: "autofit"
  grid: number[],         // Word tblGrid equivalent, CSS px
}

tableRow: {
  repeatHeader: boolean,          // Word tblHeader; render deferred
  allowBreakAcrossPages: boolean, // v1 false
}

tableCell/tableHeader: {
  gridSpan: number,               // Word gridSpan, default 1
  vMerge: "none" | "restart" | "continue",
  hMerge: "none" | "restart" | "continue", // optional; gridSpan is usually enough
  hAlign: "left" | "center" | "right" | "justify",
  vAlign: "top" | "center" | "bottom",
  background: string | null,
  margins: null | { top: number; right: number; bottom: number; left: number },
  borders: null | CellBorders,
}
```

Rules:

- `table.grid` is the source of truth for column widths.
- `gridSpan` tells layout how many grid columns a cell covers.
- `vMerge` models vertical merges without inventing a separate rowspan source of truth.
- `hAlign` captures Google Docs/Word cell-level `text-align`; paragraph alignment may override it.
- `vAlign` is part of v1 schema even if layout initially treats all cells as top-aligned.
- `margins` and `borders` may remain `null` in v1 while layout uses default padding and simple strokes.

## Internal Modules

Create a table subsystem under core:

```txt
packages/core/src/extensions/built-in/Table.ts
packages/core/src/table/TableMap.ts
packages/core/src/table/commands.ts
packages/core/src/table/normalize.ts          // tableIntegrityPlugin — document validity
packages/core/src/table/editingGuards.ts      // tableEditingGuards — editing UX
packages/core/src/table/selection.ts
packages/core/src/table/insert.ts
packages/core/src/layout/TableLayoutEngine.ts
packages/core/src/layout/TableRowStrategy.ts
```

Code comments in these modules describe behaviour and constraints, not phase numbers or PR refs (per `feedback_comments_self_contained.md`). Phase context lives in this doc and the changelog; comments rot if they reference either.

`TableMap.ts` is the central algorithm. It should build a grid view of a table node:

```ts
interface TableMap {
  width: number;
  height: number;
  map: number[]; // row-major cell offsets relative to table start
  /**
   * Per-cell rowSpan derived from `vMerge` chains during build. Schema keeps
   * Word's `vMerge: "restart" | "continue"` (DOCX-faithful) but engine code
   * reads `rowSpan` directly so it never has to walk a chain at query time.
   * Chain breaks are detected and repaired during build, not at usage.
   */
  rowSpanAt(cellOffset: number): number;
  findCell(cellOffset: number): Rect;
  cellsInRect(rect: Rect): number[];
  positionAt(row: number, col: number): number | null;
}
```

Borrow the concept from `prosemirror-tables`, but implement it against Scrivr's Word-shaped attrs: `gridSpan`, `vMerge`, and table-level `grid`.

**Cache key.** `TableMap` is cached as `WeakMap<Node, TableMap>` keyed on the table node identity. PM transactions produce a new node on any structural change, so identity is sufficient — no attrs hash needed. The Phase 4 perf test covering `MeasureCacheEntry` identity preservation extends to verify `TableMap` instances are reused across non-structural transactions and rebuilt on structural ones.

## Commands

Implement these internally:

- `insertTable({ rows, cols })`
- `deleteTable()`
- `addRowBefore()`
- `addRowAfter()`
- `deleteRow()`
- `addColumnBefore()`
- `addColumnAfter()`
- `deleteColumn()`
- `mergeCells()`
- `splitCell()`
- `setCellAttr(name, value)`
- `setTableGrid(widths)`
- `toggleHeaderRow()`
- `goToNextCell(direction)`

Command invariants:

- Every table row resolves to the same grid width.
- Adding/deleting columns updates `table.grid`.
- Adding/deleting columns also updates affected `gridSpan` cells.
- Vertical merges use `vMerge: "restart" | "continue"` and must remain contiguous.
- Commands return normal ProseMirror `Command`s and must not require `EditorView`.

**Conflict resolution for column / row ops vs merged cells.** Match Word's behaviour: **shrink the merge.**

- Deleting a column inside a `gridSpan > 1` cell decrements the span; the cell stays merged across the remaining columns.
- Deleting a row inside a `vMerge` chain decrements the chain; if it removes the `restart` cell, the next `continue` is promoted to `restart`.
- Inserting a column inside a `gridSpan` cell extends the span by 1 (the new column is part of the existing merge, not a separate cell).
- Inserting a row inside a `vMerge` chain extends it by adding a new `continue` row.

Without an explicit policy, the alternatives (split-on-delete, refuse-the-command) leave structures the normalisation pass has to invent rules for, and the `N = 8` termination guard fires repeatedly. Picking one policy upfront and writing the tests for it keeps the integrity layer simple.

## Normalization And Editing Guards

Two layers, separately wired:

### `tableIntegrityPlugin()` — document validity

Implement `normalizeTables(state): Transaction | null`. It repairs:

- Missing or invalid `table.grid`.
- Rows narrower/wider than the table grid.
- Cells with `gridSpan < 1`.
- Broken `vMerge` continuations.
- Overlapping cell occupancy in the computed grid.

`tableIntegrityPlugin()` calls `normalizeTables()` in `appendTransaction`.

**Termination guard.** `normalizeTables` runs as a fixed-point loop; cap at `N = 8` iterations and return a `status: "exhausted"` marker if any rule still fires at the cap. Without the guard, a malformed input + a buggy repair rule loops forever inside `appendTransaction`. Mirrors the solver-loop discipline in `docs/anchored-objects/03-test-contract.md` § Solver invariants.

### `tableEditingGuards()` — editing UX

Separate plugin. Replaces what upstream `tableEditing()` did beyond pure validity:

- Detect when a text selection starts in one cell and ends in another; promote to a `CellRange`.
- Prevent `Backspace` / `Delete` inside an empty cell from escaping through cell boundaries — clear cell content or move within the cell, never delete the table boundary.
- If a `CellRange` is active and the clipboard contains a table, distribute pasted cells into the selected rectangle.
- If a `CellRange` is active and the clipboard contains plain text/blocks, fill the selected cells in row-major order.
- `Tab` / `Shift-Tab` cell navigation (also creates a new row when tabbing past the last cell).
- Clear selected cells without destroying table structure.

`tableIntegrityPlugin` is about valid documents; `tableEditingGuards` is about user intent and editing safety. Keeping them separate makes invariants honest and tests focused.

## Layout

`TableLayoutEngine` responsibilities:

1. Read `table.grid` and scale/fit it into `availableWidth`.
2. Build a `TableMap` for span geometry. Cache once per table; do not rebuild per row.
3. Precompute a cumulative `columnX: number[]` array so each cell's `x` is a single array lookup, not an O(n) prefix sum per cell.
4. Apply default cell padding (`CELL_PADDING_H = 6`, `CELL_PADDING_V = 4`, file-local for v1) unless `cell.attrs.margins` exists.
5. For each visible cell, compute absolute cell bounds.
6. Lay out each block inside each cell with `layoutBlock()`.
7. Compute row height from max cell content height plus padding.
8. Return one row-level layout block per row for pagination.

Each `RowLayoutResult` carries a `tableId: string` (stable per-document table identifier) so selection overlays, hit-tests, and future column-resize work can group per-table without re-walking the doc tree.

### Sandboxed cell layout contract

Each cell is a sandboxed block layout context. `TableLayoutEngine` threads `lineIndexOffset` explicitly through the cell loop:

```ts
let globalLineOffset = options.lineIndexOffset;
for (const row of rows) {
  for (const cell of cellsInRow(row)) {
    const result = layoutBlock(cellParagraph, {
      x: textX,
      y: textY,
      availableWidth: textWidth,
      lineIndexOffset: globalLineOffset,
      // ...
    });
    globalLineOffset += result.lines.length;
  }
}
```

Each cell receives a starting offset and the engine merges the result into the global flow. Without this, glyph indices collide across cells, cursor navigation jumps between unrelated docPos ranges, and `CharacterMap` ends up with overlapping ranges.

Cell coordinates must be absolute page coordinates:

```txt
tableX, tableY
  rowY = tableY + previous row heights
    cellX = tableX + columnX[colIndex]
      textX = cellX + padding.left
      textY = rowY + padding.top
```

V1 pagination:

- A row is atomic.
- If a row does not fit, move it to the next page.
- Do not split rows or repeat header rows in v1.

**Pathological row policy.** A single row whose content height exceeds the full content page height places on the next page and clips at the page bottom. Mirrors Word's `cantSplit` behaviour per MS-OE376 §2.4.6 ("Word starts the row on a new page and cuts off overflowing contents"). Without an explicit policy this case is undefined and the renderer can paint off-page or crash.

## LayoutBlock Shape

Tables make `LayoutBlock` polymorphic. Add an explicit discriminator rather than relying only on `cells?: ...`.

```ts
type LayoutBlockKind = "text" | "leaf" | "tableRow";

interface LayoutBlock {
  kind: LayoutBlockKind;
  // existing fields...
  lines: LayoutLine[];
  cells?: CellSubBlock[];
}
```

Invariants:

- `kind === "text"`: `cells` absent, `lines` drives rendering.
- `kind === "leaf"`: `cells` absent, `lines` empty.
- `kind === "tableRow"`: `cells` present, `lines` empty.

This keeps the current structure mostly intact while making renderer/export branching explicit.

## Rendering

`TableRowStrategy` draws:

- Cell backgrounds.
- Simple cell borders.
- Header cell background.
- Nested cell content by rendering each cell's child `LayoutBlock`s.

The renderer should not re-compute table geometry. It consumes the cell geometry produced by `TableLayoutEngine`.

## Selection

Implement a Scrivr-owned canvas cell selection.

V1 can start with a lightweight internal selection helper rather than a full ProseMirror `Selection` subclass:

```ts
interface CellRange {
  tablePos: number;
  anchorCellPos: number;
  headCellPos: number;
}
```

Eventually this may become a real `Selection` subclass if copy/paste and collaborative selection need it.

Overlay behavior:

- Hit-test cells using layout cell bounds.
- Drag across cells to set a rectangular `CellRange`.
- Draw selected cell rectangles on the overlay canvas.
- Merge/split/delete commands read the current table cell range.

## Clipboard And Import

HTML paste:

- Parse `<table>`, `<tr>`, `<td>`, `<th>`.
- Convert `<colgroup>` or cell widths into `table.grid` where possible.
- Convert `colspan` to `gridSpan`.
- Convert `rowspan` to `vMerge` restart/continue cells.
- Preserve cell `text-align` as `hAlign`.
- Preserve `vertical-align` as `vAlign`.
- Strip Word/GDocs noise: `mso-*`, `border-collapse`, `border-spacing`, excessive inline padding.

DOCX later:

- `tblGrid` maps directly to `table.grid`.
- `gridSpan` maps to `cell.gridSpan`.
- `vMerge` maps to `cell.vMerge`.
- `tcMar` maps to `cell.margins`.
- `tblHeader` maps to `row.repeatHeader`.
- `tblLayout` maps to `table.layout`.

## Phased Implementation

### Phase 0 — Design Cleanup

1. Remove `prosemirror-tables` as a planned dependency.
2. Update docs and TODOs to say "reference only."
3. Decide exact schema attrs and defaults.
4. Add tests for schema parse/create invariants.

### Phase 1 — Schema And Basic Insert

Goal: tables can exist in documents and render as placeholders.

1. **Delete the existing `table` / `tableRow` / `tableCell` stubs from `packages/core/src/model/schema.ts`.** They use an incompatible `columnWidths` attr, lack `isolating`, and have no parseDOM. The Table extension becomes the single source of truth. (Cross-ref `todo_schema_ts_deprecation.md` — the broader schema.ts deprecation is tracked separately; this is the scope-bounded slice for tables.)
2. Add `kind: LayoutBlockKind` discriminator to `LayoutBlock` and migrate every existing consumer from `lines.length === 0` checks to explicit `kind` branches (image, hr, pageBreak, anchor-only-flow detection, leaf overflow path in `paginateFlow`, PDF defaults, renderer dispatch).
3. **REGRESSION CRITICAL test sweep.** Verify every existing block type renders unchanged after the discriminator lands: paragraph, heading, list, listItem, image, hr, pageBreak. Sweep `LayoutBlock.test.ts`, `PageRenderer.test.ts`, `PageLayout.test.ts`, `buildPdf.test.ts`. No AskUserQuestion — this is mandatory before any Table-extension code lands.
4. Create `Table` extension.
5. Add `table`, `tableRow`, `tableCell`, `tableHeader` node specs.
6. Add `insertTable({ rows, cols })`.
7. Add `deleteTable()`.
8. Add stub `TableLayoutEngine` that returns fixed-height row blocks with `kind: "tableRow"` and `cells: []`.
9. Add placeholder `TableRowStrategy`.
10. Wire `StarterKit` option for tables.
11. Tests: create table, serialize JSON, undo/redo insert/delete.

### Phase 2 — TableMap And Normalization

Goal: table structure is stable after commands/paste.

1. Implement internal `TableMap`.
2. Implement `normalizeTables()`.
3. Install `tableIntegrityPlugin()`.
4. Test invalid grids, missing cells, bad spans, broken vertical merges.
5. Add HTML parse tests for basic tables.

### Phase 3 — Row/Column Commands

Goal: edit table structure without layout polish.

1. Implement add/delete row.
2. Implement add/delete column.
3. Update `table.grid` during column operations.
4. Preserve and adjust `gridSpan` and `vMerge`.
5. Add `goToNextCell()`.
6. Tests for rectangular tables and merged-cell edge cases.

### Phase 4 — Real Layout, Rendering, And PDF Parity

Goal: cell text renders, cursor hit-testing works, PDF export keeps parity.

1. Compute column widths from `table.grid` and precompute the `columnX` cumulative array.
2. Cache `TableMap` once per table.
3. Layout cell child blocks with default padding using the sandboxed `lineIndexOffset` contract above.
4. Store `cells` on `kind: "tableRow"` layout blocks.
5. Render borders/backgrounds/text via `TableRowStrategy`.
6. Register character map entries through child block rendering (no CharacterMap changes).
7. **PDF table handler** in `packages/export-pdf/src/defaults.ts`. Lands in the same PR as canvas render — required by `feedback_pdf_parity.md`. Renders rows + cells + borders + text + merged cells; honours row-overflow page-boundary placement.
8. Tests:
   - Cursor placement inside cells, row overflow, page transition.
   - Pathological-row policy (row > page height clips on next page).
   - **Cache identity perf test.** After a structural command (add column / delete row), surviving cells' `MeasureCacheEntry` instances are the same object. Catches PM Node-identity breakage that would defeat the existing measurement cache.
   - **Phase 1b inputHash invalidation test.** Modifying a cell's content invalidates that row's pagination cache without expanding `pageRectsDigest` to track table geometry.
   - PDF parity: golden tests render a sample table and assert PDF byte structure matches canvas semantics (borders, cell bounds, merged cells, row breaks).

### Phase 5 — Editing Semantics

Goal: cell editing UX matches Word/Docs expectations.

1. Implement `tableEditingGuards()` plugin (separate from `tableIntegrityPlugin()`).
2. Cross-cell text selection promotion: detect a text selection that starts in one cell and ends in another; convert to a `CellRange`.
3. `Backspace` / `Delete` inside an empty cell clears content or moves within the cell — never deletes the table boundary.
4. `Tab` / `Shift-Tab` cell navigation; tabbing past the last cell creates a new row.
5. Paste into a `CellRange`: distribute pasted table cells into the selected rectangle; fill plain text/blocks row-major.
6. Tests: cross-cell selection, deletion at cell boundaries, paste table into selected cells, paste plain text into cells, undo/redo across all of the above.

### Phase 6 — Cell Selection And Merge/Split

Goal: common table editing workflows work on canvas.

1. Implement cell hit-testing from layout cell bounds.
2. Implement drag cell range selection.
3. Draw selection overlay.
4. Implement `mergeCells()`.
5. Implement `splitCell()`.
6. Tests: rectangular selections, merge/split, delete selected cells.

### Phase 7 — Clipboard Round Trip

Goal: paste/copy common tables.

1. Add table support to `ClipboardSerializer`.
2. Add table rules to `PasteTransformer`.
3. Preserve `grid`, `gridSpan`, `vMerge`, `hAlign`, and `vAlign`.
4. Tests with simple HTML, GDocs-like HTML, and Word-like HTML.

### Phase 8 — Markdown And DOCX Export

Goal: extra export targets beyond the PDF parity that landed in Phase 4.

1. Markdown serializer for simple tables when possible (skip merged cells; markdown can't represent them).
2. DOCX exporter mapping to `tblGrid`, `gridSpan`, `vMerge`, `tcMar`, borders.

### Phase 9 — Deferred Polish

1. Column resizing.
2. Repeated header rows.
3. Row splitting.
4. AutoFit.
5. Floating tables.
6. Table styles and border conflict resolution.
7. **`tableLayoutCache: Map<tablePos, { cells: Map<cellPos, bbox> }>`** — centralise cell bounding boxes so selection overlay, hit-testing, and column resize don't re-walk per-row `CellSubBlock` arrays. Land when Phase 6 (selection) or column-resize work reveals the friction.
8. Migrate `CellRange` to a real ProseMirror `Selection` subclass when copy/paste or collab cursor sync demands it.

## Dependencies

No new runtime dependency is required for v1.

Reference material:

- `prosemirror-tables` for table map, normalization, and command behavior.
- MS-OE376 / WordprocessingML for schema and import/export semantics.

If code is copied from `prosemirror-tables`, preserve MIT attribution and license notes. Prefer clean-room implementation shaped around Scrivr's model.

## Files To Create / Modify

| File | Action |
|------|--------|
| `packages/core/src/extensions/built-in/Table.ts` | Create table extension |
| `packages/core/src/table/TableMap.ts` | Create Word-shaped table map |
| `packages/core/src/table/commands.ts` | Create table commands |
| `packages/core/src/table/normalize.ts` | Create `tableIntegrityPlugin` + `normalizeTables` (document validity) |
| `packages/core/src/table/editingGuards.ts` | Create `tableEditingGuards` plugin (editing UX) |
| `packages/core/src/table/selection.ts` | Create canvas cell selection helpers |
| `packages/core/src/layout/TableLayoutEngine.ts` | Create table layout |
| `packages/core/src/layout/TableRowStrategy.ts` | Create canvas renderer strategy |
| `packages/core/src/model/schema.ts` | Delete the existing `table` / `tableRow` / `tableCell` stubs |
| `packages/core/src/layout/BlockLayout.ts` | Add `kind` discriminator + `cells?: CellSubBlock[]`; migrate every `lines.length === 0` consumer |
| `packages/core/src/layout/PageLayout.ts` | Detect tables and call table layout |
| `packages/core/src/input/ClipboardSerializer.ts` | Add table HTML round-trip |
| `packages/core/src/input/PasteTransformer.ts` | Add table paste cleanup/parsing |
| `packages/core/src/extensions/StarterKit.ts` | Add table option and registration |
| `packages/export-pdf/src/defaults.ts` | Add table export handler |
| `packages/export-docx/src/*` | Later DOCX table handlers |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | outside-AI review pasted inline by user; 5 architecture improvements captured |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_found | 13 plan additions to land — 5 architecture, 3 code quality, 2 perf, 2 critical failure-mode gaps, 1 regression sweep; 80 test paths surfaced; 3 TODOs accepted; PDF parity bundled into Phase 4 |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | n/a — backend feature |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | n/a |

- **CROSS-MODEL:** Outside-AI review (pasted by user during Issue 7) and this Eng Review converge on three points: (a) sandboxed cell layout context with explicit `lineIndexOffset` threading, (b) split between document validity and editing UX, (c) row-atomic page overflow is correct.
- **UNRESOLVED:** 0 — every issue either resolved with user decision or captured as TODO/plan addition.
- **VERDICT:** ENG CLEARED — ready to implement after the 13 plan additions are edited into `docs/tables.md`. CEO review is optional; this is a feature-execution doc, not a strategic scope decision.

