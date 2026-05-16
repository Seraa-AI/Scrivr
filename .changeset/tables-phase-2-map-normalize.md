---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

Tables Phase 2 — `TableMap` + document-validity normalization. Editing operations and the upcoming Phase 3 row/column commands have a stable grid view of any table, and structurally invalid tables produced by paste, collab merges, or buggy authoring are silently repaired before the next render. Tables remain opt-in via `StarterKit.configure({ table: true })`.

**@scrivr/core**

- New `TableMap` (`packages/core/src/table/TableMap.ts`):
  - `width` / `height` / `map: number[]` (row-major flat array of cell offsets, `-1` for empty slots).
  - `positionAt(row, col)`, `findCell(cellOffset): Rect`, `cellsInRect(rect)`, `rowSpanAt(cellOffset)`.
  - vMerge chains walked once at build time; `rowSpanAt` is O(1). Broken chains (continue with no preceding restart) are defensively treated as fresh placements so queries still resolve.
  - Identity-cached via `WeakMap<Node, TableMap>` (`getTableMap(node)`); structural changes produce a new ProseMirror Node, which invalidates the cache for free.
- New `normalizeTables(state): Transaction | null` and `tableIntegrityPlugin()` (`packages/core/src/table/normalize.ts`):
  - Rule 1: clamp `cell.attrs.gridSpan < 1` to 1.
  - Rule 2: `vMerge: "continue"` with no preceding `restart` / `continue` at that column → reset to `"none"`.
  - Rule 3: `table.attrs.grid` shorter than the widest row → extend with default 100px columns.
  - Rule 4: rows narrower than `table.grid` → pad with empty `tableCell > paragraph` cells.
  - Fixed-point loop capped at `MAX_ITERATIONS = 8`; emits a console warning if the cap is hit. Selection-only transactions skip normalization (cheap path).
  - Plugin attaches via the Table extension's `addProseMirrorPlugins()`. Wired through `StarterKit` only when `table: true`.
- `Table` extension now contributes `addProseMirrorPlugins()` returning `[tableIntegrityPlugin()]`.
- 36 new tests: 19 covering `TableMap` (rectangular / horizontal merge / vertical merge / combined / cache identity / broken chain), 12 covering `normalizeTables` + `tableIntegrityPlugin` wiring, 5 covering `<table>` / `<tr>` / `<td>` / `<th>` / `<tbody>` parse via the schema's `parseDOM`.

**Known follow-up:** `appendTransaction` only fires on transactions, so a malformed initial doc loaded via `EditorOptions.content` does not get normalized until the first edit. Phase 5 (`tableEditingGuards`) will likely co-locate an initial-doc normalization pass in `BaseEditor` to close that gap.

**@scrivr/react / @scrivr/plugins / @scrivr/export-pdf / @scrivr/export-markdown**

- Lockstep version bump only — no API changes.
