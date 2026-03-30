# Layout Pipeline Architecture

## Overview

This document describes the target pipeline architecture for the layout engine — modeled on how Chrome, Google Docs, and Figma structure their rendering pipelines. The goal is to split the monolithic `layoutDocument()` into independent stages with clean interfaces, enabling tables, columns, footnotes, and collaborative editing without chaos.

The shift from a flat `LayoutItem[]` to a `LayoutNode` tree is the most critical structural change: it transforms the engine from a "list processor" into a "hierarchy processor" — the prerequisite for any CSS-class nested rendering.

---

## The Pipeline (Target State)

```
ProseMirror Document
        ↓
┌──────────────────────────┐
│ 1. Layout Tree Builder   │  buildLayoutTree(doc)
└──────────────────────────┘
        ↓
LayoutNode[]  (structure only, no sizes)
        ↓
┌──────────────────────────┐
│ 2. Inline Layout Engine  │  layoutBlock() — already correct
└──────────────────────────┘
        ↓
InlineLayoutResult per node  (lines, height — no pages, no Y positions)
        ↓
┌──────────────────────────┐
│ 3. Block Flow Engine     │  buildBlockFlow()
└──────────────────────────┘
        ↓
FlowBlock[]  (continuous Y space — no pages, no floats yet)
        ↓
┌──────────────────────────┐
│ 4. Float Layout Engine   │  applyFloatLayout()
└──────────────────────────┘
        ↓
FlowBlock[] (widths narrowed by exclusions) + FloatLayout[]
        ↓
┌──────────────────────────┐
│ 5. Pagination Engine     │  paginateFlow()
└──────────────────────────┘
        ↓
LayoutPage[]  (blocks split and assigned to pages)
        ↓
┌──────────────────────────┐
│ 6. Fragment Builder      │  buildFragments()
└──────────────────────────┘
        ↓
LayoutFragment[]  (one entry per page-part of each block)
        ↓
CharacterMap  →  Canvas Renderer
```

---

## Why Separate "Structure" from "Geometry"

The current `layoutDocument()` mixes five concerns in one loop:

| Concern | Should live in |
|---------|----------------|
| Walk document blocks | Stage 1 (Layout Tree) |
| Measure lines | Stage 2 (Inline Layout) |
| Stack blocks vertically | Stage 3 (Block Flow) |
| Float exclusions + reflow | Stage 4 (Float Engine) |
| Split blocks across pages | Stage 5 (Pagination) |

Tangling these means: changing float logic requires touching pagination; adding tables requires touching the main loop; streaming layout must checkpoint in the middle of all of it.

Once each stage has a pure input/output contract, any stage can be swapped, parallelised, or cached independently.

---

## Stage-by-Stage Specification

### Stage 1 — Layout Tree Builder

**Input:** ProseMirror `Node`
**Output:** `LayoutNode[]`

```ts
interface LayoutNode {
  type: "block" | "inline" | "image" | "table" | "listItem";
  node: Node;
  nodePos: number;
  children: LayoutNode[];  // cells are children of rows, rows of tables, etc.
}
```

Currently implicit — `collectLayoutItems()` produces a flat `LayoutItem[]`. A tree unblocks:
- Tables (cells → rows → table)
- Columns (blocks grouped per column)
- Footnotes (separate subtree, paginated independently)
- Side comments / margin notes

**What changes:** `collectLayoutItems()` returns `LayoutNode[]` instead of `LayoutItem[]`.

---

### Stage 2 — Inline Layout Engine

**Input:** `LayoutNode`, `ConstraintProvider`, `PageConfig`, `FontConfig`
**Output:** `InlineLayoutResult`

```ts
interface InlineLayoutResult {
  lines:         LayoutLine[];
  height:        number;
  spaceBefore:   number;
  spaceAfter:    number;
  hasFloatAnchor: boolean;  // true if this block contains a float anchor span
}
```

**Status: already correct.** `layoutBlock()` in `BlockLayout.ts` is stateless and reusable. Table cells and column blocks already call it.

The `hasFloatAnchor` flag is new — it is cheap to detect during span extraction and enables Stage 4 to skip blocks that cannot possibly interact with floats. Only blocks where `hasFloatAnchor === true` or whose Y-range overlaps an active float's exclusion zone need to be re-processed in Stage 4.

The only invariant: this stage knows **nothing about pages**. It produces lines for an infinite canvas.

---

### Stage 3 — Block Flow Engine

**Input:** `LayoutNode[]` + inline results
**Output:** `FlowBlock[]`

```ts
interface FlowBlock {
  node:            Node;
  nodePos:         number;
  lines:           LayoutLine[];
  height:          number;
  spaceBefore:     number;
  spaceAfter:      number;
  y:               number;   // position in continuous (page-free) document space
  availableWidth:  number;
  inputHash:       number;   // hash of (nodePos + node.textContent + availableWidth)
  hasFloatAnchor:  boolean;  // forwarded from InlineLayoutResult
}
```

This stage answers one question: **"How tall is the document if there are no pages?"**

It does:
- Stack blocks vertically with margin collapsing (`spaceBefore` / `spaceAfter`)
- Produce monotonically increasing `y` values
- Forward `hasFloatAnchor` from inline results

It does **not** know about page height, float exclusions, or line splitting.

**`inputHash` and incremental invalidation:**

Each `FlowBlock` stores a hash of its input `LayoutNode`. On re-layout:
1. Diff the new `LayoutNode[]` against the previous `FlowBlock[]` by comparing `inputHash`.
2. If a block's hash is unchanged, reuse its `lines` and `height` from the previous `FlowBlock`.
3. Only recalculate `y` offsets from the first changed block onward (a single pass through the suffix).

This makes collaborative editing cheap: a remote keystroke in paragraph 40 of 200 re-measures only paragraph 40, then re-stacks paragraphs 41–200 in O(N) without re-measuring any of them.

**What changes:** Extract the block-stacking loop from `layoutDocument()` Pass 1 into `buildBlockFlow()`. The Phase 1b early-termination cache check (`placedTargetY` + `placedPage`) is replaced by `inputHash` diffing, which generalises correctly to collaborative scenarios.

---

### Stage 4 — Float Layout Engine

**Input:** `FlowBlock[]`, float anchors from inline results
**Output:** `{ flow: FlowBlock[], floats: FloatLayout[] }`

The float/flow relationship has a hidden feedback loop:

> You cannot know the final height of a block until you know its float exclusions (Stage 4), but you cannot position floats until you know the block's Y origin (Stage 3).

The resolution is **optimistic layout with targeted correction**:

1. Stage 3 produces initial Y positions ignoring floats.
2. Stage 4 uses those Y positions to anchor and position floats.
3. Stage 4 re-runs inline layout **only** for blocks where `hasFloatAnchor === true` or where the block's Y-range overlaps an active exclusion zone — not for all blocks.
4. Height deltas from re-flowed blocks are cascaded to downstream Y values.
5. Float Y positions are reconciled once against final block positions (Pass 4 today).

This matches the current 4-pass structure but makes the targeted-correction scope explicit via `hasFloatAnchor`, avoiding unnecessary re-measurement.

**What changes:** Lift Passes 2–4 into `applyFloatLayout(flow, config)`. `ExclusionManager` is scoped per call. Output is the same `FlowBlock[]` shape with updated heights and widths, plus `FloatLayout[]`.

---

### Stage 5 — Pagination Engine

**Input:** `FlowBlock[]` + `pageHeight` + `margins`
**Output:** `LayoutPage[]`

Once blocks have continuous Y positions, pagination is a pure geometric operation:

```
for block in flow:
  if block.y + block.height > pageBottom:
    check break rules (break-inside, widow/orphan)
    split lines at page boundary (or push entire block)
    emit part to current page
    start new page
    emit continuation part(s)
```

No measuring. No float logic. Just geometry — and breaking rules.

**Break rules live here, not in Stage 3:**

`paginateFlow()` is the only stage that knows where page boundaries fall, so it is the only stage that can enforce `break-inside: avoid`, orphan/widow thresholds, or "keep with next" constraints. The enforcement mechanism is simple: if a split is illegal, push the entire `FlowBlock` to the next page instead. This may shift the anchor of a nearby float, which requires a targeted re-run of Stage 4 for that page. Because Stages 4 and 5 are separate, that re-run is scoped precisely.

**What changes:** Line-splitting logic currently in Pass 1 and Pass 3b moves here exclusively. `splitBlockAtBoundary()` becomes an internal helper. `paginateFlow()` is a pure function with no cache access.

---

### Stage 6 — Fragment Builder

**Input:** `LayoutPage[]`
**Output:** `LayoutFragment[]`

```ts
interface LayoutFragment {
  fragmentIndex:    number;   // 0-based part index within the source block
  fragmentCount:    number;   // total parts this block was split into (1 = unsplit)
  sourceNodePos:    number;   // nodePos of the original unsplit block
  page:             number;
  x:                number;
  y:                number;   // page-local coordinate
  width:            number;
  height:           number;
  lineStart:        number;   // index of first line from FlowBlock.lines
  lineCount:        number;   // number of lines in this fragment
}
```

`lineStart` + `lineCount` replace the `lines: LayoutLine[]` copy. The renderer slices `flowBlock.lines.slice(lineStart, lineStart + lineCount)` directly — no array allocation per fragment, no redundant data.

Currently this is implicit — split `LayoutBlock` objects are linked by `nodePos` + boolean flags. Making it explicit:
- Enables O(1) lookup: "all fragments for nodePos 42"
- Replaces flag soup: `fragmentIndex === 0` = first, `fragmentIndex === fragmentCount - 1` = last
- Table row splits, column splits, and paragraph splits are all identical — `Block → N fragments`

**What changes:** `buildFragments(pages)` iterates pages, assigns `fragmentIndex` / `fragmentCount` counters per `sourceNodePos`, emits `LayoutFragment[]`. `LayoutPage` retains `LayoutBlock[]` for backwards compatibility; fragments are an additive index.

---

## Key Data Structure: FlowBlock

`FlowBlock` is the pipeline's pivot point — what you have **after** inline layout and **before** pagination. It enables:

| Property | Who benefits |
|----------|-------------|
| `y` (continuous space) | Float engine can shift without touching lines; pagination can slice by page height |
| `inputHash` | Stage 3 skips re-measurement of unchanged blocks; collaborative reflow is O(changed blocks) |
| `hasFloatAnchor` | Stage 4 skips the expensive exclusion re-run for blocks that cannot possibly intersect floats |
| `lines[]` (stable reference) | Stage 6 fragments point into this array via `lineStart`/`lineCount` — zero copying |

---

## Migration Strategy (4 steps, each independently shippable)

### Step 1 — Extract `buildBlockFlow()`

```ts
function buildBlockFlow(
  items:    LayoutItem[],
  config:   PageConfig,
  fonts:    FontConfig,
  measurer: TextMeasurer,
  cache:    MeasureCache,
  prev?:    FlowBlock[]   // previous run for inputHash diffing
): FlowBlock[]
```

Run in parallel with existing `layoutDocument()` and assert identical output before removing the old path.

**Risk:** Phase 1b early-termination logic must move here. The `placedTargetY` / `placedPage` comparisons are replaced by `inputHash` diffing, which subsumes and generalises the existing optimisation.

### Step 2 — Extract `applyFloatLayout()`

```ts
function applyFloatLayout(
  flow:     FlowBlock[],
  config:   PageConfig,
  measurer: TextMeasurer
): { flow: FlowBlock[], floats: FloatLayout[] }
```

Stage 4 processes only blocks where `hasFloatAnchor === true` or whose Y-range intersects an active exclusion zone. The float Y reconciliation (Pass 4) becomes trivial because `FlowBlock.y` is already the ground truth.

### Step 3 — Extract `paginateFlow()`

```ts
function paginateFlow(
  flow:   FlowBlock[],
  floats: FloatLayout[],
  config: PageConfig
): LayoutPage[]
```

Break rules (`break-inside`, widow/orphan) live here as a post-split check. When a rule forces a full-block push to the next page, a targeted `applyFloatLayout()` re-run for that page resolves any float anchor drift.

### Step 4 — New pipeline driver in `LayoutCoordinator`

```ts
const tree    = buildLayoutTree(this._doc);
const flow    = buildBlockFlow(tree, config, fonts, measurer, cache, this._prevFlow);
const floated = applyFloatLayout(flow, config, measurer);
const pages   = paginateFlow(floated.flow, floated.floats, config);
const frags   = buildFragments(pages);

this._prevFlow = flow;
this._layout   = { pages, floats: floated.floats, fragments: frags, version: ++this._version };
```

---

## What Does NOT Change

| Component | Reason |
|-----------|--------|
| `layoutBlock()` + `LineBreaker` | Already correct Stage 2. Stateless, reusable, no changes. |
| `CharacterMap` | Already correct. Populated after Stage 6. |
| `MeasureCacheEntry` (WeakMap) | Superseded by `inputHash` diffing in Stage 3; WeakMap cache may be retained as a fast path. |
| `TextMeasurer` LRU cache | Unchanged. |
| Streaming / `LayoutResumption` | Chunking applies to `buildBlockFlow()`. Same checkpoint concept. |
| `ExclusionManager` | Moves into Stage 4. Scoped per `applyFloatLayout()` call. |

---

## Features This Unlocks

| Feature | Why the pipeline enables it |
|---------|----------------------------|
| **Multi-column layout** | Two column streams run through `buildBlockFlow()` independently, paginated together in Stage 5 |
| **Tables** | `LayoutNode` tree gives cells a natural parent; `fragmentIndex` handles row splits identically to paragraphs |
| **Footnotes** | Footnote nodes live in a separate `LayoutNode` subtree; Stage 5 handles them as a second flow with its own page-bottom constraint |
| **Side comments** | Stage 2 (Inline) is reusable for comment panel text with a different available width |
| **Layout streaming** | `buildBlockFlow()` is the only stage needing chunking; Stages 4–6 are fast geometric ops on the partial result |
| **Collaborative reflow** | `inputHash` diffing in Stage 3 makes a single-block remote change O(1) remeasure + O(N) Y-restack |
| **Break rules (widow/orphan)** | Stage 5 is the only stage that sees page boundaries, so break enforcement has a clean home with no cross-stage side effects |

---

## Relation to Fragment Architecture

The pipeline architecture is the structural foundation that makes the fragment improvements in [`layout-fragment-architecture.md`](./layout-fragment-architecture.md) fully clean:

- **Phase 1** (line-granular `_fragmentIndex`) — natural output of Stage 6
- **Phase 2** (`fragmentIndex` / `fragmentCount` / `sourceNodePos` on `LayoutBlock`) — stepping stone to the `LayoutFragment` interface above
- **Phase 3** (partial charMap invalidation) — simpler once Stage 3 has `inputHash` versioning per block

The fragment doc covers the three near-term improvements that can ship before the pipeline refactor. The pipeline refactor makes them architecturally complete.
