# Layout Engine Architecture

> How Scrivr's canvas-based layout engine works, why it departs from browser
> layout, and the mathematical foundations that keep it stable.

---

## 1. Why Canvas, Not DOM

Browser layout engines (Blink, WebKit) evolved as tools for viewing continuous,
flowing web content. They are fundamentally unsuited for paginated document
editing because:

- **Pagination is an afterthought.** Browsers lay out into one tall strip, then
  slice it during pre-paint. This makes widows/orphans control, page-relative
  floats, and cross-page selection impossible to implement correctly.
- **Forced synchronous reflow.** Reading `offsetWidth` or `getBoundingClientRect`
  triggers immediate layout. In a typing-heavy editor, this creates 16-32ms
  latency spikes on every keystroke.
- **Mutable tree architecture.** Legacy engines store inputs (parent constraints)
  and outputs (final x/y/width/height) in the same object. When styles change,
  dirty-bit propagation causes under-invalidation and hysteresis — the final
  layout depends on the previous layout, making the process non-idempotent.
- **Stacking context nonsense.** Properties like `opacity < 1` or `transform`
  create implicit stacking contexts that change z-index behavior. In a canvas
  engine we control draw order explicitly.

Scrivr replaces all of this with a custom engine:
ProseMirror owns the document model, a functional layout pipeline computes
geometry, and HTML5 Canvas paints pixels. The DOM is only used for input
(hidden textarea) and scroll container management.

---

## 2. Architectural Paradigms

### 2.1 Functional Layout (LayoutNG Model)

Scrivr's layout is a pure function:

```
Layout(ProseMirrorDoc, PageConfig, FontConfig, MeasureCache) → DocumentLayout
```

Inputs are immutable. The output is a new `DocumentLayout` containing pages,
blocks, lines, spans, floats, and fragments. No mutable tree is walked or
patched — every layout run produces a fresh result from scratch (with caching
for unchanged subtrees via `WeakMap<Node>`).

This matches the paradigm shift that Chromium made with LayoutNG: formalize
layout as a pure function that takes `(Style + DOM + ParentConstraints)` and
produces an immutable fragment tree. The benefits:

| Property | Mutable Tree (Legacy) | Functional Fragment (Scrivr) |
|----------|----------------------|------------------------------|
| Determinism | Susceptible to hysteresis | Strictly idempotent |
| Invalidation | Dirty-bit marking + tree walk | Triggered by ProseMirror transactions |
| Fragmentation | Post-layout slicing | During layout via break tokens |
| Caching | Fragile (stale state risk) | Safe (immutable inputs, `WeakMap` keyed by node identity) |

### 2.2 The Transaction-to-Canvas Pipeline

Scrivr uses unidirectional data flow:

```
ProseMirror Transaction
    → EditorState (new immutable state)
    → Layout Pipeline (compute geometry)
    → Display List (draw commands per tile)
    → Canvas Rasterization (only visible tiles)
```

This separation of "what" (ProseMirror model) from "how" (canvas pixels) means:
- Plugins operate on the document model, never on pixels
- Layout is independent of rendering — the same pipeline feeds PDF export
- Only visible tiles are painted (virtual scrolling via IntersectionObserver)

---

## 3. Three Coordinate Spaces

A multi-page document requires three distinct coordinate systems. Mixing them
is the source of the POC's offset bug and many browser layout quirks.

| Space | Origin | Units | Used By |
|-------|--------|-------|---------|
| **Logical** | Start of document | Token index (ProseMirror positions) | State, selections, marks, commands |
| **Layout (Global-Y)** | Top of page 1 | Subpixel layout units | Pagination, exclusion detection, constraint solving |
| **Visual (Page-Local)** | Top-left of page tile | Physical pixels | Canvas rendering, hit-testing, mouse events |

### Global-Y to Page-Local Transform

```
y_local = y_global - SUM(height_page[i] + margin_page[i], i = 1..N-1)
```

This decoupling allows page turning and zooming as camera transforms on visual
space without re-running layout. The layout pipeline operates entirely in
Global-Y; `projectFloatsOntoPages` converts to page-local for rendering.

### Why This Matters

Browser engines use a single coordinate system with 32-bit floats, leading to
precision loss in long documents. By separating spaces:
- Layout uses stable, origin-relative coordinates (no drift)
- Rendering uses small page-local values (no precision loss)
- Hit-testing converts visual → layout → logical in defined steps

---

## 4. The Layout Pipeline

Scrivr's pipeline has 6 stages. See `float-layout-v2-spec.md` for the
constraint solver details.

```
Stage 1:    buildBlockFlow          — measure all blocks (unconstrained)
                                      Cache via WeakMap<Node> for unchanged subtrees
Stage 1.5:  assignGlobalY           — stamp continuous Y with CSS margin collapsing
Stage 1.6:  normalizeConstraints    — clamp sizes, offsets, counts (input validation)

        ┌── Constraint Solver ────────────────────────────────────────────┐
        │  resolveFloatsGlobalY    — position floats in layout space      │
        │  reflowConstrainedBlocks — fixed-point reflow (max 5 iter)     │
        │  recomputeGlobalY        — update downstream after height change│
        │  Invariants: monotonic height, frozen barriers, pinned floats  │
        └─────────────────────────────────────────────────────────────────┘

Stage 2:    paginateFlow            — assign blocks to pages (read-only)
Stage 3:    projectFloatsOntoPages  — layout space → visual space projection
Stage 4:    buildFragments          — O(log N) fragment index for tile renderer
```

### Functional Purity

Each stage receives its inputs and produces outputs without side effects.
No stage reads state from a previous run (except the `WeakMap` measure cache,
which is keyed by immutable ProseMirror `Node` identity).

This is the same principle as LayoutNG's "Break Tokens": when a paragraph
splits across pages, the engine produces a fragment for the current page and
a resumption state for the next, without mutating ancestors or siblings.

---

## 5. Exclusions and Layout Opportunities

### 5.1 The Geometric Model

When a float occupies space on the page, it creates an "exclusion" — a
rectangular region that text must flow around. The available space for text
is the content area minus all exclusion regions:

```
W = A - UNION(E_1, E_2, ..., E_n)
```

where `A` is the content area and `E_i` are exclusion rects. At each
line's Y range, the layout algorithm subtracts active rectangles from
the content area and gets zero or more available inline segments. A
left/right float is just a case where only one useful segment remains;
a centered square object can produce two.

In Scrivr, the `ExclusionManager` implements this:
- `addRect(rect)` — register an exclusion zone
- `getAvailableSegments(page, y, lineHeight, contentX, contentWidth)` —
  query all usable inline segments at a given Y position
- `hasExclusionsOnPage(page)` / `getNextFreeY(page, y)` — page-level
  checks and full-width exclusion skipping

### 5.2 Page Boundaries as Constraints

Rather than treating pagination as post-layout slicing, Scrivr treats page
boundaries as constraints in the same system as float exclusions. Page break
barriers are computed from unconstrained flow heights and frozen before the
constraint loop. This allows the same code path to handle:
- Text wrapping around images
- Content flowing between pages
- Explicit page breaks (`pageBreak` nodes)

---

## 6. Mathematical Stability

### 6.1 The Convergence Problem

Layout is inherently recursive: a paragraph's height depends on its width,
but with floats, its width depends on its vertical position (Global-Y), which
depends on the heights of preceding content. Without guards, this creates
oscillation:

```
Iteration 0: block constrained → height 298px
Iteration 1: constraint removed → height 90px
Iteration 2: constraint reapplied → height 298px
...forever
```

### 6.2 Monotone Convergence

The layout process is a discrete dynamical system:

```
y_(n+1) = L(y_n, E)
```

where `y` is the vector of element positions, `L` is the layout function,
and `E` is the set of exclusions. Stability requires `L` to be a
**contraction mapping** — successive results must converge.

Scrivr enforces this via the **monotonic height invariant**:

```
newHeight >= oldHeight    (for every block, every iteration)
```

This works because constraints only narrow width (never widen it — exclusion
zones are pinned). Narrower width means more line wraps, which means equal
or greater height. The sequence `{height_0, height_1, ...}` is non-decreasing
and bounded (by the constraint loop cap), so by the Monotone Convergence
Theorem it must converge.

### 6.3 Stability Classification

| Category | Condition | Behavior |
|----------|-----------|----------|
| Monotonic convergence | `0 <= L'(y) < 1` | Content settles smoothly |
| Oscillatory convergence | `-1 < L'(y) < 0` | Jitters but stabilizes |
| Direct divergence | `L'(y) > 1` | Layout explosion (prevented by input normalization) |
| Cyclic oscillation | `L'(y) ~ -1` | Infinite loop (prevented by pinned floats + frozen barriers) |

### 6.4 Termination Guarantee

The constraint loop has a hard cap (`MAX_ITERATIONS = 5`). If convergence
is not reached, `degradeLayout` drops remaining float constraints and reflows
at full width. The system always produces valid output.

---

## 7. Text Measurement

### 7.1 The DOM Measurement Problem

Native browser calls like `getBoundingClientRect()` trigger synchronous
reflow — the single largest performance bottleneck in web editors. A canvas
engine bypasses this entirely.

### 7.2 TextMeasurer (Scrivr's Typometer)

Scrivr uses the Canvas `measureText()` API with an LRU cache:

- **Single offscreen canvas** — one 1x1 canvas reused for all measurements
- **LRU word cache** — keyed by `(text, fontFamily, fontSize, weight, style)`.
  Each unique word-style combination is measured exactly once.
- **Deterministic in tests** — `vitest.setup.ts` mocks `measureText` to return
  fixed widths, enabling reliable layout tests without a real canvas.

Performance: 10-100x faster than DOM measurement. Typing feedback is <8ms
(vs 16-32ms with DOM reflow overhead).

### 7.3 Style Resolution Cache

Analogous to Blink's Matched Properties Cache (MPC), Scrivr's `StyleResolver`
caches computed font metrics per unique style combination. When a node's marks
change, the resolver checks if the resulting style already exists in cache
before recomputing.

---

## 8. Pagination: Fragmentation During Layout

### 8.1 Why Not Post-Layout Slicing

Browsers traditionally lay out into one tall strip, then slice during
pre-paint. This makes it impossible to:
- Honor `break-before: avoid` and `break-after: avoid`
- Control widows and orphans
- Place page-relative floats correctly

### 8.2 Scrivr's Approach

Scrivr performs fragmentation during layout via `paginateFlow`:

1. **Fragmentation root** — the document establishes a fragmentation context
2. **Deterministic splicing** — as the pipeline traverses flows, it tracks
   accumulated block-size. When available page height is exhausted, it
   identifies a breakpoint.
3. **Breakpoint scoring** — perfect breaks between paragraphs, acceptable
   breaks between lines (respecting widows/orphans), last-resort breaks
   within words.
4. **Resumption state** — the pipeline emits a `LayoutResumption` containing
   the item index, completed pages, and carry-over state. Streaming layout
   (`maxBlocks` cutoff) uses this for incremental pagination.

### 8.3 Split Blocks

When a paragraph spans two pages, it becomes two `LayoutBlock` entries
(one per page) with `isContinuation = true` on the second. The `CharacterMap`
uses char-level span ranges (not block-level) to handle cursor placement
and click hit-testing across split paragraphs.

---

## 9. Rendering: Tiles and Virtual Scrolling

### 9.1 Tile Architecture

Each page is rendered onto its own canvas element (content layer + overlay
layer). The `TileManager` handles:

- **Virtual scrolling** — `IntersectionObserver` tracks which pages are in the
  viewport. Only visible pages (plus a small buffer) are rasterized.
- **Canvas pooling** — as pages scroll out of view, their canvases can be
  reused for newly visible pages.
- **Dirty tracking** — when a transaction affects specific blocks, only the
  affected pages are repainted (not the entire document).

### 9.2 Three-Layer Draw Order

Rather than browser stacking contexts (where `opacity < 1` creates implicit
layers), Scrivr uses explicit layers:

1. **Content layer** — text, images, horizontal rules, backgrounds
2. **Overlay layer** — cursor, selection highlight, float outlines,
   AI suggestion ghost text
3. **UI layer** — floating menus, tooltips (DOM elements positioned
   relative to canvas coordinates)

### 9.3 Performance at Scale

| Metric | DOM-Based Editor | Scrivr (Canvas) |
|--------|-----------------|-----------------|
| Initial load | Slow (DOM node count) | Fast (stream raw text + schema) |
| Scroll latency | High (triggers reflow) | Zero (GPU-backed tile swap) |
| Memory footprint | Grows with document | Constant (visible viewport only) |
| Typing feedback | 16-32ms (reflow) | <8ms (isolated paragraph layout) |

---

## 10. Input and Accessibility

### 10.1 The Input Bridge

Canvas is a black box — no native text input. Scrivr uses a hidden
`<textarea>` as the bridge:

- **8 DOM event listeners** — `beforeinput`, `compositionstart/update/end`,
  `paste`, `cut`, `keydown`, `input`
- **IME support** — during composition, the engine peeks at the textarea
  value and renders uncommitted text with underline styling on the canvas
- **Projection** — the textarea is positioned at the cursor location in
  visual space so the browser's IME candidate window appears correctly

### 10.2 Selection and Hit-Testing

Since `window.getSelection()` is unavailable:

1. **Click → Visual space** — mouse coordinates from the canvas element
2. **Visual → Layout space** — convert page-local to Global-Y
3. **Layout → Logical** — binary search through `CharacterMap` line entries
   to find the ProseMirror document position
4. **Selection rendering** — drawn as transparent rectangles on the overlay
   canvas, always above text

### 10.3 Accessibility

Canvas pixels are invisible to screen readers. Scrivr addresses this via
a planned A11Y DOM mirror:

- **Visual buffer** — canvas handles rendering (sighted users)
- **Semantic buffer** — invisible DOM elements with ARIA roles (`role="paragraph"`)
  maintained in sync with ProseMirror state, positioned behind the canvas
- This allows screen readers to navigate document structure while the canvas
  delivers the visual experience

See `todo_accessibility_strategy.md` for the phased implementation plan.

---

## 11. What Scrivr Discards from Browser Engines

These are deliberate departures, not missing features:

| Browser Behavior | Why It's Discarded | Scrivr's Approach |
|-----------------|-------------------|-------------------|
| Implicit stacking contexts | Unpredictable z-order from `opacity`, `transform` | Explicit 3-layer draw order |
| Tag repair | CPU cycles fixing broken HTML | ProseMirror schema guarantees validity |
| Sequential greedy float placement | Relic of 1990s streaming parsers | Random-access constraint solver |
| `getBoundingClientRect()` reflow | Synchronous layout on read | Canvas `measureText()` + LRU cache |
| Single coordinate system | Precision loss in long documents | Three separated spaces (logical, layout, visual) |
| Post-layout pagination slicing | Can't honor widows/orphans | Fragmentation during layout |
| CSS cascade for every element | Expensive style resolution | StyleResolver with matched properties cache |

---

## 12. Extending the Constraint Engine

The constraint solver (float-layout-v2-spec.md) is designed as a general
engine, not a float-specific system. The same 3-phase pattern applies to
future layout features:

| Feature | Constraint Declaration | Constraint Satisfaction | Projection |
|---------|----------------------|------------------------|------------|
| **Floats** | Exclusion rects from float anchors | Reflow text around exclusion zones | Float globalY → page-local |
| **Tables** | Column width constraints from cell content | Cell height equalization across rows | Row fragments across pages |
| **Columns** | Column gap + count → available width per column | Balance content height across columns | Column fragments → page tiles |
| **Margin notes** | Side margin exclusion rects | Main body reflow (if margin overflows) | Note position → page margin area |
| **Annotations** | Anchored regions in margin | Stack overlapping annotations | Annotation → visual callout position |

### The Universal Query

Every layout feature reduces to one question:

> **Given this Y position, what horizontal X segments are available for content?**

That's what `ExclusionManager.getAvailableSegments(y, lineHeight)` answers.
Anchored objects declare rects that subtract from the available segments.
Columns would declare a gutter rect that splits them. Margin notes would
declare a side rect. The line breaker doesn't care what declared the
exclusion — it just asks the query and wraps text into the available space.

This is also how the surface system connects to the layout engine.
`PageChromeContribution` (headers, footers, footnotes) reserves vertical
space at the top/bottom of each page. That reservation shrinks the available
content height — which is the Y-axis equivalent of the same query. Surfaces
declare space, the pipeline respects it, one source of truth.

The `ExclusionManager` already supports arbitrary rects in Global-Y space.
Adding a new constraint source means:
1. Declare exclusion rects during Phase A
2. The existing Phase B reflows text automatically
3. Write a projection function for Phase C

Don't build generic constraint interfaces until there are two real consumers.
Floats are the first. When the second arrives (tables or columns), the right
abstraction will be obvious from the shared code.

---

## 13. Key References

| Document | What It Covers |
|----------|---------------|
| `float-layout-v2-spec.md` | Full constraint solver specification |
| `float-layout-migration.md` | POC retrospective and debugging journey |
| `layout-pipeline-architecture.md` | Stage-by-stage pipeline design |
| `layout-fragment-architecture.md` | Fragment identity and indexing |
| `pagination-model.md` | Pagination rules and break scoring |
| `page-orientation.md` | Per-page dimension design |
| `multi-surface-architecture.md` | Editor surfaces and multi-document editing |
