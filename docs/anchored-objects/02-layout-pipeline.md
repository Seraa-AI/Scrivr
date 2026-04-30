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

**Inline-anchored split** (Rule 2 of `00-model.md`): if a
paragraph contains one or more non-inline anchor spans, normalize
it into a sequence of FlowBlocks alternating between text
fragments and anchored-object blocks:

```
paragraph: [text-A] [anchorA] [text-B] [anchorB] [text-C]
                ↓
flows:     fragment(text-A)
           anchored-object-block(A)
           fragment(text-B)
           anchored-object-block(B)
           fragment(text-C)
```

The split is recursive across all non-inline anchors in the
paragraph. `inline`-mode images are NOT split out — they remain
inline content of the parent fragment.

Each FlowBlock carries enough metadata to reconstruct doc
position (`sourceNodePos`, `partKind`, `splitAnchorDocPos`) so
the renderer can map fragments back to their source paragraph
for cursor and selection.

Output: `FlowBlock[]` with `lines` and `height` measured at
unconstrained content width.

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

### Outputs

A `SolverResult`:

```
placements:  AnchoredObjectPlacement[]   — { docPos, mode, x, y, width, height, paint }
wrapZones:   WrapZone[]                  — { side, x, right, top, bottom, anchorDocPos }
clearances:  FlowClearance[]             — { afterFlowIndex, y, anchorDocPos }
status:      "stable" | "exhausted"
iterations:  number
```

The pipeline does **not** retain a separate `FloatLayout` type
that participates in projection — placements are emitted once
here and projection is a pure mapping (Stage 5).

### Algorithm (bounded fixed-point loop)

```
loop max N iterations (default: 8):
  barriers ← computePageBarriers(flows, pageConfig)

  for each input in document order:
    object.layoutY ← anchor.globalY
    object.layoutY ← applyBarrier(object.layoutY, height, barriers)
    object.layoutY ← applyStacking(object.layoutY, prior placements)
    if anchor.globalY < object.layoutY:
      anchor.globalY ← object.layoutY      # the unified push rule
      recomputeGlobalY(flows, anchorIndex + 1)
      anchorPushed ← true

  applyClearances(flows, result.clearances)   # top-bottom only
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
anchor.globalY = max(anchor.globalY, object.layoutY)
```

`object.layoutY` is the resolved Y of the anchored object after
`placeAnchoredObjects` has applied barrier and stacking logic.
The anchor follows whatever increases the object's Y.

After any push, `recomputeGlobalY(flows, anchorIndex + 1)`
re-stamps downstream flows; the outer loop re-iterates.

The two contributors to `object.layoutY > anchor.globalY` are:

1. **Barrier overflow.** The block's footprint (`anchor.globalY →
   anchor.globalY + height`) extends past the anchor's page
   barrier, AND the block would fit on the next page. The placer
   moves `object.layoutY` to the barrier. Skip the move if the
   block wouldn't fit on the next page either (oversized object,
   handled per Edge cases below).

2. **Stacking.** The block was pushed below a previously-placed
   wrapping object's bottom because their wrap footprints overlap.
   The placer moves `object.layoutY` to the stacked Y.

After either contributor moves `object.layoutY`, the anchor-push
rule fires automatically (`anchor.globalY := max(...)`). This
unifies the previous "three triggers" framing into a single
invariant.

### Monotonicity guarantee

The solver is monotonic across iterations:

- `anchor.globalY` only ever increases.
- `object.layoutY` only ever increases.

This guarantees termination and prevents oscillation bugs
(anchor pushed forward then released, then re-pushed). The
iteration cap is a safety net for adversarial inputs, not a
correctness mechanism.

### Wrap zones (square modes)

For each `square-left` / `square-right` placement, emit a
`WrapZone`:

```
zone.side   = "left" | "right"
zone.x      = block.left  (square-left) or contentX        (square-right)
zone.right  = block.right (square-left) or block.right     (square-right)
zone.top    = block.y - FLOAT_MARGIN
zone.bottom = block.y + height + FLOAT_MARGIN
```

`reflowAgainstWrapZones` walks every flow whose Y range overlaps
any wrap zone and re-runs `layoutBlock` with a `ConstraintProvider`
that returns the narrower line width and offset for each line's
absolute Y. Output line metadata always includes `constraintX`
and `effectiveWidth` whenever a constraint applied — even when
the text fit naturally inside the constrained width without
wrapping. This is what permits short paragraphs to render offset
past a left float.

### Clearances (top-bottom only)

For each `top-bottom` placement, emit a `FlowClearance`:

```
clearance.afterFlowIndex = anchorIndex
clearance.y              = block.y + height + FLOAT_MARGIN
```

`applyClearances` walks following flows in order and pushes any
flow whose `globalY < clearance.y` to `clearance.y`, then
re-stamps downstream globalYs. This handles cases where
solver-induced anchor pushes shift the top-bottom block after
its initial Stage 2 placement and downstream flows need to
follow.

`behind` and `front` placements emit **no clearance**. They
participate in flow only by occupying their own block slot
(`height = image.height` set in Stage 1, accounted for by Stage
2's `assignGlobalY`). They impose no additional constraint on
following content. This is the explicit non-influence rule for
behind/front — text near them flows as if they were absent
beyond the slot they take.

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

## Stage 5 — Project to page-local coordinates (`projectAnchoredObjects`)

Projection is a **pure mapping**.

For each `AnchoredObjectPlacement` from Stage 3:

```
anchor       ← anchorMap.get(placement.docPos)        // built from paginated pages
delta        ← placement.layoutY - placement.anchorGlobalY
renderY      ← anchor.blockY + delta + floatOffset.y   // visual offset paint-only
renderX      ← placement.layoutX + floatOffset.x
page         ← anchor.page                              // anchor and object same page (Stage 3 guarantees)
```

The strongest invariant from `00-model.md` ("no following content
renders before its anchored object") holds by construction
because:

- Stage 3 placed the object at `anchor.globalY + (mode offset)`.
- Stage 3 pushed the anchor itself if needed so anchor and object
  share a page.
- Stage 4 paginated honouring Stage 3's globalYs.
- Stage 5 reads the paginated anchor position and emits the
  matching object position.

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
FlowBlock[] (split paragraphs at non-inline anchors)
  │
  ▼  Stage 2: assignGlobalY
FlowBlock[] with globalY
  │
  ▼  Stage 3: solver loop (bounded fixed-point)
  │   ┌─ placeAnchoredObjects → may push anchor.globalY ─┐
  │   │                                                   │
  │   └─ applyClearances → reflowAgainstWrapZones ────────┘
  │   converged when no push AND no reflow change
  │
SolverResult { placements, wrapZones, clearances, status, iterations }
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

Stage 1 splits recursively. Stage 3 treats each anchored-object
block independently; stacking and clearances apply across them
in document order.

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
