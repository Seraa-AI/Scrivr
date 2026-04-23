# Scrivr — Next Steps Roadmap

Logical order. Each section builds on the previous one.

---

## 1. Merge & Publish (now)

Merge the three open PRs and publish 1.0.6.

- [ ] Merge PR #46 — readOnly mouse selection + command blocking
- [ ] Merge PR #47 — package READMEs, license fields, npm metadata, drop @scrivr/export
- [ ] Merge PR #49 — integration improvements (readOnly hook, CSS reset, indent, parseMarkdown, floating menu)
- [ ] Changeset release → 1.0.6

---

## 2. Float-aware block split (bug fix)

**Bug:** Pressing Enter after a float image (break/top-bottom mode) moves text
above the image. `splitBlockInheritAttrs` splits by doc position but floats
render at a displaced visual position, so the split puts text before the float.

**Fix direction:** After the standard split, detect float nodes (images with
`wrappingMode !== "inline"`) in the original paragraph that were before the
split point, and relocate them to the new paragraph.

**Files:**
- `packages/core/src/extensions/built-in/Paragraph.ts` — `splitBlockInheritAttrs`

**Steps:**
1. Write a failing test: insert paragraph with text + float image + more text, split after the image, assert image ends up in the correct paragraph
2. Implement `relocateFloatsAfterSplit(tr, splitPos)` — walk original paragraph children, find floats, move them to the new paragraph
3. Wire it into `splitBlockInheritAttrs` dispatch callback
4. Verify with manual testing (float in break mode, type below, press Enter)
5. Run full test suite

**Mock code exists** — was drafted and reverted in this session. The approach is sound but needs real float testing.

---

## 3. Float-only page cursor (bug fix)

**Bug:** Clicking on a page that only has a float image (no text lines in
CharacterMap) causes `posAtCoords` to return 0, jumping cursor to doc start.

**Root cause:** `nearestLine()` returns undefined when the clicked page has
zero registered lines. The naive cross-page fallback (tried and reverted)
broke normal cursor placement because the `lineY` glyph filter matched
glyphs from wrong pages.

**Fix direction:** Instead of cross-page glyph lookup, when the fallback
crosses pages return `line.endDocPos` directly (skip x hit-testing). Only
do glyph-level x matching when the line is on the same page as the click.

**Files:**
- `packages/core/src/layout/CharacterMap.ts` — `posAtCoords`

**Steps:**
1. Write failing tests (click on page with no lines, expect non-zero position)
2. Add `lastLineOnPage` / `firstLineOnPage` helpers (already drafted)
3. In `posAtCoords`: when fallback line is on a different page, return `line.endDocPos` directly instead of doing glyph x hit-test
4. Run full suite — verify normal clicks on populated pages are unaffected

---

## 4. LineHeight extension

**Why now:** Completes the paragraph formatting suite (align, indent,
textIndent, lineHeight) before tables. Tables look wrong without line
height control.

**Design:** Same pattern as Indent. Multiplier attr on paragraph/heading
nodes. Presets: 1.0, 1.15, 1.5, 2.0 (matching Word/Docs).

**Files:**
- `packages/core/src/extensions/built-in/LineHeight.ts` (new)
- `packages/core/src/extensions/built-in/Paragraph.ts` — add `lineHeight` attr
- `packages/core/src/extensions/built-in/Heading.ts` — add `lineHeight` attr
- `packages/core/src/layout/BlockLayout.ts` — apply multiplier to line height calculation
- `packages/core/src/extensions/StarterKit.ts` — wire in

**Steps:**
1. Add `lineHeight` attr to paragraph/heading (default: null = use block style default)
2. Create LineHeight extension with commands (`setLineHeight(1.5)`) and keymaps
3. In BlockLayout, after line breaking, multiply each line's `lineHeight` by the resolved multiplier
4. Inherit on Enter split
5. Add to StarterKit
6. Tests

---

## 5. Tables — Phase 1 (schema + commands)

**Goal:** Insert, edit, and navigate tables. No canvas rendering yet — just
the ProseMirror model layer working correctly.

**Steps:**
1. `pnpm add prosemirror-tables` in packages/core
2. Update table/tableRow/tableCell schema:
   - Add `table_header` node
   - Add `colwidth`, `align` attrs to cells
   - Add `isolating: true` to cells
   - Add parseDOM/toDOM for paste from Word/Docs
3. Create `Table` extension:
   - Import `tableEditing()` plugin from prosemirror-tables
   - Commands: insertTable, addRowBefore/After, addColumnBefore/After, deleteRow, deleteColumn, deleteTable, mergeCells, splitCell
   - Keymaps: Tab (next cell), Shift-Tab (prev cell)
4. Wire into StarterKit
5. Tests: insert table, navigate with Tab, add/remove rows/columns, undo

---

## 6. Tables — Phase 2 (layout + rendering)

**Goal:** Tables render on canvas with correct cell layout and cursor
placement.

**Steps:**
1. Modify `collectLayoutItems()` to expand `table → tableRow` items
2. Create `TableLayoutEngine`:
   - Compute column widths (equal split or from colwidth attrs)
   - Lay out each cell's paragraph via `layoutBlock()`
   - Row height = max(cell heights)
   - Thread `lineIndexOffset` through all cells
3. Create `TableRowStrategy` (BlockStrategy):
   - Draw cell borders
   - Paint cell content (text, background)
   - Register glyphs in CharacterMap via `populateCharMap`
4. In `buildBlockFlow`: detect table rows, call TableLayoutEngine
5. In `paginateFlow`: rows are leaf-like — whole row moves to next page if it doesn't fit
6. Tests: layout positions, CharacterMap hit-testing inside cells, page overflow

---

## 7. Tables — Phase 3 (CellSelection overlay)

**Goal:** Multi-cell selection with blue highlight overlay.

**Steps:**
1. Import `CellSelection` from prosemirror-tables
2. In OverlayRenderer: detect CellSelection, paint blue overlay per selected cell
3. In PointerController: handle mouse drag across cell boundaries to create CellSelection
4. Tests: drag-select cells, copy multi-cell selection

---

## 8. Tables — Phase 4 (column resize)

**Goal:** Drag column borders to resize.

**Steps:**
1. Add resize handle hit-testing in PointerController (similar to image resize)
2. On drag: update `colwidth` attrs on affected cells
3. Re-layout on each drag frame
4. Tests

---

## 9. PDF table export

**Goal:** Tables render in PDF export.

**Steps:**
1. Add table handler to `@scrivr/export-pdf`
2. Draw cell borders and content using pdf-lib
3. Handle page overflow (same row-level logic as canvas)
4. Tests

---

## Parking lot (do when needed)

- Cross-page selection highlight (bug — verify if PR #44 fixed it)
- Font loading detection (wire document.fonts.ready)
- onEditorReady type flaw (tied to BaseEditor refactor)
- CharacterMap partial invalidation (perf — do after TileManager)
- Large doc sync layout perf (10k+ blocks)
- Test coverage push (core 67.7% → 80%+)
- Accessibility DOM mirror (Phase 1)
- Ruler component (visual indent/margin control)
