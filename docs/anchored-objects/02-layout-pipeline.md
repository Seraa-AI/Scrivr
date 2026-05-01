# 02 — Layout Pipeline

This document specifies how the layout engine produces a
`DocumentLayout` from a ProseMirror document containing anchored
objects, in a way that satisfies the model in
[`00-model.md`](./00-model.md) and the per-mode mechanics in
[`01-placement-and-wrap-policies.md`](./01-placement-and-wrap-policies.md).

## Pipeline shape

```
Stage 1 — Build flow blocks
Stage 2 — Stamp continuous global Y
Stage 3 — Resolve anchored objects (the solver)
Stage 4 — Paginate against solver output
Stage 5 — Project to page-local coordinates
```

The non-negotiable rules:

- **Stage 3 is authoritative.** It decides where every anchored
  object lives in flow and where its wrap effect is registered.
  Pagination consumes its output. Projection is a pure mapping
  from continuous global Y to page-local Y.
- **No post-pagination patching.** There is no Stage 6 that
  re-shoves objects, re-flows pages, or reconciles "the float
  ended up on the wrong page." If a placement-level invariant
  fails, the bug is in Stage 3 — fix it there.
- **One source of truth per coordinate.** Continuous global Y is
  owned by Stage 2/3. Page-local Y is owned by Stage 4 (cursor)
  and Stage 5 (projection). They never disagree because Stage 4
  honours Stage 3's globalY (see "Pagination contract" below).

## Stage 1 — Build flow blocks (`buildBlockFlow`)

For each top-level node in the document, produce one or more
`FlowBlock` entries. Plain blocks (paragraph, heading, list item,
HR, page break, code block, etc.) produce a single FlowBlock each.

**Attribute normalization.** As each image anchor is encountered,
its raw attributes are normalized once into the new model:

```
{ wrapMode, positionMode, xAlign, x, width, height, margin }
```

Legacy values (`wrappingMode: "square-left"` → `wrapMode: "square",
xAlign: "left"`; `wrappingMode: "square-right"` → `wrapMode: "square",
xAlign: "right"`; `floatOffset` → discarded) are mapped here. The
solver and downstream stages never branch on legacy attribute names.

**Inline-anchored split** (Rule 2 of `00-model.md`): if a paragraph
contains one or more anchors whose `wrapMode` has **non-zero flow
contribution** — `top-bottom`, `behind`, `front` — split the
paragraph into alternating fragment / anchored-object-block entries:

```
paragraph: [text-A] [topBottomAnchor] [text-B]
                ↓
flows:     fragment(text-A)
           anchored-object-block(topBottomAnchor)
           fragment(text-B)
```

`wrapMode: "square"` does **not** trigger the split — the anchor
paragraph stays as a single FlowBlock with a zero-width inline anchor
span at the image's docPos. Square's flow contribution is zero; its
effect on flow comes through wrap-zone constraints applied to lines
during reflow, not through a flow block of its own.

`inline`-mode images of course never split.

Each FlowBlock produced by a split carries enough metadata
(`sourceNodePos`, `partKind`, `splitAnchorDocPos`) for the renderer
to map fragments back to their source paragraph for cursor and
selection.

Output: `FlowBlock[]` with `lines` and `height` measured at
unconstrained content width, plus a per-paragraph list of square-mode
anchor spans (used by Stage 3 to emit wrap zones).

## Stage 2 — Stamp continuous global Y (`assignGlobalY`)

Walk flows in order. Each flow's `globalY` is the previous flow's
`globalY + height`, plus the collapsed margin between them
(`max(prev.spaceAfter, current.spaceBefore)` per CSS margin
collapsing).

Global Y is **continuous** across page boundaries — no pagination
yet. The first flow starts at `margins.top` (page 1's
`contentTop`).

Output: every FlowBlock has `globalY` set.

## Stage 3 — Resolve flow + constraints (authoritative solver)

This is the only stage that reads and writes anchored-object
positions and the only stage that may mutate `flow.globalY` after
Stage 2. It does not just place objects — it defines the entire
layout truth that Stage 4 and Stage 5 consume without
modification.

### Inputs

- `FlowBlock[]` with `globalY` stamped.
- `AnchoredObjectInput[]` — normalized records, one per non-inline
  anchor span found in Stage 1 (validated, clamped, mode mapped).
- `PageMetrics` for each page (from `computePageMetrics`).
- `pageConfig`.

### Page Barrier Policy

Stage 3 uses a lazy, metrics-backed barrier provider:

```
barriers = createPageBarrierProvider(pageConfig, metricsFor)

barriers.pageForGlobalY(globalY)
barriers.pageStartGlobal(pageNumber)
barriers.contentBottomGlobal(pageNumber)
barriers.localYForGlobalY(pageNumber, globalY)
```

The provider memoizes page starts and reads page geometry through
`metricsFor(pageNumber)`. It extends only as far as the solver asks.
Do not precompute an eager barrier array from `maxFlowBottom`, and do
not scatter raw `metricsFor(pageNumber).contentBottom` checks through
the solver.

This is the 4A loop-refactor target. It matches the shipped behavior
semantically, keeps orientation/header/footer page metrics as the
single source of truth, and avoids allocating or invalidating barriers
for pages the current solver pass never touches.

### Outputs

A `SolverResult`:

```
placements:  AnchoredObjectPlacement[]   — { docPos, page, x, y, width, height, anchorGlobalY }
wrapZones:   WrapZone[]                  — { x, right, top, bottom, anchorDocPos }
status:      "stable" | "exhausted"
iterations:  number
```

`AnchoredObjectPlacement.x` is the resolved horizontal position from
`xAlign` / `x` (every non-inline mode), in page-local coordinates.
`.y` is the painted top in page-local coordinates. `anchorGlobalY`
is the final continuous global-Y coordinate used by the solver for
stacking and re-stamping. There is no exported `layoutY` field and
no separate paint offset.

`WrapZone` carries the actual placed rectangle (no `side` field — the
side that text wraps on is computed per-line at reflow time from the
zone's geometry vs. content area, per `01-placement-and-wrap-policies.md`
§ wider-side wrap).

The pipeline does **not** retain a separate `FloatLayout` type that
participates in projection — placements are emitted once here and
projection is a pure mapping (Stage 5).

### Algorithm (bounded fixed-point loop)

```
barriers ← createPageBarrierProvider(pageConfig, metricsFor)

loop max N iterations (default: 8):
  for each input in document order:
    objectGlobalY ← anchor.globalY
    objectGlobalY ← applyBarrier(objectGlobalY, height, barriers)
    objectGlobalY ← applyStacking(objectGlobalY, prior placements)
    if anchor.globalY < objectGlobalY:
      anchor.globalY ← objectGlobalY      # the unified push rule
      recomputeGlobalY(flows, anchorIndex + 1)
      anchorPushed ← true

  changed ← reflowAgainstWrapZones(flows, result.wrapZones)
                                              # narrows lines beside square objects
  if changed:
    recomputeGlobalY(flows, firstChangedIndex + 1)

  if !anchorPushed && !changed:
    return { ...result, status: "stable", iterations: i }

return { ...result, status: "exhausted", iterations: N }
```

The two-step convergence — placements settle, then constrained
reflows settle, then re-check placements — is required because
reflowing a paragraph beside a square object can change its
height, which can change a downstream anchor's globalY, which
can change whether a downstream object fits on its page.

Combined with the **monotonicity guarantee** below, the loop is
guaranteed to terminate within a small number of iterations for
real documents; the iteration cap exists only as a safety net.

### Anchor-push rule (the load-bearing rule)

The unified rule is:

```
anchor.globalY = max(anchor.globalY, objectGlobalY)
```

`objectGlobalY` is the internal resolved continuous Y of the
anchored object after `placeAnchoredObjects` has applied barrier
and stacking logic. The anchor follows whatever increases the
object's Y. It is a solver-local variable, not a field on
`AnchoredObjectPlacement`.

After any push, `recomputeGlobalY(flows, anchorIndex + 1)`
re-stamps downstream flows; the outer loop re-iterates.

The contributors to `objectGlobalY > anchor.globalY` are:

1. **Barrier overflow (top-bottom / behind / front).** The block's
   footprint (`anchor.globalY → anchor.globalY + image.height`)
   extends past the anchor's page barrier AND the block would fit
   on the next page. The placer moves `objectGlobalY` to the
   barrier. Skip the move if the block wouldn't fit on the next
   page either (oversized object — see Edge cases).

2. **Visual-overflow push (square).** The image's painted
   rectangle (`anchor.flow_y → anchor.flow_y + image.height`)
   extends past the anchor's page barrier even though the anchor
   paragraph itself fits. The placer moves `objectGlobalY` to
   the barrier so the image renders on the same page as a
   re-positioned anchor. Same fit-on-next-page guard as above.

3. **Stacking (top-bottom only).** The block was pushed below a
   previously-placed `top-bottom` block because they collide
   vertically. `square` zones do **not** participate in block
   stacking (they have no flow contribution); horizontal
   collision between `square` images on the same Y is resolved
   per `01-placement-and-wrap-policies.md` § Stacking semantics.

After any contributor moves `objectGlobalY`, the anchor-push
rule fires automatically (`anchor.globalY := max(...)`). This
unifies the four cases into a single invariant.

### Monotonicity guarantee

For flow-anchored objects, the solver is monotonic across iterations
within one layout run:

- `anchor.globalY` only ever increases.
- `objectGlobalY` only ever increases.

This guarantees termination and prevents oscillation bugs
(anchor pushed forward then released, then re-pushed). The
iteration cap is a safety net for adversarial inputs, not a
correctness mechanism.

This guarantee is run-local and flow-anchor-specific. A new layout
run after a document edit starts from freshly assigned Stage 2 flow
positions, so the same docPos may resolve to a lower `globalY` when
earlier content is deleted. Future page-anchored objects must use a
separate page-relative stability invariant; their absolute global Y
tracks page barriers and may move backward across runs.

### Wrap zones (square mode)

For each `square` anchor span, emit a `WrapZone` from the image's
**actual painted rectangle** (resolved horizontal X via `xAlign` /
`x`, vertical Y from anchor's flow position):

```
imageX      = resolveX(width, xAlign, x, contentX, contentWidth)
zone.left   = imageX - margin
zone.right  = imageX + width + margin
zone.top    = anchor.flow_y - margin
zone.bottom = anchor.flow_y + height + margin
```

`reflowAgainstWrapZones` walks every flow whose Y range overlaps
any wrap zone and re-runs `layoutBlock` with a `ConstraintProvider`
that, for each line's absolute Y, returns the **wider available
side**:

```
function constraintForLineY(absoluteY, lineHeight):
  for each zone whose [zone.top, zone.bottom] overlaps [absoluteY, absoluteY + lineHeight]:
    leftAvail  = max(0, zone.left  - contentX)
    rightAvail = max(0, contentRight - zone.right)
    if leftAvail > rightAvail and lineWidth fits in leftAvail:
      return { startX: contentX,  width: leftAvail }
    else if rightAvail > 0 and lineWidth fits in rightAvail:
      return { startX: zone.right, width: rightAvail }
    else:
      return { skipBelow: zone.bottom }   // line clears past the zone
  return null  // no constraint, full content width
```

Output line metadata always includes `constraintX` and
`effectiveWidth` whenever a constraint applied — even when the text
fit naturally inside the constrained width without wrapping. This
permits short paragraphs to render offset past a wrap zone.

Multiple overlapping wrap zones (rare): take the union — pick
whichever side has more room across all overlapping zones.

**Two-sided wrap (a single line spanning both sides of an image
with the image as a hole) is deferred — see `05-future.md`.**

### Top-bottom Flow

`top-bottom` emits no Stage 3 clearance. Its vertical flow is
represented by the anchored-object block emitted in Stage 1:

```
block.height     = image.height
block.spaceAfter = image.margin
```

Stage 2's `assignGlobalY` stacks following flows after that block
using normal margin collapsing. If Stage 3 later pushes the
top-bottom block to the next page or below another object, it
mutates that block's `globalY` and re-stamps downstream flows from
the next index. The followers move because they are downstream of
the block, not because a second clearance barrier is applied.

This keeps top-bottom flow single-sourced. A separate clearance
would duplicate `block.height + block.spaceAfter` and can drift
from the block spacing model.

`square` placements emit no clearance and no flow contribution.
Their effect on flow is the wrap zone alone. The anchor paragraph
remains in flow at its natural text height; the next paragraph's
`globalY` is computed from the anchor paragraph's text height, not
from the image's height. (If the image is taller than the anchor
paragraph's text, the wrap zone extends past the anchor paragraph's
bottom and constrains following paragraphs' line widths until the
zone's bottom is reached.)

## Stage 4 — Paginate against solver output (`paginateFlow`)

### Pagination contract

Pagination's authoritative answer for "where does this flow go"
is its `flow.globalY`, mapped into the page coordinate system.
Pagination MUST honour this.

Concretely, paginateFlow tracks `currentPageBottomGlobal` (the
current page's contentBottom in continuous global Y space) and:

1. **Cross-page advance.** Before placing any flow, advance pages
   while `flow.globalY >= currentPageBottomGlobal`. This applies
   even when the current page has no blocks yet — a flow whose
   solver-pushed globalY is on page 5 must paginate to page 5,
   leaving pages 1–4 empty if necessary. (For naturally-paginated
   docs without solver pushes, no flow has a globalY past its
   natural page, so this advance is a no-op.)

2. **In-page snap.** When the flow is not first on the current
   page, compute `pageLocalGlobalY = flow.globalY -
   pageStartGlobal + contentTop`. If `pageLocalGlobalY > naturalY`
   (where naturalY = `cursor + collapsedMargin`), snap targetY
   forward to `pageLocalGlobalY`. This honours in-page solver
   pushes (e.g. stacking realignment within a page).

3. **First-on-page exception (narrow).** When the flow is first
   on a fresh page AND its `globalY` maps naturally to the page
   start (i.e. `pageLocalGlobalY` is at or near `contentTop`),
   use naturalY = `contentTop` directly. This handles continuous
   globalY values for naturally-paginated blocks which include
   inter-page accumulation that pagination correctly resets at
   page boundaries.

   **Do NOT apply this exception when the solver has pushed the
   flow into the page interior.** If the flow's `globalY` puts
   it deep into a page (e.g. solver-pushed past several barriers
   plus an in-page realignment landing the flow at, say,
   page-local Y = 250), `pageLocalGlobalY` must be honoured even
   for the first block on that page. Releasing back to
   `contentTop` would silently violate the solver's intent.

   Implementation: detect "naturally placed" by comparing
   `pageLocalGlobalY` against `contentTop` with a small tolerance
   (one line height). Past that, treat as solver-pushed and
   honour `pageLocalGlobalY`.

Every page-advance branch (cross-page advance, hard page break,
leaf overflow, text split) must update `currentPageBottomGlobal`
by `nextPage.contentHeight`.

### Block placement

For each FlowBlock:

- Plain text/heading blocks: place at `targetY` (computed per the
  contract above), advance cursor by `height + spaceAfter`.
- Page-break nodes: flush current page, advance to next.
- Anchored-object blocks (produced by Stage 1's split): place as
  flow blocks with `height = image.height`. They occupy a
  paginated slot; the actual image rendering uses the placement
  from Stage 3.
- Long text blocks that cross a page boundary: split lines at
  the boundary, continue on the next page.

Output: `LayoutPage[]` with `LayoutBlock[]` placed in page-local
coordinates.

## Stage 5 — Attach anchored-object placements

Stage 3 already emits `AnchoredObjectPlacement` records in the
renderer's page-local coordinate shape:

```
page    ← placement.page
renderX ← placement.x
renderY ← placement.y
```

This stage only attaches those placements to the returned
`DocumentLayout`. It does not recompute Y from `anchorGlobalY`,
does not read a `placement.layoutY` field, and does not apply a
paint-only `floatOffset`.

The strongest invariant from `00-model.md` ("no following content
renders before its anchored object") holds by construction
because:

- Stage 3 placed the object at `anchor.globalY + (mode offset)`.
- Stage 3 pushed the anchor itself if needed so anchor and object
  share a page.
- Stage 4 paginated honouring Stage 3's globalYs.
- Stage 5 preserves Stage 3's emitted placement coordinates.

There is no Stage 6 to "patch" disagreements. If projection's
output ever places the object on a different page from the
anchor, the bug is in Stage 3 (anchor-push didn't fire) or
Stage 4 (pagination didn't honour globalY) — fix it there, never
re-shove in projection.

Output: `DocumentLayout` with `pages` (from Stage 4) and
`anchoredObjects: AnchoredObjectPlacement[]` (from this stage).

## Pipeline diagram

```
PM doc
  │
  ▼  Stage 1: buildBlockFlow
FlowBlock[] (normalize attrs; split paragraphs at top-bottom/behind/front anchors)
  │
  ▼  Stage 2: assignGlobalY
FlowBlock[] with globalY
  │
  ▼  Stage 3: solver loop (bounded fixed-point)
  │   ┌─ placeAnchoredObjects → may push anchor.globalY ─┐
  │   │                                                   │
  │   └─ reflowAgainstWrapZones ──────────────────────────┘
  │   converged when no push AND no reflow change
  │
SolverResult { placements, wrapZones, status, iterations }
  │
  ▼  Stage 4: paginateFlow (honours flow.globalY)
LayoutPage[] with placed blocks in page-local Y
  │
  ▼  Stage 5: projectAnchoredObjects (pure mapping)
DocumentLayout { pages, anchoredObjects }
```

## Edge cases the pipeline must handle

### Object taller than any page content area

`object.height > pageContentHeight`. Anchor-push gives no benefit
(no page can fit it). Place at the anchor's resolved Y on the
anchor's page, accept visual overflow. Skip the anchor-push step
when `barrier + height > nextBarrier` for all available barriers.

### Solver exhausts iterations without converging

Mark the result `status: "exhausted"`. Do not silently degrade by
discarding constraints. Surface the status in telemetry so
adversarial inputs are visible. Layout still completes — the
last iteration's output is consumed by Stage 4.

### Multiple anchors in the same paragraph

Stage 1 splits recursively for non-zero-flow modes (`top-bottom`,
`behind`, `front`). Stage 3 treats each anchored-object block
independently; stacking applies across them in document order.

`square` anchors in the same paragraph do not split — each contributes
its own wrap zone, and the paragraph's lines are constrained by
whichever zone overlaps each line's Y range (see
`01-placement-and-wrap-policies.md` § Multiple anchored objects in
one paragraph).

### Empty pages from anchor pushes

If anchor-push moves a flow forward past one or more page
barriers, the intermediate pages may end up empty. Pagination's
cross-page advance creates them as empty `LayoutPage` entries.
This is correct behaviour: the document semantically requires
the empty pages to honour the anchor's structural position.

## What this pipeline replaces

These were patterns from the prior CSS-float-style implementation;
they have **no place** in this pipeline:

- A second mini-pipeline that runs after pagination to re-shove
  floats and re-wrap text against new positions.
- A defensive "if the float overflows, move it to the next page
  without moving the anchor" branch in projection.
- Computing two parallel sets of float positions (one for layout,
  one for rendering) that have to be reconciled.
- `floatOffset.y` folded into structural placement so wrap
  geometry follows visual offset (the recently-broken-then-
  reverted "fuzz fix" — see `feedback_anchor_authoritative_model.md`).

If any of these patterns reappears, the implementation has drifted
from the model.
