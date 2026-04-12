# Page Orientation

Status: **design** — layout pipeline is already orientation-ready; implementation of the renderer/exporter changes is deferred until a concrete consumer arrives.

This document is the architecture reference for supporting per-page dimensions (portrait vs landscape, mixed within a single document) in Scrivr. It walks through the core framing, the current state of the codebase, the three-tier support progression, the interactions with other features, and what Word / Google Docs / Pages do for comparison.

---

## 1. The core framing

> **Page orientation is not a flag. It's per-page dimensions.**

Portrait and landscape are shorthand for a width/height ratio:

- Portrait: `pageHeight > pageWidth`
- Landscape: `pageHeight < pageWidth`

There is nothing else to it. Any "orientation" API is just a convenience wrapper around swapping two numbers. The real architectural question is not "should we support orientation" — it's "can pages in the same document have different dimensions?"

Once you frame it that way, everything else falls out:

- "Orientation" is just a named view of the `(width, height)` tuple
- A landscape insert in a portrait document is just "page N has `width: 1123, height: 794` and pages 1..N-1, N+1..end have `width: 794, height: 1123`"
- "Rotating" a page means swapping its width and height — nothing else changes
- Word-style section breaks with per-section page setup are just a UI for "switch the per-page dimensions starting at page K"

This framing matters because it determines where the feature lives in the architecture. An "orientation flag" would live on `PageConfig` and be a global toggle. **Per-page dimensions** live on `PageMetrics` and are naturally variable across a document.

---

## 2. Current state — what already works

Scrivr's layout pipeline was refactored to read per-page `PageMetrics` for every vertical-position decision. As a consequence of that refactor, the pipeline is **already orientation-ready** for mixed-dimension documents — the plumbing runs through per-page metrics, not a global constant. Specifically:

- **`runPipeline`** builds a `PageMetrics[]` array, one entry per page, and stores it on `DocumentLayout.metrics`
- **`paginateFlow`** reads every `contentTop` / `contentBottom` / `contentHeight` through a `metricsFor(pageNumber)` lookup. Ten internal call sites that used to read raw `margins.top` or `pageHeight - margins.bottom` now route through the per-page metrics bundle.
- **`applyFloatLayout`** uses a `metricsForPage(pageNumber)` helper for nine float-placement and overflow-cascade sites across Pass 2, Pass 3, and Pass 3b
- **`MeasureCacheEntry`** already has a `placedContentTop` field that the Phase 1b early-termination guard checks. Any per-page contentTop drift between runs invalidates the cache entry automatically.
- **`PageMetrics`** already carries `contentWidth` as a per-page field. It happens to be derived from a global `pageConfig.pageWidth - margins.left - margins.right` today, so it's uniform across pages — but the *shape* supports variation.

**Verified on 2026-04-11**: `grep -rn "pageConfig\.pageWidth\|pageConfig\.pageHeight" packages/core/src/layout/PageLayout.ts` returns zero production matches (only comments). The layout hot loop is clean.

What this means in practice: **if `PageMetrics` grew `pageWidth` / `pageHeight` / `margins` fields (instead of deriving them from a global config), the layout pipeline would handle mixed-orientation documents correctly with no further refactoring**. The hard part is already done.

What's *not* yet ready:

- `PageMetrics` doesn't store its own `pageWidth` / `pageHeight` / `margins` — those still come from the global `pageConfig`
- No `PageDimensionsResolver` exists to supply per-page overrides
- The renderer (`TileManager`, `ViewManager`) and PDF exporter still read raw `pageConfig.pageWidth` / `pageHeight` in 20 total sites
- The Phase 1b cache guard doesn't check `placedContentWidth` (only `placedContentTop`), so cross-run width changes could leave a stale shortcut window

---

## 3. Three tiers of support

### Tier 1 — document-wide orientation (works today)

The caller passes a `PageConfig` with landscape dimensions. Everything in the document uses those dimensions.

```ts
const landscapeConfig: PageConfig = {
  pageWidth: 1123,  // swapped from default 794
  pageHeight: 794,  // swapped from default 1123
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
};

new Editor({ pageConfig: landscapeConfig, extensions: [StarterKit] });
```

**No code changes required.** `PageConfig.pageWidth` and `pageHeight` are already arbitrary numbers — "landscape" is just different numbers. Tier 1 is not really a feature; it's a documentation point for consumers who didn't realize they could do this.

### Tier 2 — per-page `PageDimensionsResolver`

A caller-supplied function that returns per-page dimension overrides. Pages without an override fall back to the `PageConfig` defaults.

```ts
interface PageDimensions {
  pageWidth: number;
  pageHeight: number;
  margins: Margins;
}

type PageDimensionsResolver = (pageNumber: number) => Partial<PageDimensions> | undefined;

interface PageLayoutOptions {
  pageConfig: PageConfig;
  pageDimensionsResolver?: PageDimensionsResolver;
  // ... existing fields
}
```

Example — a report where page 3 is landscape for a wide table:

```ts
const resolver: PageDimensionsResolver = (pageNumber) => {
  if (pageNumber === 3) {
    return { pageWidth: 1123, pageHeight: 794 };
  }
  return undefined; // fall through to defaults
};
```

Internally, `computePageMetrics` consults the resolver before falling back to the pageConfig defaults:

```ts
function computePageMetrics(config, resolved, pageNumber, resolver): PageMetrics {
  const override = resolver?.(pageNumber);
  const pageWidth = override?.pageWidth ?? config.pageWidth;
  const pageHeight = override?.pageHeight ?? config.pageHeight;
  const margins = override?.margins ?? config.margins;

  // ... rest of computation uses pageWidth / pageHeight / margins
  // as already-resolved locals
}
```

This is the minimal-viable mixed-orientation answer. It unlocks:

- Landscape insert in a portrait document
- Different margins per page (e.g. a title page with no margins)
- Eventually, per-page content widths for column layouts

**It does not unlock**:

- A UI for users to change orientation (that needs sections or a UI layer on top of the resolver)
- Per-section orientation (sections are a separate feature)
- Orientation that varies based on the document content (would require a pre-pass)

### Tier 3 — section-based orientation (Word parity)

Proper Word-style section breaks with section-level page setup. Orientation is one of several section-scoped properties (also: page margins, headers, column count, numbering restart, first-page-different).

Requires a `Section` concept in the ProseMirror schema (or as a doc attr side table), section-break commands, section-aware headers/footers, and section-aware numbering. This is a substantial feature that should not be blocked on orientation — if we build sections, orientation comes along for the ride, but we should not build sections *for* orientation.

Ship Tier 2 first. Add Tier 3 when sections are wanted for their own reasons (multi-column layouts, section-scoped headers, restart-numbered footnotes).

---

## 4. What changes in the architecture per tier

### Tier 1 (today — no changes)

Nothing. Document-wide orientation already works via `PageConfig` with non-square dimensions.

### Tier 2 (additive refactor, concentrated in four areas)

**Area 1 — `PageMetrics` gains dimension fields**:

```ts
interface PageMetrics {
  pageNumber: number;
  // NEW:
  pageWidth: number;
  pageHeight: number;
  margins: Margins;
  // existing fields below, now derived from the above:
  contentTop: number;
  contentBottom: number;
  contentHeight: number;
  contentWidth: number;
  headerTop: number;
  footerTop: number;
  headerHeight: number;
  footerHeight: number;
}
```

Add three fields, keep the existing derived fields. The interface is strictly larger, no breaking changes to existing consumers.

**Area 2 — `computePageMetrics` consults a resolver**:

```ts
export function computePageMetrics(
  config: PageConfig,
  resolved: ResolvedChrome,
  pageNumber: number,
  resolver?: PageDimensionsResolver,
): PageMetrics {
  const override = resolver?.(pageNumber);
  const pageWidth = override?.pageWidth ?? config.pageWidth;
  const pageHeight = override?.pageHeight ?? config.pageHeight;
  const margins = override?.margins ?? config.margins;
  // ... compute contentTop, contentBottom, etc. from these locals
  return { pageNumber, pageWidth, pageHeight, margins, ...derived };
}
```

When no resolver is passed, behavior is identical to today — the PageConfig defaults are used for every page.

**Area 3 — Phase 1b cache gains a width guard**:

```ts
interface MeasureCacheEntry {
  // ... existing
  placedRunId?: number;
  placedContentTop?: number;
  placedContentWidth?: number;  // NEW
}
```

The early-termination guard checks `placedContentWidth === metricsFor(currentPage.pageNumber).contentWidth` alongside the existing `placedContentTop` check. Without this, a block placed on a portrait page in run K could incorrectly reuse its placement on a landscape page in run K+1 if that specific page's orientation changed. Catches in the same `if` block as the two existing guards — ~5 lines of code.

**Area 4 — Renderer and exporter read per-page dimensions**:

The 20 call sites that still read `pageConfig.pageWidth` / `pageConfig.pageHeight` directly:

| File | Sites | What needs to change |
|---|---|---|
| `packages/core/src/renderer/TileManager.ts` | 10 | Tile canvas sizing, DOM width/height, tile overlay canvas dimensions |
| `packages/core/src/renderer/ViewManager.ts` | 8 | Per-page div styling, overlay canvas sizing, clear calls |
| `packages/export/src/pdf/index.ts` | 2 | `pageWidthPt = pageConfig.pageWidth * PT_PER_PX` sizing for `pdfDoc.addPage()` |

For each, replace the direct pageConfig read with a per-page lookup via `layout.metrics[pageIndex].pageWidth` or similar helper. The refactor is mechanical — every site is already indexed by page number; it just needs to look up the dimensions per page instead of reading the global constant.

**Scroll total height**:

`TileManager` currently computes scroll container height as `pages.length * pageConfig.pageHeight`. With mixed orientation this becomes `pages.reduce((sum, p, i) => sum + layout.metrics[i].pageHeight + pageGap, 0)`. One-line change.

**Tile y-coordinates**:

Tile positioning inside the scroll container currently uses `(pageNumber - 1) * (pageHeight + gap)`. With mixed orientation, each page's y offset is the sum of previous pages' heights + gaps. A small running-sum computation.

### Tier 3 (sections feature)

Out of scope for this document. The short version: sections become first-class in the schema (or via `doc.attrs` side tables), section boundaries produce orientation changes automatically via the Tier 2 resolver, section-break commands are added, and the UI gains a "page setup" dialog scoped to the current section. See the eventual sections design doc (does not yet exist).

---

## 5. Interactions with other features

### 5.1 Headers and footers

Chrome contributors read per-page `PageMetrics` when computing their reservations. A header on a landscape page automatically uses the landscape page's content width when measuring its own content. **No changes needed** to the chrome contribution API once Tier 2 lands — the plumbing is already per-page.

One subtle point: a header that uses `pageNumber` / `totalPages` inline leaf nodes for field values doesn't care about orientation. A header that uses `contentWidth` to position right-aligned text (e.g. page numbers aligned to the right edge of the content area) *does* care — it gets the correct width automatically because it reads from per-page metrics.

### 5.2 Footnotes

The iterative footnote loop reads `bandCapacityFor(page) = metricsForPage(page).contentHeight - body floor` to decide how many footnote lines fit in each page's band. A landscape page has a smaller `contentHeight` (since it's shorter) but a wider `contentWidth`, so footnote bodies measure differently:

- Landscape: fewer lines per footnote (wider wrap), but less band height available
- Portrait: more lines per footnote (narrower wrap), but more band height available

The iteration converges identically in both cases because the `LayoutIterationContext` is page-aware. **No changes needed** to the footnote iteration loop.

A footnote anchored on a portrait page can spill forward to a landscape page and the band-fill logic respects the landscape page's different capacity. Similarly, sticky spill continues to work because it tracks by note id, not by page geometry.

### 5.3 Floats

`applyFloatLayout` already routes every clamp bound through `metricsForPage(pageNumber)`. A float on a landscape page clamps against the landscape contentBottom and contentRight automatically. **No changes needed.**

One edge case worth noting: a float anchored on page N that overflows to page N+1 currently uses `metricsForPage(floatPage).contentTop` for the reset. If N is portrait and N+1 is landscape, the reset Y is correct for the landscape page. Already handled.

### 5.4 Tables

Tables can take advantage of mixed orientation when a wide table doesn't fit portrait content width — insert a section break + landscape orientation before the table, insert another + portrait after. This is the canonical use case for mixed-orientation documents in Word. No architecture changes specific to tables; they consume the same `metricsForPage` signal as everything else.

### 5.5 Columns

Multi-column layouts and mixed orientation interact in two ways:

1. **Different page widths produce different column widths** automatically if the number of columns is constant. A 2-column layout on a landscape page has wider columns than on a portrait page.
2. **Different pages can have different column counts** (e.g. 1 column on the title page, 2 columns on body pages). Requires per-page column configuration, which is a column-layout concern, not an orientation concern.

When columns land, the column resolver sits alongside the dimensions resolver — both are per-page overrides applied during `computePageMetrics`. They're orthogonal.

### 5.6 PDF export

The PDF exporter creates a `PDFPage` for every `LayoutPage` in `layout.pages`. Currently:

```ts
pdfDoc.addPage([pageConfig.pageWidth * PT_PER_PX, pageConfig.pageHeight * PT_PER_PX]);
```

With per-page dimensions:

```ts
const m = layout.metrics[pageIndex];
pdfDoc.addPage([m.pageWidth * PT_PER_PX, m.pageHeight * PT_PER_PX]);
```

Two-line change. The resulting PDF has genuinely mixed-orientation pages — pdf-lib supports this natively; viewers render them correctly (PDF readers handle per-page dimensions universally).

### 5.7 Tile renderer / canvas rendering

Each `LayoutPage` gets its own canvas in the tile renderer. The canvas dimensions need to match the page's dimensions. Currently `TileManager` reads `pageConfig.pageWidth` / `pageConfig.pageHeight` for tile sizing — replace with per-page metrics lookup.

Virtual scrolling assumes uniform page heights for the viewport intersection calculation. With mixed orientation, the intersection math walks pages with running offsets. Small refactor, contained to `TileManager`.

### 5.8 Hit-testing / InputBridge

`InputBridge` translates screen coordinates to document positions. The screen→page step currently may assume uniform page heights. With mixed orientation, this step walks pages with running y offsets. Needs an audit when the feature lands; likely a one-line change.

`CharacterMap` itself is unaffected — it maps `nodePos → (page, x, y)` and a block is on one specific page regardless of that page's orientation. The page-local x/y coordinates are computed by the renderer using per-page dimensions.

### 5.9 Collaboration

Orientation affects layout only, not the document model. A collaborator typing on page 3 (landscape) sees their changes in landscape layout; another collaborator on the same doc sees the same landscape page. No collab model changes.

When Tier 3 (sections) lands, section breaks become part of the document model and get synced via `y-prosemirror` or the sibling `Y.Map` used for `doc.attrs`. Orientation itself remains a layout concern, not a collab concern.

---

## 6. What Word, Google Docs, and Pages do

| Feature | Word | Google Docs | Pages | Scrivr (Tier 2) |
|---|---|---|---|---|
| Document-wide orientation | ✓ | ✓ | ✓ | ✓ (already today) |
| Per-page orientation variation | ✓ (via section breaks) | ✓ (since ~2022, via section breaks + "apply to this section") | ✓ (via sections) | Via `PageDimensionsResolver` |
| UI for orientation change | Format → Orientation + section break | Format → Page Setup + section break | Document → Section Options | Caller-supplied resolver; no built-in UI |
| Section-scoped headers (different per orientation) | ✓ | ✓ | ✓ | Future (Tier 3) |
| Section-scoped numbering restart | ✓ | Limited | ✓ | Future (Tier 3) |
| Per-page margins | ✓ (via sections) | ✓ (via sections) | ✓ (via sections) | Via `PageDimensionsResolver` |
| Landscape page mid-document | Section break next page → landscape | Section break next page → landscape | Insert section break → landscape | Resolver returns landscape dimensions for that page |

The Word/Docs/Pages pattern is consistent: orientation is section-scoped, and inserting a different orientation creates an implicit or explicit section boundary. Scrivr Tier 2 deliberately skips the section layer and lets callers drive per-page dimensions directly. This is a lower-ceremony alternative that unlocks the same content flexibility without requiring a sections feature.

For a consumer app building a "report generator" or "resume builder" where orientation variation is programmatic, not user-driven, Tier 2 is the right fit. For a Word-like editing product where users need to insert a landscape page via menu, Tier 3 (sections) is eventually required.

---

## 7. Call-site inventory (for when Tier 2 ships)

The complete list of code locations that need updating for Tier 2. Source: `grep -rn "pageConfig\.pageWidth\|pageConfig\.pageHeight\|config\.pageWidth\|config\.pageHeight" packages/*/src` on 2026-04-11.

### `packages/core/src/layout/PageMetrics.ts`

- Add `pageWidth`, `pageHeight`, `margins` fields to the `PageMetrics` interface
- Add `PageDimensions` + `PageDimensionsResolver` types (exported)
- Update `computePageMetrics` to accept an optional resolver and consult it before falling back to `pageConfig` defaults
- Return the resolved `pageWidth` / `pageHeight` / `margins` as part of `PageMetrics`

### `packages/core/src/layout/PageLayout.ts`

- Add `placedContentWidth?: number` to `MeasureCacheEntry` and `preCachedContentWidth?: number` to `FlowBlock`
- Update `buildBlockFlow` to copy `placedContentWidth` → `preCachedContentWidth`
- Update `paginateFlow`'s Phase 1b guard to check `preCachedContentWidth === currentMetrics.contentWidth`
- Update `paginateFlow`'s cache write to record `placedContentWidth`
- Add `pageDimensionsResolver?: PageDimensionsResolver` to `PageLayoutOptions`
- Thread the resolver through `runPipeline` → `metricsFor` → `computePageMetrics`

### `packages/core/src/renderer/TileManager.ts`

Ten call sites (as of 2026-04-11):

- Line 194: `this.editor.pageConfig.pageHeight` — per-tile height
- Line 272: `layout.pageConfig.pageWidth` — container width
- Line 390, 391: `pageConfig.pageWidth`, `pageConfig.pageHeight` — content canvas dimensions
- Line 396, 397, 398, 399: tile overlay canvas dimensions (4 reads for w / h / w-style / h-style)
- Line 434: `pageConfig.pageWidth` — tile layout calculation
- Line 531: `pageConfig.pageWidth` — scroll calculation

Plus scroll total height computation — currently `pages.length * pageHeight`, becomes per-page sum.

Plus tile y-coordinate computation — currently `(pageNumber - 1) * (pageHeight + gap)`, becomes running sum over per-page heights.

### `packages/core/src/renderer/ViewManager.ts`

Eight call sites (as of 2026-04-11):

- Lines 215, 216: page div style width/height
- Lines 284, 285: content canvas dimensions
- Lines 289, 290, 291, 292: overlay canvas dimensions (4 reads for w / h / w-style / h-style)
- Line 320: `clearOverlay(ctx, pageWidth, pageHeight, dpr)` call

### `packages/export/src/pdf/index.ts`

Two call sites (as of 2026-04-11):

- Line 91: `const pageWidthPt = pageConfig.pageWidth * PT_PER_PX`
- Line 92: `const pageHeightPt = pageConfig.pageHeight * PT_PER_PX`

Both are used to size `pdfDoc.addPage([pageWidthPt, pageHeightPt])`. Replace with per-page lookup from `layout.metrics[pageIndex]`.

### `packages/core/src/input/InputBridge.ts`

Audit needed — likely one or two sites for screen→document hit-testing that assume uniform page heights. Not inventoried because it's function-internal logic, not a grep-able constant read.

### Total

- **Non-mechanical changes (layout pipeline + types + cache)**: ~150 LOC concentrated in `PageMetrics.ts`, `PageLayout.ts`, and the Phase 1b guard
- **Mechanical call-site updates (renderer + exporter)**: ~200 LOC of grep-and-replace in `TileManager.ts`, `ViewManager.ts`, and `pdf/index.ts`
- **Audit + small fix (input)**: ~20 LOC in `InputBridge.ts`

**Total estimated**: ~400 LOC for a complete Tier 2 implementation. Self-contained in one PR, no schema changes, no new extension lanes.

---

## 8. Decisions

### 8.1 Ship nothing today

Tier 1 already works. Tier 2 is ~400 LOC of mechanical work with no concrete consumer driving the feature yet. Building infrastructure without a consumer risks designing for hypothetical requirements — wait for a real use case.

### 8.2 When a consumer shows up, ship Tier 2 (not Tier 3)

Tier 2 is the minimum architectural unlock. Tier 3 (sections) is a much larger feature whose scope extends well beyond orientation. Don't block orientation on sections. Ship Tier 2 first, add sections later when they're wanted for their own reasons (multi-column, section-scoped headers, restart-numbered footnotes).

### 8.3 `PageDimensionsResolver`, not config replacement

The `PageConfig` interface stays as-is. `PageDimensionsResolver` is an additive per-page override layered on top. Reasons:

1. **Backward compatibility**: no existing consumer breaks. A caller that doesn't pass a resolver sees identical behavior to today.
2. **Default provider role**: `PageConfig` is still the natural place for document-wide defaults. A caller who wants all pages landscape just passes a landscape `PageConfig`; they don't need a resolver at all.
3. **Separation of concerns**: `PageConfig` is configuration, `PageDimensionsResolver` is policy. Mixing them would force every caller to adopt the resolver pattern even when they don't need per-page variation.

### 8.4 `placedContentWidth` alongside `placedContentTop`

The Phase 1b cache two-guard invariant becomes a three-guard invariant for Tier 2:

1. `placedRunId === previousLayout.runId`
2. `placedContentTop === currentMetrics.contentTop`
3. `placedContentWidth === currentMetrics.contentWidth`

All three must match to take the early-termination shortcut. Without (3), a block placed on a portrait page in run K could incorrectly reuse its placement on a landscape page in run K+1 if that specific page's orientation changed.

With zero orientation variation (Tier 1 or Tier 2 with no resolver), all three conditions hold trivially. With real orientation variation, each guard catches a specific cache-staleness case.

### 8.5 No UI for orientation in this design

Tier 2's resolver is a programmatic API. There's no built-in "change orientation" command, menu, or toolbar. A consumer app that wants user-driven orientation builds that UI on top of the resolver (or waits for Tier 3 sections).

Rationale: UI choices depend heavily on what kind of document is being edited. A report generator wants a completely different UX than a resume builder, which wants a different UX than a word processor. Shipping one UI in core would make the wrong choice for most consumers.

---

## 9. Open questions

1. **Per-page dimension validation**: should `computePageMetrics` validate the resolver's output (e.g. reject negative dimensions, reject dimensions less than `2 * margins`)? Yes, with a clear error message, because the failure mode otherwise is silent layout corruption.

2. **Resolver stability**: the resolver must be a pure function of `pageNumber`. If it returns different values across calls for the same page number, pagination results are undefined. Should we cache the resolver's output automatically to guarantee stability? Probably yes — a single-entry cache per layout run is cheap and prevents misuse.

3. **Default gap between mixed-orientation pages**: today all pages have the same visual gap in the tile scroll container. Should mixed-orientation documents have the same gap or a dimension-proportional gap? Probably same — the gap is a visual padding, not a content concern.

4. **Auto-rotate option**: some PDF readers / report tools auto-rotate landscape pages to display them as if they were portrait (rotated 90°). Scrivr should NOT do this — it's a reader-side concern, and auto-rotation breaks text selection and hit-testing. Document that pages are displayed in their natural orientation.

5. **Print mode**: when the browser's `window.print()` runs, it needs to use the correct orientation per page. Modern browsers support `@page { size: landscape }` but per-page `@page` selectors have mixed support. When Tier 2 ships, test that print output is correct in Chrome + Safari + Firefox + print-to-PDF.

---

## 10. Related docs

- **`docs/pagination-model.md`** — the base pagination reference. Covers the layout pipeline stages and how `PageMetrics` fits into them.
- **`docs/multi-surface-architecture.md`** — explains `PageChromeContribution` and how chrome contributors consume per-page metrics. Once Tier 2 lands, chrome contributors get per-page orientation for free.
- **`docs/tables.md`** — mentions mixed-orientation as a use case for tables too wide for portrait pages. Cross-reference once Tier 2 lands.
- **Future `docs/sections.md`** — Tier 3's design doc. Doesn't exist yet.
