# 05 — Future Work and Deferred Scope

This document catalogs features and capabilities that exist in
mature word processors (Word, Google Docs, Pages) but are
**explicitly out of scope for v1** of the anchored-object model.

The purpose of this doc is **discipline**, not roadmap. Each
deferred feature has a sketch of what it would add — but more
importantly, the **invariants from v1 that any future addition
must not violate**. When a future feature looks like it would
require breaking the model, the right answer is almost always
"reshape the feature," not "break the model."

## The discipline rule

Any future feature must satisfy all of:

1. The universal contract from [`00-model.md`](./00-model.md):
   no document content with a docPos > D may render at a
   `(page, y)` earlier than the position where O's flow effect
   has been satisfied.
2. The pipeline non-negotiables from [`02-layout-pipeline.md`](./02-layout-pipeline.md):
   Stage 3 is authoritative; no post-pagination patching; one
   source of truth per coordinate.
3. The edit-UX rule from [`04-edit-ux.md`](./04-edit-ux.md):
   editing changes structure; offsets only change paint.

A feature that requires a new coordinate system, a new
post-pagination patch step, or a new "edit by writing offset"
path is **not ready to add** — it needs to be reshaped until it
fits.

### Single-authority invariant

```
All layout decisions — placement, wrap, clearance, anchor
position — are resolved in Stage 3. No future feature may
introduce a second stage that modifies flow positions after
pagination.
```

This is the architectural lockbox: the prior CSS-float
implementation drifted because each new feature added a
half-pipeline of post-pagination patching. Every future addition
either fits inside Stage 3's loop or gets reshaped until it
does. Two authorities means two truths, which means
reconciliation, which means the v2 attempt's class of bugs.

## Deferred — anchored-object features

### F1. Page-anchored objects

**What it adds.** An anchored object that pins to a specific
**page** rather than to flow content. As the user types, the
anchor paragraph may move across pages, but the object stays
on its page. Used for headers, watermarks, page-relative
images.

**Why deferred.** v1 only supports anchor-follows-flow. Page
anchoring needs a separate position type, separate solver
input, and separate cursor / drag semantics. Most v1 cases
(images embedded in flowing content) work fine without it.

**Constraints any implementation must preserve:**

- The existing five wrap modes (`square-*`, `top-bottom`,
  `behind`, `front`, plus `inline`) keep their current flow-
  follows-anchor semantics. Page-anchoring is a new ortho-
  gonal axis, not a replacement.
- Page-anchored objects must declare a wrap effect from the
  same set; no new wrap modes.
- The universal contract changes shape: for page-anchored
  objects, "following content does not render before the
  object" applies on the **page** the object is pinned to,
  but the object is no longer in the document order's flow.
  The contract for flow-anchored objects (the v1 set) does
  not change.

**Likely implementation sketch.** Add `anchorMode:
"flow" | "page"` attribute on the image node. Stage 3 partitions
inputs into flow-anchored and page-anchored sets. Both partitions
are resolved **inside Stage 3** — there is no separate
post-pagination solver:

- Flow-anchored inputs use `anchor.flow.globalY` as today.
- Page-anchored inputs use a **page-relative Y** derived from
  the page barriers Stage 3 already computes (each barrier
  defines a page's contentTop / contentBottom in continuous
  global-Y space; a page-anchored object's resolved Y is
  computed from its target page's barrier plus an offset).

Both flow- and page-anchored placements are emitted from the
same Stage 3 result. Pagination consumes them; projection maps
them. Stage 5 still emits placements; renderer treats both kinds
the same. The single-authority invariant is preserved.

### F2. Image splitting across pages

**What it adds.** A flow-anchored image whose intrinsic height
exceeds the page content area splits visually across pages —
the top portion renders on page N, the bottom portion continues
on page N+1, with the image's content continuous.

**Why deferred.** v1 falls back to "render at anchor's page,
accept visual overflow." This is acceptable for most images
(few are taller than a page) but obviously inferior for charts
or full-page diagrams.

**Constraints any implementation must preserve:**

- Splitting is a **render** decision, not a flow decision.
  The image is still one anchored-object block in flow with
  one anchor docPos.
- The block's `height` in flow can exceed the page content
  area; pagination handles the cross-page rendering by
  emitting a continuation fragment on the next page (the
  same mechanism long paragraphs use today).
- Wrap zones for split images apply on every page the image
  spans, but only for the portion of the image visible on that
  page.
- The universal contract does not change. Following content
  still must not render before the image's flow effect is
  satisfied — which now spans multiple pages.
- **Per-page contract:** each page fragment of a split image
  must independently satisfy the universal contract relative
  to content on that page. A split image cannot become a way
  to leak content "above" its rendered position on any page
  it appears on.

### F3. Anchor independent of the cursor's paragraph

**What it adds.** Word lets users drag an image's visual position
without moving its anchor — and lets users drag the anchor
indicator (a separate UI affordance) without moving the visual.
The result is "anchored to paragraph X, but visually positioned
relative to page Y at coordinates Z."

**Why deferred.** This is exactly the kind of two-channel
position model that broke the v2 attempt. Adding it without
extreme care invites the projection-patches-anchor-mismatches
class of bugs back. It's also a feature most users don't reach
for; the structural-drag UX from v1 covers the common cases.

**Constraints any implementation must preserve:**

- `floatOffset.x / y` must remain a small visual nudge, NOT
  the channel through which independent anchor positioning
  is implemented. Independent positioning needs its own
  attribute pair (e.g. `pageOffset.x / y`) with explicit
  semantics that include solver awareness.
- The model gains a new positioning mode; the existing modes
  (flow-follows-anchor) are unchanged.
- The drag UX gains an explicit "detach anchor" action with
  visible UI; the default drag still moves the structural
  anchor.
- The pipeline's Stage 3 must compute placements that respect
  the explicit detached position while still emitting wrap
  zones consistent with the painted image position. (This is
  the hard part — the wrap zone needs to follow the painted
  position, not the structural anchor, only for objects that
  have explicitly opted into independent positioning.)
- **No paint-to-layout coupling.** Independent positioning
  must NOT allow wrap zones to be driven by paint offsets
  (`floatOffset`). Any positioning that affects wrap geometry
  is **structural** and must be expressed as explicit Stage 3
  inputs (e.g. a separate `pageOffset.x / y` attribute pair
  whose values are read by the solver, not just the renderer).
  This prevents the offset-driven constraint drift class of
  bugs that broke the v2 attempt.

### F4. Tight / through wrap (non-rectangular wrap zones)

**What it adds.** Wrap zones follow the image's alpha shape
rather than its bounding rectangle. Tight wrap fits text against
the image's silhouette; through wrap goes further and lets text
flow into transparent regions inside the image.

**Why deferred.** v1's wrap zones are rectangles
(`x, right, top, bottom`). Tight/through requires per-line
geometry queries against the image's mask, plus rasterization
or vector-path support. The implementation is complex and the
visual benefit is modest for most documents.

**Constraints any implementation must preserve:**

- The wrap-zone abstraction in Stage 3 may be extended (e.g.
  `WrapZone | WrapShape`) but the constraint provider
  protocol stays line-by-line: given a line's Y range, return
  `(x, width)`.
- The universal contract is unchanged; lines still don't
  cross into the wrap zone.
- Square modes' rectangular wrap remains the default;
  tight/through is an opt-in mode flag, not a global change.

### F5. Multiple anchors per object (rare)

**What it adds.** Word does not support this. Listing it for
discipline: a single image with multiple anchor docPositions
would mean ambiguous flow position. Unsupported now, unsupported
forever in v1's model.

**Decision.** Permanent reject. The model rests on "one
anchored object, one anchor in flow." Drop this from any future
proposal that surfaces it.

### F6. User-defined wrap zones

**What it adds.** A user manipulates the wrap zone shape
directly (drag corners, draw paths) independent of the image
itself.

**Why deferred.** Niche. Power-user feature. Tight / through
(F4) covers most of what users actually want.

## Deferred — UX features

### F7. Touch / pointer specifics

Tablet drag, pinch resize, two-finger rotate — all out of scope
for v1. The desktop drag model from `04-edit-ux.md` covers the
single-pointer case. Multi-pointer and gesture support layers
on top without changing the structural-drag rule.

### F8. Accessibility — keyboard-only object manipulation

Selecting, moving, resizing, and toggling modes via keyboard
alone (no pointer) is part of the broader accessibility plan,
not the v1 anchored-object scope. Constraints that any a11y
implementation must respect:

- Keyboard moves are structural moves (apply the drag model
  rule: edit changes structure).
- Mode-toggle keyboard shortcuts go through the same code path
  as the menu; layout reruns the same way.
- Screen-reader announcements describe the **structural**
  anchor position, never the painted offset.

### F9. Collaborative editing

Concurrent users dragging the same image, or one user dragging
while another types into the anchor paragraph, is covered by
the collaboration plan. Constraints:

- Drag transactions are normal PM transactions (move node from
  docPos A to docPos B). Yjs / OT replays them like any other
  transaction. No special anchored-object collaboration path.
- `floatOffset` writes are also normal attribute updates. No
  conflict resolution beyond standard last-writer-wins on
  attributes.
- The universal contract holds locally for each replica's
  view of the document; once the document state syncs, the
  contract holds for the converged state.

## Permanently out of scope

Things that look related but are explicitly **not** part of
the anchored-object model now or in any future version:

- **Floating frames / textboxes** — these are containers, not
  anchored objects. Different feature, different model.
- **Marginalia / pull-quotes** — these are page-region content,
  closer to F1 (page-anchored) but with editable content. Not
  in v1, possibly never in this model.
- **CSS-style float behavior** — the v1 model deliberately
  rejects "lift out of flow" because doing so violates the
  core thesis from `00-model.md`: anchored objects are flow
  participants. CSS floats are by definition not flow
  participants — they are removed from flow and painted as
  overlays. Any feature that needs that semantic needs to be
  reshaped into a flow-participant form (F1 page-anchored
  objects, F4 tight wrap, or a wrap-mode extension).
  Reintroducing CSS-float semantics is permanently rejected,
  not deferred.
- **Reflowing the entire document on a single pixel of drag**
  — even if drag is structural, debounce to avoid relayout
  storms during continuous drag. This is performance, not
  model.

## How to propose a new feature

When adding a feature in the future:

1. **Write a one-line statement** of what user need it serves.
2. **Show how it satisfies the discipline rule.** If a clause
   fails, the feature is not yet shaped right.
3. **Identify the new attribute(s)**, if any, and where they
   live (node attrs, mark attrs, separate registry).
4. **Specify the wrap effect** in terms of the existing
   primitives (`WrapZone`, `FlowClearance`) or extend them
   explicitly. New primitives must not duplicate existing
   ones.
5. **Update `00-model.md` first**, before pipeline or test
   doc changes. The spine is the contract; everything else
   inherits.
6. **Add tests for the universal contract** specialized to
   the new feature (if applicable). Failing-baseline first.
7. **Identify which invariants from
   [`03-test-contract.md`](./03-test-contract.md) the feature
   stresses**, and explicitly demonstrate they still hold.
   This includes the geometry invariants (no spurious overlap),
   solver invariants (monotonicity, anchor monotonicity,
   wrap-zone locality, termination, same-page guarantee,
   idempotence), and pagination-contract invariants. A feature
   proposal without this explicit walk-through is incomplete.

The spine documents (`00`–`04`) are the model's source of
truth. New features extend them; new features don't replace
them.

## References

- [`00-model.md`](./00-model.md) — the v1 model whose
  invariants must hold for every future addition.
- [`02-layout-pipeline.md`](./02-layout-pipeline.md) §"What this
  pipeline replaces" — patterns that must not return.
- [`04-edit-ux.md`](./04-edit-ux.md) §"UX anti-rules" — drag
  patterns that must not return.
- `feedback_anchor_authoritative_model.md` (memory) — the
  architectural learnings that produced the v1 model.
- `feedback_fuzz_overfit_risk.md` (memory) — the gotcha that
  led to ditching the v2 branch and starting fresh.
