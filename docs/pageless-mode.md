# Tile-Based Rendering + Pageless Mode — Implementation Plan

## Overview

Replace `ViewManager` (one canvas per page) with a unified **`TileManager`**
that renders both paged and pageless modes via virtualized canvas tiles.

**Core insight**: the tile height is not fixed — it is mode-dependent:

```
tileHeight = isPageless ? 307 : pageHeight
```

| Mode | Strategy | Tile = |
|---|---|---|
| Pageless | Small fixed tiles, recycled pool | 307px slice of the document |
| Paged | Full-page tiles, virtualized | One complete page |

This gives the best of both worlds: pageless gets Google-Docs-style tile
virtualization; paged gets a dramatically simpler renderer where 1 tile = 1 page,
eliminating all gap math, page-offset translation, and partial-page clipping.

**Guiding principle**: The ProseMirror model layer, `BlockLayout`, `LineBreaker`,
`CharacterMap`, and the extension system remain **untouched**. Changes are
isolated to `PageLayout`, a new `TileManager` (replacing `ViewManager`),
`Editor` wiring, and the React adapter.

---

## Relation to the Layout Pipeline

The `TileManager` is the **view layer** counterpart to the layout pipeline described in [`layout-pipeline-architecture.md`](./layout-pipeline-architecture.md). The pipeline handles *what* to render; the tile manager handles *how* to hit the screen.

### How the stages map to tile painting

| Pipeline Stage | Tile Manager Role |
|---|---|
| Stage 2 — Inline Layout | Produces `LayoutLine[]` consumed by `drawBlock()` |
| Stage 3 — Block Flow | `FlowBlock.y` is the exact `visualY` in pageless mode — no translation needed |
| Stage 5 — Pagination | Tells the tile manager where page boundaries fall and where to draw page chrome |
| Stage 6 — Fragment Builder | Provides `LayoutFragment[]` sorted by `y` — the fast lookup index for tile painting |

### Fragment-based tile lookup

The two modes use different lookup strategies, each optimal for their tile shape:

**Paged mode** — `tileIndex === pageIndex`, so lookup is O(1):
```ts
const fragments = layout.fragmentsByPage[tile.tileIndex];
// Draw them all — the full page is always rendered.
```

**Pageless mode** — tiles are small slices, so lookup uses a binary search on the continuous Y space:
```ts
function fragmentsInTile(
  fragments: LayoutFragment[],
  tileTop: number,
  tileBottom: number
): LayoutFragment[] {
  let lo = 0, hi = fragments.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (fragments[mid].y + fragments[mid].height <= tileTop) lo = mid + 1;
    else hi = mid;
  }
  const result: LayoutFragment[] = [];
  for (let i = lo; i < fragments.length && fragments[i].y <= tileBottom; i++) {
    result.push(fragments[i]);
  }
  return result;
}
```

Both approaches use the same `LayoutFragment[]` from Stage 6. The `DocumentLayout` should expose both for convenience:
```ts
fragments:      LayoutFragment[]        // flat, sorted by y — for pageless
fragmentsByPage: LayoutFragment[][]     // grouped by pageNumber — for paged
```

### Dirty tile detection via fragment versions

`lastPaintedVersion` in each `TileEntry` is compared against `layout.version`. With the pipeline's `inputHash` diffing in Stage 3 (see pipeline doc), a keystroke in one paragraph only updates the fragments for that block and shifts the Y of subsequent fragments. The tile manager then repaints **only tiles whose visual Y range intersects the changed fragments' Y range** — not all tiles with a stale version:

```ts
// After layout update, compute the dirty visual Y range from changed fragments
const dirtyRange = computeDirtyFragmentRange(prevFragments, nextFragments);

// In update(): instead of `lastPaintedVersion !== layout.version`
if (tileDirtyForRange(tile, dirtyRange)) paintContent(tile, layout);
```

On a 50-page document, a single keystroke repaints 1–2 tiles instead of everything in the pool.

---

## Architecture

### Current: ViewManager (one canvas per page)

```
┌──────────────────┐        ┌──────────────────┐
│   Page 1 (A4)    │        │   Page 2 (A4)    │
│  ┌──────────────┐│  24px  │  ┌──────────────┐│
│  │content canvas││  gap   │  │content canvas ││
│  │overlay canvas ││        │  │overlay canvas ││
│  └──────────────┘│        │  └──────────────┘│
└──────────────────┘        └──────────────────┘
1 wrapper + 2 canvases per page
IntersectionObserver per page
```

### New: TileManager (mode-aware tile height)

```
PAGED MODE                              PAGELESS MODE
tileHeight = pageHeight (~1120px)       tileHeight = 307px

┌────────────────────────┐              ┌────────────────────────┐
│ tilesContainer         │              │ tilesContainer         │
│ h = pageCount * pageH  │              │ h = totalContentHeight │
│ (no gaps — gap is CSS) │              │                        │
│ ┌────────────────────┐ │              │ ┌────────────────────┐ │
│ │ tile 0 = page 1    │ │              │ │ tile 0  (307px)    │ │
│ │  full page canvas  │ │              │ ├────────────────────┤ │
│ │  white bg + chrome │ │              │ │ tile 1  (307px)    │ │
│ ├────────────────────┤ │              │ ├────────────────────┤ │
│ │ tile 1 = page 2    │ │              │ │ tile 2  (307px)    │ │
│ │  full page canvas  │ │              │ │  no gap, no chrome │ │
│ ├────────────────────┤ │              │ ├────────────────────┤ │
│ │ ...virtualized...  │ │              │ │ ...pool recycled...│ │
│ └────────────────────┘ │              │ └────────────────────┘ │
└────────────────────────┘              └────────────────────────┘

tileIndex = pageIndex                   tileIndex = floor(scrollY / 307)
No gap math. No partial-page clip.      Standard small-tile virtualization.
fragmentsByPage[tileIndex] lookup.      fragmentsInRange() binary search.
```

### What differs between modes

| Concern | Paged | Pageless |
|---|---|---|
| `layoutDocument` output | Multiple `LayoutPage` objects | Single `LayoutPage` |
| Tile height | `pageHeight` (~1120px on A4) | 307px |
| Container height | `pageCount × pageHeight` | `totalContentHeight` |
| Tile index meaning | `tileIndex === pageIndex` | `tileIndex === floor(scrollY / 307)` |
| Y → document-Y mapping | None — `tileIndex` IS the page | `FlowBlock.y` is exact `visualY` |
| Page gap | CSS margin between tile wrappers, not canvas math | N/A |
| Page chrome | Draw white rect + shadow inside full-page canvas | None |
| Margin guides | Per-page | Single top margin only |
| Fragment lookup | `fragmentsByPage[tileIndex]` — O(1) | `fragmentsInRange(tileTop, tileBottom)` — O(log N) |
| Hit-testing | `tileIndex → page`, Y is page-local directly | Direct (all page 1) |
| Tile recycling | Pool of visible pages (typically 3–5) | Pool of 8 small tiles |
| Canvas size on 2× DPR | 1120 × 2 = 2240px — well within browser limits | 307 × 2 = 614px |

---

## Phase 1: Layout Engine

### Step 1 — Extend `PageConfig` with `pageless`

**File**: `packages/core/src/layout/PageLayout.ts`

- Add `pageless?: boolean` to the `PageConfig` interface.
- Export a `defaultPagelessConfig`:
  ```ts
  export const defaultPagelessConfig: PageConfig = {
    pageWidth: 885,
    pageHeight: 0,   // unused in pageless mode
    margins: { top: 40, right: 73, bottom: 40, left: 73 },
    pageless: true,
  };
  ```
- **Why**: Single flag that the rest of the system checks. Keeping it on
  `PageConfig` avoids new interfaces.

### Step 2 — Add `totalContentHeight` to `DocumentLayout`

**File**: `packages/core/src/layout/PageLayout.ts`

- Add `totalContentHeight: number` to the `DocumentLayout` interface.
- Paged mode: `pages.length * pageConfig.pageHeight`.
- Pageless mode: final `y` position after the last block + bottom margin.
- **Why**: The tile manager needs this for container sizing in both modes.

### Step 3 — Skip page breaks when `pageless` is true

**File**: `packages/core/src/layout/PageLayout.ts` — `layoutDocument()`

- When `pageConfig.pageless`:
  - Skip the overflow check (`blockBottom > pageBottom`).
  - All blocks land on a single `LayoutPage` with `pageNumber: 1`.
  - `y` grows unbounded.
  - After the loop: `totalContentHeight = y + margins.bottom`.
- When `!pageConfig.pageless`: existing behavior unchanged.
- **Why**: Minimal diff. CharacterMap and BlockLayout work automatically.

### Step 4 — Update `Editor` to expose the flag

**File**: `packages/core/src/Editor.ts`

- Add `get isPageless(): boolean` (reads `this.pageConfig.pageless`).
- No layout logic changes — `Editor` already passes `pageConfig` to
  `layoutDocument`.

---

## Phase 2: Tile Manager (unified renderer)

### Step 5 — Create `TileManager`

**File**: `packages/core/src/renderer/TileManager.ts` (new)

Replaces `ViewManager` as the single rendering engine for both paged and
pageless modes.

#### 5a. Constants, options, and types

```ts
const DEFAULT_SMALL_TILE_HEIGHT = 307;  // pageless: fixed slice height (matches Google Docs)
const DEFAULT_POOL_SIZE_PAGELESS = 8;   // pageless: max tiles alive at once
const DEFAULT_POOL_SIZE_PAGED = 5;      // paged: visible pages + 2 overscan
const DEFAULT_OVERSCAN = 1;             // extra tiles above/below viewport

export interface TileManagerOptions {
  smallTileHeight?: number;   // pageless tile height (default 307)
  poolSize?: number;          // override pool size
  overscan?: number;
  gap?: number;               // CSS gap between page wrappers in paged mode (default 24)
  showMarginGuides?: boolean;
}

interface TileEntry {
  wrapper: HTMLDivElement;
  contentCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;
  dpr: number;
  tileIndex: number;            // pageless: slice index; paged: pageIndex (0-based)
  lastPaintedVersion: number;
  assigned: boolean;
  // Overlay blink guard
  lastBlinkState: boolean;      // last rendered blink-on value
  lastCursorTile: number;       // tileIndex that last held the cursor (-1 if none)
  lastSelectionVersion: number; // version of selection when last painted
}
```

The `tileHeight` is computed from the viewport and recomputed on every resize:
```ts
get tileHeight(): number {
  if (!this.editor.isPageless) return this.editor.pageConfig.pageHeight;
  if (this.options.smallTileHeight) return this.options.smallTileHeight;
  // Viewport-aware: scale with screen size, clamped to a safe range.
  // Small screens: fewer tiles → less redraw jump.
  // Large screens: bigger tiles → fewer tiles in pool, fewer repaints.
  const vh = this.scrollParent.clientHeight;
  return Math.max(240, Math.min(Math.round(vh * 0.35), 480));
}
```

Why viewport-aware instead of fixed 307:

| Screen | `vh * 0.35` | Clamped result |
|---|---|---|
| 768px laptop | 268px | 268px |
| 1080px desktop | 378px | 378px |
| 1440px large monitor | 504px | 480px (capped) |
| 500px mobile | 175px | 240px (floored) |

On resize, `tileHeight` must be recomputed and the tile pool rebuilt — all
assigned tiles reset to `lastPaintedVersion = -1` to force a full repaint.

#### 5b. DOM structure

```
outerContainer (editor.mount target)
└── tilesContainer (position: relative; height: computed)
    ├── tile div 0 (position: absolute; top: 0; height: TILE_HEIGHT)
    │   ├── content canvas
    │   └── overlay canvas
    ├── tile div 1 (position: absolute; top: 307px; ...)
    │   ...
    └── tile div N (from pool)
```

The `tilesContainer` height drives the native scrollbar:
- Paged: `Σ(pageHeight) + (pageCount - 1) × gap`
- Pageless: `layout.totalContentHeight`

#### 5c. Y-coordinate mapping

The core difference between modes lives in two mapping functions:

```ts
/** Convert a tile's visual Y to the document-space Y used by layout/charMap. */
visualYToDocY(visualY: number): { page: number; docY: number }

/** Convert a document-space (page, docY) to the visual Y in the scroll container. */
docYToVisualY(page: number, docY: number): number
```

**Pageless mode**: identity mapping. `visualY === docY`, page is always 1.
Stage 3's `FlowBlock.y` is the exact `visualY` — no translation needed.

**Paged mode**: dramatically simpler than unified-tile paged mode.
Because `tileHeight = pageHeight`, tile boundaries align exactly with page
boundaries. There are no partial pages, no tiles spanning a gap. The gap is
a CSS `margin-bottom` on each tile wrapper — it does not exist in canvas space.

```ts
// Paged: tileIndex IS pageIndex
visualYToDocY(visualY: number) {
  const tileIndex = Math.floor(visualY / this.tileHeight);
  const docY      = visualY - tileIndex * this.tileHeight;
  return { page: tileIndex + 1, docY };
}

docYToVisualY(page: number, docY: number) {
  return (page - 1) * this.tileHeight + docY;
}
```

The gap is rendered by CSS (`gap` px margin below each `.tile-wrapper`), not
inside the canvas. This removes the tile-spans-gap problem entirely.

These two functions are the **only** branching point between paged and pageless
rendering in the tile manager.

#### 5d. Core algorithm — `update()`

```
1. Read scrollTop and viewportHeight from the scroll parent.
2. Update tilesContainer.style.height if layout changed.
3. Compute visible tile range:
     firstVisible = floor(scrollTop / TILE_HEIGHT) - overscan
     lastVisible  = ceil((scrollTop + viewportHeight) / TILE_HEIGHT) + overscan
     Clamp to [0, totalTiles).
4. For each tile in the pool:
     - If tileIndex is outside [firstVisible, lastVisible], mark unassigned.
5. For each index in [firstVisible, lastVisible]:
     - If already assigned to a tile entry, keep it.
     - Otherwise grab an unassigned entry from the pool.
     - Set wrapper.style.top = `${index * TILE_HEIGHT}px`.
     - Set tileEntry.tileIndex = index.
     - Mark assigned, reset lastPaintedVersion = -1 (force repaint).
6. For each assigned tile:
     - If tile's visual Y range intersects the dirty fragment range → paintContent().
     - Always paintOverlay() (cursor blink changes every tick).
```

The "dirty fragment range" is derived from Stage 3's `inputHash` diffing — only
fragments whose source block changed (by hash) are dirty, so only the tiles
overlapping those fragments' visual Y range need repainting.

#### 5e. `paintContent(tile, layout)` — paged mode

Because `tileIndex === pageIndex`, this is simple full-page rendering:

```
1. page = tile.tileIndex + 1
2. fragments = layout.fragmentsByPage[tile.tileIndex]  // O(1) lookup, no search
3. Set up canvas (pageHeight × pageWidth at device DPR).
4. Clear canvas.
5. Draw page background (white rect, full canvas).
6. Draw box-shadow / page chrome at canvas edges if enabled.
7. Draw margin guides if enabled.
8. For each fragment in fragments:
     drawBlock(fragment.block, ctx, fragment.lineStart, fragment.lineCount)
```

No page offset translation. No gap drawing. No partial-page clipping.
The gap between pages is a CSS `margin-bottom` on the tile wrapper — not
a canvas concern at all.

#### 5f. `paintContent(tile, layout)` — pageless mode

Small-tile virtualization — no page chrome, no gaps:

```
1. tileTop    = tile.tileIndex * TILE_HEIGHT  (307px)
2. tileBottom = tileTop + TILE_HEIGHT
3. fragments  = fragmentsInTile(layout.fragments, tileTop, tileBottom)  // binary search
4. Set up canvas, clear.
5. ctx.save(); ctx.translate(0, -tileTop);
6. For each fragment: drawBlock(fragment.block, ctx, fragment.lineStart, fragment.lineCount)
7. ctx.restore();
```

Both modes call the same `drawBlock()` — extracted from `PageRenderer`.

#### 5g. `paintOverlay(tile)`

Same for both modes, but **gated** — do not repaint on every animation frame:

```ts
function paintOverlay(tile: TileEntry): void {
  const cursorTile  = tileIndexForVisualY(cursorVisualY);
  const needsCursor = tile.tileIndex === cursorTile;
  const blinkDirty  = needsCursor && tile.lastBlinkState !== currentBlinkOn;
  const moveDirty   = tile.lastCursorTile !== cursorTile || tile.lastSelectionVersion !== selectionVersion;

  if (!blinkDirty && !moveDirty) return;  // nothing changed — skip entirely

  tile.lastBlinkState       = currentBlinkOn;
  tile.lastCursorTile       = cursorTile;
  tile.lastSelectionVersion = selectionVersion;

  // Clear and redraw
  overlayCtx.clearRect(0, 0, canvas.width, canvas.height);
  overlayCtx.save();
  overlayCtx.translate(0, -tileVisualTop);
  // filter glyphs to tile visual range, then:
  renderSelection(overlayCtx, selectionGlyphs);
  if (needsCursor && currentBlinkOn) renderCursor(overlayCtx, cursorCoords);
  overlayCtx.restore();
}
```

**Why this matters:** without the guard, every blink tick (typically 530ms interval
implemented via `requestAnimationFrame` counting) repaints all visible overlay
canvases — O(poolSize) clears + redraws per blink. On a large monitor with 6
visible tiles that is 6× unnecessary work every half-second. With the guard:

| Event | Tiles repainted |
|---|---|
| Cursor blink toggle | 1 (the tile containing the cursor) |
| Cursor moves to new tile | 2 (old tile clears, new tile draws) |
| Selection changes | Only tiles overlapping the selection range |
| Scrolling (no state change) | 0 |

#### 5h. Mouse events and hit-testing

The `hitTest(clientX, clientY)` function is the critical bridge between visual
coordinates (where the user clicked) and document positions (what `charMap` needs).
It must correctly handle paged gaps, tile offsets, and DPR scaling.

```ts
function hitTest(clientX: number, clientY: number): { page: number; docX: number; docY: number } | null {
  // 1. Find the tile the click landed in
  const containerRect = tilesContainer.getBoundingClientRect();
  const visualX = (clientX - containerRect.left) / dpr;
  const visualY = (clientY - containerRect.top)  / dpr + scrollParent.scrollTop;

  // 2. Check if visualY falls in a page gap (paged mode only)
  //    If so, snap to the nearest page edge.
  if (!isPageless) {
    const slotHeight = pageHeight + gap;
    const posInSlot  = visualY % slotHeight;
    if (posInSlot >= pageHeight) {
      // Click is inside a gap — map to end of the preceding page
      return { page: Math.floor(visualY / slotHeight) + 1, docX: visualX, docY: pageHeight };
    }
  }

  // 3. Translate visual → doc coordinates
  const { page, docY } = visualYToDocY(visualY);

  // 4. Adjust X for page margins (center-aligned page in paged mode)
  const pageLeft = isPageless ? 0 : (containerWidth - pageWidth) / 2;
  const docX = visualX - pageLeft;

  return { page, docX, docY };
}
```

Caller in `mousedown`:
```ts
const hit = hitTest(e.clientX, e.clientY);
if (hit) {
  const pos = charMap.posAtCoords(hit.docX, hit.docY, hit.page);
  editor.setSelection(pos);
}
```

- `mousemove` / `mouseup`: same `hitTest()` pattern.
- Shift+click: `charMap.posAtCoords()` + `setSelection(anchor, pos)`.
- Click+drag: `mousedown` sets anchor; `mousemove` extends selection.

#### 5i. Scroll handling

- Listen to `scroll` on the nearest scrollable ancestor.
- Throttle with `requestAnimationFrame`.
- On scroll → `update()`.
- On resize (via ResizeObserver on scroll parent) → `update()`.

#### 5j. Editor integration

- Subscribe via `editor.subscribe()` → `update()`.
- Register `editor.setPageElementLookup()`:
  - Pageless: always returns `tilesContainer` for page 1.
  - Paged: returns a virtual rect computed from `docYToVisualY(page, 0)`.
- **Why**: `syncInputBridge` and `scrollCursorIntoView` need a way to resolve
  page → DOM position.

#### 5k. `destroy()`

- Unsubscribe from editor.
- Remove scroll and resize listeners.
- Disconnect observer.
- Remove DOM.
- Clear `editor.setPageElementLookup(null)`.

---

## Phase 3: Extract shared rendering utilities

### Step 6 — Export `drawBlock` from PageRenderer

**File**: `packages/core/src/renderer/PageRenderer.ts`

- The existing `drawBlock()` function is currently module-private.
- Export it so `TileManager` can call it directly.
- Update the signature to accept `lineStart` / `lineCount` so it renders only
  the fragment slice: `drawBlock(block, ctx, lineStart, lineCount)`.
- Keep `renderPage()` as-is for backward compatibility during migration.
  It can be deprecated later once `TileManager` fully replaces `ViewManager`.
- **Why**: Avoid duplicating text rendering, mark decoration, and CharacterMap
  population logic.

### Step 7 — OverlayRenderer stays unchanged

**File**: `packages/core/src/renderer/OverlayRenderer.ts`

- `renderCursor()` and `renderSelection()` accept absolute coords.
- The caller (`TileManager`) applies `ctx.translate()` before calling them.
- No changes needed.

---

## Phase 4: Wire up in Editor + React Adapter

### Step 8 — Deprecate `ViewManager`, use `TileManager` everywhere

**File**: `packages/core/src/renderer/ViewManager.ts`

- Mark `ViewManager` as `@deprecated` — keep it functional for now.
- All new rendering goes through `TileManager`.
- **Migration path**: `ViewManager` can be removed in a future version once
  `TileManager` is proven stable.

### Step 9 — Update `Canvas` component

**File**: `packages/react/src/Canvas.tsx`

```ts
useEffect(() => {
  if (!editor || !containerRef.current) return;
  editor.mount(containerRef.current);

  const manager = new TileManager(editor, containerRef.current, {
    tileHeight,
    gap,
    overscan,
    showMarginGuides,
  });

  return () => {
    manager.destroy();
    editor.unmount();
  };
}, [editor, gap, overscan, tileHeight, showMarginGuides]);
```

- Always uses `TileManager` — no branching needed.
- The `TileManager` internally checks `editor.isPageless` for the Y-mapping
  and page chrome decisions.
- Add optional `tileHeight?: number` prop to `CanvasProps` (default 307).

### Step 10 — Export new types

**Files**: `packages/core/src/renderer/index.ts`, `packages/core/src/index.ts`,
`packages/react/src/index.ts`

- Export `TileManager`, `TileManagerOptions`, `defaultPagelessConfig`.

---

## Phase 5: `syncInputBridge` + Scroll-to-Cursor

### Step 11 — Adapt `syncInputBridge()`

**File**: `packages/core/src/Editor.ts`

- Current logic: finds page element, positions textarea relative to page rect.
- With TileManager: `pageElementLookup` returns the `tilesContainer`.
  Position the textarea at `docYToVisualY(coords.page, coords.y)` relative
  to the container.
- The TileManager sets the lookup function, so `Editor` doesn't need to
  know which mode it's in — the lookup abstracts it.

### Step 12 — Adapt `scrollCursorIntoView()`

**File**: `packages/core/src/Editor.ts`

- Same approach: use `pageElementLookup` to get visual coordinates.
- Scroll the parent so the cursor's visual Y is in the viewport.
- Works for both modes via the same abstraction.

---

## Phase 6: CharacterMap — No Changes Needed

The `CharacterMap` works without modification in both modes.

**Pageless mode = one virtual page (page 1)**

Treating the entire pageless document as a single page is not a simplification —
it is the correct model. All glyphs have `page: 1`. `CharacterMap.posAtCoords(x, y, 1)`
works without changes. `posAbove()` / `posBelow()` work across the whole document.

This also makes the future transition to the pipeline trivially correct: in
pageless mode, Stage 3's `FlowBlock.y` is the exact `visualY`, and Stage 5
(Pagination) is a no-op that produces a single `LayoutPage`. The CharacterMap
never needs to know which mode is active.

**Paged mode** — same as today. Glyphs have `page: 1, 2, ...` and page-local Y.
The tile manager converts visual coordinates to page-local before calling
`posAtCoords`, exactly as the current `ViewManager` does.

The one known performance issue — `CharacterMap` linear scans are O(N glyphs) —
is addressed by the `LayoutFragment[]` binary search in the tile painter (see
Section "Relation to the Layout Pipeline"). The charMap linear scan concern is
separate and can be addressed with a glyph B-tree index if needed in the future.

---

## Phase 7: Demo + Testing

### Step 13 — Add pageless toggle to demo app

**File**: `apps/demo/src/App.tsx`

- Toggle button in header: "Pages / Pageless".
- Swap `pageConfig` between `defaultPageConfig` and `defaultPagelessConfig`.
- Re-create editor when toggled (pass `[mode]` as dep to `useCanvasEditor`).

### Step 14 — Unit tests

- `PageLayout.test.ts`:
  - `pageless: true` → all blocks on one page.
  - `totalContentHeight` correct in both modes.
  - No page breaks in pageless even with large docs.
- `TileManager` tests:
  - Tile recycling: pool size never exceeded.
  - `visualYToDocY` / `docYToVisualY` roundtrip correctly in both modes.
  - Paged mode: gap regions map to no content.
  - Mouse hit-testing resolves correct doc positions (paged, pageless, gap edge cases).
  - Scroll → tiles reassigned and repainted.
  - Fragment binary search: correct results at tile boundaries.
  - Dirty tile detection: only tiles intersecting changed fragment Y range repaint.

---

## File Change Summary

| File | Change |
|---|---|
| `packages/core/src/layout/PageLayout.ts` | Add `pageless` to `PageConfig`, `totalContentHeight` to `DocumentLayout`, pageless branch in `layoutDocument` |
| `packages/core/src/Editor.ts` | Add `isPageless` getter. Adapt `syncInputBridge` + `scrollCursorIntoView` |
| `packages/core/src/renderer/TileManager.ts` | **New file** — unified tile-based renderer for both modes |
| `packages/core/src/renderer/PageRenderer.ts` | Export `drawBlock` with `lineStart`/`lineCount` params |
| `packages/core/src/renderer/ViewManager.ts` | Mark `@deprecated` |
| `packages/core/src/renderer/index.ts` | Export `TileManager`, `TileManagerOptions` |
| `packages/core/src/index.ts` | Export `defaultPagelessConfig`, `TileManager` |
| `packages/react/src/Canvas.tsx` | Use `TileManager` always (replaces `ViewManager`), add `tileHeight` prop |
| `packages/react/src/index.ts` | Re-export new types |
| `apps/demo/src/App.tsx` | Add pageless/paged toggle |
| Test files | New test cases |

---

## Implementation Order

```
Phase 1 (Steps 1-4)  → Layout engine changes                ~1 day
Phase 2 (Step 5)     → TileManager (biggest piece)           ~3-4 days
Phase 3 (Steps 6-7)  → Extract drawBlock, verify overlay     ~2 hours
Phase 4 (Steps 8-10) → Wire up, exports, deprecate VM        ~2 hours
Phase 5 (Steps 11-12)→ Input bridge + scroll-to-cursor       ~3 hours
Phase 6              → (none — CharacterMap unchanged)
Phase 7 (Steps 13-14)→ Demo toggle + tests                   ~1 day
```

**Total estimate**: ~5-6 days of focused work.

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Canvas max size (browsers cap at ~16384px) | Pageless tiles are 307px — never hits the limit. Paged tiles are pageHeight (~1120px, 2240px at 2× DPR) — well within limits for all standard page sizes |
| Text spanning tile boundaries looks clipped | Pageless: `ctx.translate(-tileTop)` + natural canvas clipping. Paged: no boundary crossing possible — tile = full page |
| Page gap regions in tiles (paged mode) | Eliminated — gap is CSS margin, never inside a canvas |
| Scroll performance on very long docs | Fixed tile pool + RAF throttle. Paged pool is even smaller (3–5 tiles vs 8) |
| Hit-testing in gap region | `hitTest()` detects CSS gap area (click Y falls outside any tile's canvas rect) and snaps to nearest page edge |
| `CharacterMap` linear scans slow for huge docs | Paged: `fragmentsByPage[]` O(1) lookup entirely avoids the scan. Pageless: O(log N) binary search. |
| Cursor blink causes full repaint | Only overlay canvases repaint on blink (content is dirty-range gated) |
| `ViewManager` removal is breaking | Deprecate first, remove in next major version. TileManager has same public API shape |
| Dirty tile detection (paged) | A keystroke on page 5 only marks `fragmentsByPage[4]` dirty → only tile 4 repaints |

---

## Migration Path: ViewManager → TileManager

1. **Phase A** (this plan): Ship `TileManager` alongside `ViewManager`.
   `Canvas.tsx` uses `TileManager`. `ViewManager` marked `@deprecated`.
2. **Phase B** (follow-up): Remove `ViewManager` once `TileManager` is
   battle-tested. Clean up any code that referenced `ViewManager` directly.
3. **Phase C** (optional): Remove page-specific logic from React adapter
   files (`PageView.tsx`, `useVirtualPages.ts`) that are no longer needed.

---

## Open Questions

1. **Tile height**: 307px (Google's default) vs. a different value? Making it
   configurable via `TileManagerOptions` covers all cases.
2. **Page chrome in paged mode**: Should the tile manager draw full page
   shadows (currently CSS `box-shadow` on the wrapper div) via canvas, or
   use a background div behind tiles? Canvas-drawn shadows are more
   consistent but slightly more rendering work.
3. **Page-break nodes in pageless mode**: Render as a visual divider (HR)
   or ignore entirely?
4. **Print**: When printing from pageless mode, re-layout in paged mode for
   the print stylesheet?
5. **Horizontal resize**: Should pageless mode auto-resize `pageWidth` to
   match the container width (fluid layout)?
6. **Fragment availability at TileManager time**: The `LayoutFragment[]` array
   from Stage 6 of the pipeline is not yet produced by the current
   `layoutDocument()`. Until the pipeline refactor lands, the tile manager
   falls back to an O(N) block scan for painting. The `fragmentsInTile()`
   binary search becomes the fast path once Stage 6 ships.
