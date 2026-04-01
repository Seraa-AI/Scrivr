# Table Extension Implementation Plan

## Overview

Tables are the most complex block type in Scrivr. They require:
1. A new ProseMirror schema (4 node types)
2. Model-layer editing commands (merge/split cells, add/delete rows/columns)
3. A custom layout engine that understands cell spans and row heights
4. A canvas renderer that draws cell borders and text
5. A `CellSelection` overlay for multi-cell selections
6. Optional: canvas column resizing

This document describes what to adopt from `prosemirror-tables`, what to rewrite for canvas, and the phased implementation order.

---

## What to Adopt from `prosemirror-tables`

### ✅ Schema — `tableNodes()`

The 4 node types map directly to Scrivr's schema. Define them manually (or call `tableNodes()`) with these specs:

```
table        group: "block", content: "table_row+"
table_row    content: "(table_cell | table_header)+"
table_cell   content: "block+", attrs: {colspan, rowspan, colwidth, align}
table_header content: "block+", attrs: {colspan, rowspan, colwidth, align}
```

All four use `isolating: true` — this prevents PM selection from crossing cell boundaries without `CellSelection`.

`colwidth` is `number[] | null` — one entry per column the cell spans. Used by layout to size each column.

**Add `align` to cell attrs (not just `colwidth`).** Google Docs puts `text-align` on `<td>` directly, not just on the `<p>` inside. Capturing it at the cell level means paste from GDocs preserves per-cell alignment without any cleanup step:

```typescript
table_cell: {
  content: "block+",
  attrs: {
    colspan:  { default: 1 },
    rowspan:  { default: 1 },
    colwidth: { default: null },
    align:    { default: "left" },   // ← GDocs fix
  },
  parseDOM: [{
    tag: "td",
    getAttrs: (dom) => ({
      colspan:  Number((dom as HTMLElement).getAttribute("colspan")) || 1,
      rowspan:  Number((dom as HTMLElement).getAttribute("rowspan")) || 1,
      colwidth: parseColwidth((dom as HTMLElement).getAttribute("colwidth")),
      align:    (dom as HTMLElement).style.textAlign || "left",  // ← reads GDocs inline style
    }),
  }],
  toDOM(node) {
    const style = node.attrs.align !== "left" ? `text-align:${node.attrs.align as string}` : undefined;
    return ["td", { colspan: node.attrs.colspan, ...(style ? { style } : {}) }, 0];
  },
},
// table_header mirrors table_cell with tag "th"
```

`TableLayoutEngine` passes `cell.attrs.align` as the default alignment for every paragraph in that cell (overridable by the paragraph's own `align` attr).

### ✅ `tableEditing` Plugin

Pure model code — no DOM dependency. It provides:
- `fixTables(state)` — normalizes mismatched `colspan`/`rowspan` after paste/undo
- `CellSelection` normalization on every transaction
- Table paste logic (pastes into selected cells)

Import directly. No changes needed.

### ✅ All Commands

Import directly from `prosemirror-tables`:
- `addRowBefore`, `addRowAfter`, `deleteRow`
- `addColumnBefore`, `addColumnAfter`, `deleteColumn`
- `mergeCells`, `splitCell`
- `setCellAttr`
- `toggleHeaderRow`, `toggleHeaderColumn`, `toggleHeaderCell`
- `goToNextCell` (Tab / Shift-Tab)
- `deleteTable`

Wire these into `addCommands()` and `addKeymap()`.

### ✅ `TableMap`

The utility class that resolves cell positions from the flat PM structure. Canvas layout uses `TableMap.get(tableNode)` to:
- Get the total number of columns
- Find which cell occupies a given `(row, col)` position
- Resolve `colspan`/`rowspan` into absolute column ranges

No changes needed.

### ✅ `CellSelection`

Extends `Selection`. Used for multi-cell copy/paste, merge, and delete. Import and register in the schema. The `tableEditing` plugin creates `CellSelection` automatically when the user would otherwise select across cell boundaries.

---

## What to Build from Scratch

### 🔨 `TableLayoutEngine`

`prosemirror-tables` has no layout concept — it's PM model only. We need `TableLayoutEngine` to:

1. Use `TableMap` to determine column count and span geometry
2. Compute column widths from `colwidth` attrs (or divide `availableWidth` evenly)
3. Apply cell padding before passing `availableWidth` to `layoutBlock()` — text must not touch cell borders
4. For each row, lay out each cell's paragraph children using `layoutBlock()`, with the correct absolute `x`, `y`, `availableWidth = cellWidth - paddingH`
5. Row height = `max(cellHeight + paddingV for all cells in row)`
6. Thread `lineIndexOffset` across all cells in all rows
7. Register all glyphs into the shared `CharacterMap` — no changes to CharacterMap itself

Returns `RowLayoutResult[]`, one per row.

#### Cell Box Model

GDocs cells often carry `padding: 5pt` on `<td>`. Our schema doesn't capture cell padding — apply a hardcoded internal padding constant instead:

```typescript
const CELL_PADDING_H = 6; // px, left + right per side
const CELL_PADDING_V = 4; // px, top + bottom per side

// Inside layoutTable():
const textX          = cellX + CELL_PADDING_H;
const textY          = cellY + CELL_PADDING_V;
const textWidth      = cellWidth - CELL_PADDING_H * 2;
```

`layoutBlock(cellParagraph, { x: textX, y: textY, availableWidth: textWidth, ... })`.
Cell bounding box for border drawing remains `(cellX, cellY, cellWidth, cellHeight)`.

#### Coordinate Chain

Every value must be in absolute page coordinates — `CharacterMap` is keyed by docPos/page and has no relative-offset concept:

```
tableX, tableY           — from PageLayout (left margin + y cursor)
  └─ rowY                = tableY + sum(heights of preceding rows)
      └─ cellX           = tableX + sum(widths of preceding columns)
          └─ textX       = cellX + CELL_PADDING_H
          └─ textY       = rowY  + CELL_PADDING_V
          └─ textWidth   = cellWidth - CELL_PADDING_H * 2
```

Miss any level and `coordsAtPos` / `posAtCoords` will return wrong-page results.

### 🔨 `TableRowStrategy`

Implements `BlockStrategy.render()` for `table_row` nodes. During render, draws:
- Cell background fills
- Cell border rectangles
- Each cell's text content (re-uses `TextBlockStrategy` logic per cell)
- Header cell background (if `table_header`)

Each `RowLayoutResult` carries `cellSubBlocks[]` (the `LayoutBlock` from `layoutBlock()` for each cell's paragraph). The strategy iterates them and draws each one.

### 🔨 `CellSelection` Canvas Overlay

When `editor.state.selection` is a `CellSelection`, the overlay canvas draws:
- A semi-transparent blue rectangle over each selected cell's bounding box
- (The bounding boxes come from layout results — stored in a `tableRowMap` keyed by `nodePos`)

Register via `addOverlayRenderHandler()` (same pattern as collaboration cursors).

### 🔨 Column Resize Hit-Testing

`prosemirror-tables`' `columnResizing` plugin is entirely DOM-specific (mouse events on NodeViews). For canvas we need:

1. **Hit-test** — on `mousemove`, check if the cursor is within ±4px of a column border. If so, change cursor to `col-resize`.
2. **Drag** — on `mousedown` at a column border, begin a resize drag. On `mousemove`, update the `colwidth` attr via a transaction. On `mouseup`, commit.
3. Store column border x-positions in a `columnBorderMap` populated by `TableLayoutEngine` alongside cell bounding boxes.

This is a Phase 4 feature (deferred).

---

## Data Structures

### `CellSubBlock`

```typescript
interface CellSubBlock {
  cellNode: Node;
  cellNodePos: number;
  /** Sub-LayoutBlocks for each paragraph inside the cell */
  blocks: LayoutBlock[];
  /** Bounding box of the entire cell (for selection overlay + border drawing) */
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
}
```

### `RowLayoutResult`

```typescript
interface RowLayoutResult {
  /** The LayoutBlock for the row itself — used by PageLayout for page overflow */
  rowBlock: LayoutBlock;  // blockType: "table_row", lines: [], height: maxCellHeight
  /** Per-cell sub-layout — used by TableRowStrategy for rendering */
  cells: CellSubBlock[];
}
```

### `LayoutBlock` extension (minimal)

Add one optional field to `LayoutBlock`:

```typescript
/** Table row rendering data — only present when blockType === "table_row" */
cells?: CellSubBlock[];
```

This avoids a side-channel registry and keeps everything in the block tree.

---

## `PageLayout.layoutDocument()` Integration

The current `layoutDocument()` calls `layoutBlock(node, options)` for every top-level block. Tables need special handling:

```typescript
if (node.type.name === "table") {
  const rowResults = layoutTable(node, nodePos, options, fontConfig, measurer);
  for (const { rowBlock } of rowResults) {
    // Same overflow logic as any other block, but:
    // - entry.lines.length === 0  →  leaf overflow (whole row moves)
    // - No line splitting within rows (v1)
    placeBlock(rowBlock);
  }
} else {
  const entry = layoutBlock(node, options);
  placeBlock(entry);
}
```

Row-level overflow falls naturally into the existing `entry.lines.length === 0` branch (leaf block path) — the whole row moves to the next page rather than splitting lines.

Line splitting within cells (when a cell's text spans many lines) is supported in v2: once `TableLayoutEngine` produces `LayoutLine[]` per cell, the `lines` of the tallest cell can be used to split a row at a line boundary. Skip for v1.

---

## Extension Structure

```typescript
export const Table = Extension.create({
  name: "table",

  addNodes() {
    return {
      table:        { /* ... */ },
      table_row:    { /* ... */ },
      table_cell:   { /* ... */ },
      table_header: { /* ... */ },
    };
  },

  addProseMirrorPlugins() {
    return [tableEditing()];
  },

  addCommands() {
    return {
      addRowBefore:     () => addRowBefore,
      addRowAfter:      () => addRowAfter,
      deleteRow:        () => deleteRow,
      addColumnBefore:  () => addColumnBefore,
      addColumnAfter:   () => addColumnAfter,
      deleteColumn:     () => deleteColumn,
      mergeCells:       () => mergeCells,
      splitCell:        () => splitCell,
      toggleHeaderRow:  () => toggleHeaderRow,
      deleteTable:      () => deleteTable,
      insertTable:      () => insertTableCommand,
    };
  },

  addKeymap() {
    return {
      Tab:       goToNextCell(1),
      "Shift-Tab": goToNextCell(-1),
    };
  },

  addBlockStyles() {
    return {
      table_row: {
        font: "14px 'Inter', sans-serif",
        spaceBefore: 0,
        spaceAfter: 0,
        align: "left" as const,
      },
    };
  },

  addLayoutHandlers() {
    return { table_row: createTableRowStrategy() };
  },

  addToolbarItems() {
    return [{ command: "insertTable", label: "⊞", title: "Insert table", group: "insert", isActive: () => false }];
  },

  onEditorReady(editor) {
    // Register CellSelection overlay
    return editor.addOverlayRenderHandler((ctx, state, charMap, pages) => {
      drawCellSelectionOverlay(ctx, state, pages);
    });
  },
});
```

---

## Phased Implementation

### Phase 1 — Schema + Commands (no layout yet)

**Goal:** Tables can be inserted and edited; they render as placeholder boxes.

1. Add `table`, `table_row`, `table_cell`, `table_header` node types
   - Include `align` attr on cell nodes (GDocs compatibility — see Schema section)
2. Install `tableEditing` plugin
3. Wire all commands into `addCommands()` + Tab/Shift-Tab keymap
4. Register a placeholder `TableRowStrategy` that draws a gray rectangle (no text)
5. `PageLayout` detects `table` nodes and calls a stub `layoutTable()` that returns one row block per row with fixed height (e.g. 40px) and `lines: []`
6. `ClipboardSerializer` — add `table`, `td`, `th` → HTML round-trip (update `parseDOM` / `toDOM`)
7. **GDocs paste sanitization** — in `PasteTransformer.cleanPastedHtml()`, add table-specific rules:
   - Detect GDocs payload: `<meta>` tag with `google-docs` or `<b id="docs-internal-guid-...">` wrapper
   - Strip `border-collapse`, `border-spacing`, `mso-*` from `<table>` style
   - Strip cell padding from `<td>`/`<th>` style (our fixed `CELL_PADDING_H/V` replaces it)
   - Preserve only `text-align` on `<td>` (captured by `align` attr)
8. Tests: insert table, add/delete rows/columns, merge cells, Tab navigation, undo/redo, paste from GDocs preserves alignment

### Phase 2 — Layout Engine + Text Rendering

**Goal:** Cell text appears correctly positioned; cursor click works inside cells.

1. Implement `layoutTable()`:
   - Use `TableMap.get(tableNode)` to get column/row geometry
   - Compute column widths from `colwidth` attrs or equal division
   - For each row, for each cell: call `layoutBlock(cellParagraphNode, { nodePos, x, y, availableWidth: cellWidth })`
   - Aggregate `CellSubBlock[]` per row, compute row height, build `RowLayoutResult`
   - Thread `lineIndexOffset` across all cells
2. Store `cells: CellSubBlock[]` on each `RowLayoutResult.rowBlock`
3. Implement `TableRowStrategy.render()`:
   - Draw cell borders (`strokeRect` for each cell bbox)
   - For each cell's sub-blocks, call `TextBlockStrategy.render()` with the sub-block and correct `lineIndexOffset`
4. `CharacterMap` populated automatically by `TextBlockStrategy.render()` — no changes
5. Tests: cursor placement inside cells, click-to-focus, charmap glyph registration

### Phase 3 — CellSelection Overlay

**Goal:** Drag-selecting across cells highlights the selected range.

1. Register overlay render handler via `onEditorReady`
2. When `state.selection instanceof CellSelection`:
   - Call `selection.forEachCell((cellNode, cellPos) => ...)` to get selected cell positions
   - Look up each cell's bounding box from the layout result (stored in `LayoutBlock.cells`)
   - Draw `rgba(59, 130, 246, 0.2)` rect over each selected cell
3. Tests: multi-cell selection visually covers correct cells

### Phase 4 — Column Resizing (deferred)

**Goal:** Drag column borders to resize.

1. `TableLayoutEngine` stores column border x-positions in `columnBorderMap` (keyed by `nodePos`)
2. `Editor` mouse event handlers check `columnBorderMap` on `mousemove`
3. `col-resize` cursor when within ±4px of a border
4. Drag → `setCellAttr("colwidth", [...])` transaction on `mouseup`
5. Tests: resize updates layout, colwidth attrs persisted

---

## CharacterMap: No Changes Required

The `CharacterMap` is flat — keyed by `docPos`. Cell paragraphs have `docPos` values just like top-level paragraphs. `TextBlockStrategy.render()` registers their glyphs with the correct absolute `docPos`. Hit-testing (`posAtCoords`, `coordsAtPos`) works without any changes.

The only requirement: `TableLayoutEngine` must compute the correct absolute `nodePos` for each cell's paragraph child. ProseMirror positions inside a table:

```
tableNodePos              → before <table>
tableNodePos + 1          → inside <table>, before first <table_row>
tableNodePos + 1 + R      → before a row (R = sum of sizes of preceding rows)
tableNodePos + 1 + R + 1  → inside row, before first <table_cell>
...etc.
```

`TableMap` provides `cellPos(row, col)` which returns the absolute position of any cell's opening token. The paragraph inside a cell is at `cellPos + 1 + 1` (inside cell + past cell opening = inside first paragraph). Use PM's `node.resolve()` / `doc.nodeAt()` to walk positions rather than computing manually.

---

## Dependencies

```bash
pnpm add prosemirror-tables
```

All model-layer imports (`tableEditing`, `TableMap`, `CellSelection`, commands) come from `prosemirror-tables`. No DOM APIs are used from this package — only the model/plugin layer.

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `packages/core/src/extensions/built-in/Table.ts` | **Create** — Extension definition |
| `packages/core/src/layout/TableLayoutEngine.ts` | **Create** — `layoutTable()`, `CellSubBlock`, `RowLayoutResult` |
| `packages/core/src/layout/TableRowStrategy.ts` | **Create** — `BlockStrategy` for `table_row` |
| `packages/core/src/layout/BlockLayout.ts` | **Modify** — add `cells?: CellSubBlock[]` to `LayoutBlock` |
| `packages/core/src/layout/PageLayout.ts` | **Modify** — detect table nodes, call `layoutTable()` |
| `packages/core/src/input/ClipboardSerializer.ts` | **Modify** — add table HTML round-trip |
| `packages/core/src/extensions/built-in/Table.test.ts` | **Create** — unit tests for all phases |
| `packages/core/src/layout/TableLayoutEngine.test.ts` | **Create** — layout unit tests |
