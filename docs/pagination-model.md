# Pagination Model

This document explains how pagination works in Scrivr, evaluates how well the current pipeline accommodates planned features (headers/footers, columns, tables), and calls out the concrete refactor points.

## The pipeline

The layout engine (`packages/core/src/layout/PageLayout.ts`) runs a 4-stage pipeline, driven by `runPipeline()` at `PageLayout.ts:357`. Pagination is only *one* stage — specifically `paginateFlow()` at `PageLayout.ts:469` — and it operates on already-measured, position-independent blocks.

| Stage | Function | What it does |
|---|---|---|
| 1 | `buildBlockFlow` (`PageLayout.ts:812`) | Measures every block in document order. Produces `FlowBlock[]` — height + lines + spacing, **no y-position, no page assignment**. |
| 2 | `paginateFlow` (`PageLayout.ts:469`) | Pure geometry. Walks the flow and assigns each block to a page, splitting text blocks at line boundaries when they overflow. |
| 3 | `applyFloatLayout` (`PageLayout.ts:915`) | After pages exist, computes float rectangles, builds an `ExclusionManager`, reflows any block touched by a float, and may re-split blocks pushed past the page bottom (`splitBlockAtBoundary`). |
| 4 | `buildFragments` (`PageLayout.ts:1312`) | Stamps `fragmentIndex` / `fragmentCount` on all split parts and builds `fragments` / `fragmentsByPage` indexes used by `CharacterMap` + hit testing. |

Key property: **Stage 1 is position-independent.** That lets its results be cached per-node in a `WeakMap<Node, MeasureCacheEntry>` — paginateFlow can then re-page without re-measuring.

## How `paginateFlow` decides boundaries

For each `FlowBlock` it tracks a `y` cursor (starting at `margins.top`) and a `currentPage`:

1. **Page breaks** — hard `pageBreak` items flush the current page and reset `y` (skipped in pageless mode).
2. **Margin collapsing** — `collapseMargins(prevSpaceAfter, flow.spaceBefore)` at `PageLayout.ts:1685`, suppressed for the first block on a page.
3. **Overflow check**: `overflows = blockBottom > pageBottom && (!isFirstOnPage || flow.lines.length > 0)`. The `isFirstOnPage` guard prevents an over-tall leaf block from looping forever on fresh pages.
4. **Three placement cases**:
   - **Fits** → push onto current page, advance `y`.
   - **Leaf block** (no lines, e.g. image, HR) → move whole block to a new page. If it's taller than any page (`tooTallForAnyPage`), it's force-placed on the current page and allowed to overflow.
   - **Text block** → enter the split loop (`PageLayout.ts:606`–`723`). Greedily take as many lines as fit in `pageAvailable`, emit a `LayoutBlock` with `isContinuation` / `continuesOnNextPage` flags and a `fragmentIndex`, open a new page, slice remaining lines, repeat.
5. The split loop has two edge cases worth knowing:
   - **Gap suppression** — if inter-block spacing pushes `targetY` into a "dead zone" where zero lines fit but one line *would* fit without the gap, it retries from `y` instead of advancing pages.
   - **Top-of-page / sub-pixel guard** — if `linesFit === 0` at top of page (or after gap-suppress), force one line to avoid empty-page loops caused by sub-pixel shortfalls.

## Fragment identity

A single paragraph that spans pages becomes several `LayoutBlock`s sharing one `sourceNodePos`. Each part carries:

- `isContinuation: true` on all but the first,
- `continuesOnNextPage: true` on all but the last,
- `fragmentIndex` stamped in `paginateFlow`, then `fragmentCount` filled in by `buildFragments`.

`CharacterMap` uses **char-level span ranges** (not node ranges) so binary search resolves the right fragment for a split paragraph.

## Floats and re-pagination

`applyFloatLayout` runs *after* `paginateFlow`. When a float's exclusion zone shoves a paragraph past `pageBottom`, the engine does **not** move it wholesale — it calls `splitBlockAtBoundary` (`PageLayout.ts:1401`) so the overflowing lines flow onto the next page. This is the 3/3b split behavior.

## Performance shortcuts `paginateFlow` knows about

- **Phase 1b early termination** (`PageLayout.ts:733`): once it sees a cache hit *after* the edit point and that block lands at the exact same `(targetY, pageNumber)` as in the previous layout, it copies all remaining blocks/pages from `previousLayout._pass1Pages` with a `shiftBlock(delta)` — no further iteration.
- **Streaming / chunking**: `LayoutResumption` lets `paginateFlow` stop after `maxBlocks` and resume on the next frame (`LayoutCoordinator` schedules first 100 blocks sync, remainder via `requestIdleCallback`).
- **Pageless mode**: `contentHeight = Infinity`, overflow is disabled, hard page breaks are ignored, `totalContentHeight` is derived from `y` instead of `pages.length * pageHeight`.

## What pagination does *not* own

- No measurement (Stage 1's job).
- No character-to-pixel mapping (`CharacterMap` is populated during rendering, not layout).
- No float placement or exclusions (Stage 3).
- No DOM — it returns a pure `DocumentLayout`; `ViewManager` + `PageRenderer` consume that structure and paint the canvases.

The net effect: pagination is a small, pure function over pre-measured flow blocks, with its two real sources of complexity being (a) splitting text across boundaries while preserving fragment identity, and (b) the Phase 1b incremental shortcut.

---

## Accommodating future features

### Current `PageConfig` (`PageLayout.ts:16`)

```ts
interface PageConfig {
  pageWidth: number;
  pageHeight: number;
  margins: { top: number; right: number; bottom: number; left: number };
  fontFamily?: string;
  pageless?: boolean;
}
```

No header/footer fields. Defaults at `PageLayout.ts:332`:

```ts
defaultPageConfig     = { pageWidth: 794, pageHeight: 1123, margins: { top: 72, right: 72, bottom: 72, left: 72 } }
defaultPagelessConfig = { pageWidth: 885, pageHeight: 0,    margins: { top: 40, right: 73, bottom: 40, left: 73 }, pageless: true }
```

### Where `pageBottom` / content height actually live

There is **no** stored `pageBottom`. It's derived in four places independently:

1. **`runPipeline`** (`PageLayout.ts:372`) — hands `contentHeight` to `paginateFlow`:
   ```ts
   const contentHeight = pageConfig.pageless
     ? Infinity
     : pageHeight - margins.top - margins.bottom;
   ```
   Note: `paginateFlow` never sees `pageHeight` — only `margins` + `contentHeight`. That's already a clean abstraction boundary.

2. **Inside `paginateFlow`** (`PageLayout.ts:551`):
   ```ts
   const pageBottom = margins.top + contentHeight;
   ```
   Recomputed per block. The Y cursor starts at `margins.top` (line 387) and resets to `margins.top` every new page (lines 506, 592, 665, 716).

3. **`applyFloatLayout`** has its own copy (`PageLayout.ts:992`):
   ```ts
   const floatPageBottom = pass1Result.pageConfig.pageHeight - margins.bottom;
   ```
   This one bypasses `contentHeight` and reaches back into `pageConfig.pageHeight` directly.

4. **`totalContentHeight`** (`PageLayout.ts:445`):
   ```ts
   const totalContentHeight = pageConfig.pageless
     ? pr.y + margins.bottom
     : allPages.length * pageHeight;
   ```

### Headers and footers

Headers/footers are **not flow content**, so they don't touch Stages 1–4 at all. The only pipeline change is that "content box height" needs to account for them. Four sites need to agree, not one:

| Site | Current | With header/footer |
|---|---|---|
| `runPipeline` contentHeight | `pageHeight - margins.top - margins.bottom` | `... - headerHeight - footerHeight` |
| `paginateFlow` Y cursor init | `margins.top` | `margins.top + headerHeight` |
| `paginateFlow` page resets (4 sites) | `margins.top` | `margins.top + headerHeight` |
| `applyFloatLayout` `floatPageBottom` | `pageHeight - margins.bottom` | `... - footerHeight` |

The cleanest refactor is to stop scattering these derivations and put them on `PageConfig` as computed getters (or helper fns `contentTop(cfg)` / `contentBottom(cfg)`), then route everything through them. That's a prerequisite worth doing *before* adding `headerHeight` / `footerHeight` — otherwise you'll play whack-a-mole with Stage 3.

Alternatively, the hack-tier version: bake `headerHeight` / `footerHeight` into `margins.top` / `margins.bottom` at config construction time. Zero code changes inside the engine. Downside: you lose the distinction between "margin" (white space) and "header region" (paintable area) — header content renders *inside* `margins.top` rather than above it. For v1 that might be fine.

**Page number late binding** is the one gotcha. `{page}` and `{totalPages}` can't resolve until after `paginateFlow` finishes, so header/footer content needs a two-pass render:

```
1. Layout pass → resolve totalPages
2. Paint pass → substitute tokens per-page
```

### Columns

Columns change what `paginateFlow` considers a "page." Right now a page has one content region. With columns:

```ts
// Current mental model
Page → { contentBox: Rect }

// Multi-column
Page → { columns: Rect[] }
```

`paginateFlow` would need to fill column 0, overflow into column 1, etc. before advancing pages. The cleanest approach is abstracting the current page/y cursor into a **ContentRegion cursor**:

```ts
ContentRegion = { pageIndex, columnIndex, y, bottom }
```

Then "advance page" becomes "advance to next region" — which is either the next column or a new page if you're in the last column. Single-column is the degenerate case of one region per page.

Note that `paginateFlow` currently has *two* cursors entangled: the Y cursor (`y`, `prevSpaceAfter`) and the page cursor (`currentPage`, `pages`). Plus the split loop has its own `currentPartStartY`. A region refactor has to sweep all three plus the Phase 1b early-termination path (`PageLayout.ts:733`), which hard-codes `prevCurPage.blocks` scans by page index — that would need to become region index.

Also, "Stage 1 position-independence means columns don't affect measurement" is only true if all columns on a page are the same width. Stage 1 measures at a specific `contentWidth` (`FlowConfig`, `PageLayout.ts:246`). Different column widths → different line breaks → different measurements. The `WeakMap<Node, MeasureCacheEntry>` is keyed by node identity but carries a single `availableWidth` — a multi-column layout where a block could land in columns of different widths would thrash the cache. Not fatal (unequal-width columns are rare), but worth flagging.

### Tables

Tables are the hardest because they need their **own mini layout pipeline** before Stage 1 can treat them as a single block. A table's block height depends on column width negotiation, which depends on cell content measurement. So the order is:

```
Table measurement (inside buildBlockFlow, Stage 1):
  1. Column width pass   → negotiate widths (fixed / auto / flex)
  2. Cell measure pass   → measure each cell at its resolved width
  3. Row height pass     → max(cell heights) per row
  4. Return total height to Stage 1 as a single FlowBlock
```

The table is opaque to `paginateFlow` — it just sees a tall block. Row-level splitting (a table spanning pages) is a special case where you would emit multiple `FlowBlock`s with continuation flags, similar to how text splitting works today but at row granularity.

The phased plan for this lives in `docs/tables.md`.

### Suggested order

1. **Refactor `pageBottom` / `contentTop` into single-source-of-truth helpers on `PageConfig`.** Tiny change, removes the drift between `runPipeline`, `paginateFlow`, and `applyFloatLayout`. Worth doing for its own sake.
2. **Headers/footers** as additive fields consumed via those helpers. Page-number late binding is a rendering concern and stays out of the pipeline.
3. **Tables** (already planned). No pipeline surgery — tables are opaque to `paginateFlow`.
4. **Columns** last. Refactor Y cursor → region cursor, and at that point the Phase 1b shortcut needs region-aware keys in the `measureCache`.
