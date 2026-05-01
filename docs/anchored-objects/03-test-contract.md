# 03 — Test Contract

This document pins the user-visible contract for anchored objects
as testable invariants. It is the executable verification layer
for the model in [`00-model.md`](./00-model.md), the placement
mechanics in [`01-placement-and-wrap-policies.md`](./01-placement-and-wrap-policies.md),
and the pipeline in [`02-layout-pipeline.md`](./02-layout-pipeline.md).

The principle: **invariants here are user-visible promises.**
If an invariant fails, the user sees a bug. Implementation
details (e.g. "the solver re-stamps globalY on push") are
verified incidentally — the contract tests do not assert them
directly.

## The universal contract

Every test in this contract derives from one rule:

```
For any anchored object O at docPos D, no document content with
a docPos > D may render at a (page, y) earlier than the position
where O's flow effect has been satisfied.
```

In words: following content never appears visually before the
anchored object it follows in document order.

A test that walks every paginated page, finds every wrapping
anchored object, and asserts no later-docPos block has a smaller
`(page, y)` is the **single bug-killer**. Once green, the entire
class of "image and text detached" / "text appears above its
image" / "click-the-image-jumps-to-wrong-page" bugs is
structurally impossible.

## Per-mode contracts

For each non-inline mode, a focused test pins the user-visible
behavior. Each must pass against the implementation defined by
docs `01` and `02`.

### Square — `xAlign: "left"`

```
Setup: paragraph A contains an anchored image (wrapMode: "square",
       xAlign: "left", w=200, h=250).
       paragraph B follows A with a long text run.
       Filler placed before A so the image lands near a page
       boundary.

Assertions:
  ▸ A and the visible image are on the same page.
  ▸ Anchor docPos is in paragraph A (anchor and image co-located).
  ▸ Image painted at x = contentX.
  ▸ B's first line y >= image.y - tolerance.
  ▸ B's lines whose y is within [image.y, image.y+image.height]
    have constraintX > 0 and effectiveWidth < contentWidth (text
    wraps on the right of the image).
  ▸ B's lines whose y >= image.y + image.height + margin
    use full content width.
  ▸ A's flow contribution is its text height — NOT image.height.
    (Square mode does not push following content past the image's
    bottom; following content wraps beside.)
```

### Square — `xAlign: "right"`

Mirror of `xAlign: "left"`:
- Image painted at `x = contentX + contentWidth - image.width`.
- B's constrained lines start at `contentX` and end before the
  image's left edge (text wraps on the left).

### Square — `xAlign: "center"`

```
Setup: paragraph A contains square image with xAlign: "center",
       w=200, h=250. contentWidth = 600. Long text in B.

Assertions:
  ▸ Image painted at x = contentX + (600-200)/2 = contentX + 200.
  ▸ B's lines in the image's Y range pick the WIDER side via
    wider-side wrap. With image centered, leftAvail = 200 - margin
    and rightAvail = 200 - margin (equal); deterministic tie-break
    picks the right side.
  ▸ Each constrained line lies entirely outside the image's
    horizontal range.
```

### Square — `xAlign: "custom"` with arbitrary `x`

```
Setup: square image with xAlign: "custom", x = contentX + 80,
       w=200, h=250. Long text in B.

Assertions:
  ▸ Image painted at x = contentX + 80 (clamped to keep image inside
    content area).
  ▸ B's lines in the image's Y range wrap on whichever side has
    more room (left = 80 - margin; right = contentWidth - 280 -
    margin; right wins → constraintX = image.right + margin).
```

### Top-bottom

```
Setup: paragraph A contains only a top-bottom image (h=200,
       xAlign: "left"). Paragraph B follows A with text. Filler
       placed so A lands near a page boundary.

Assertions:
  ▸ A and the visible image are on the same page.
  ▸ B's first line y >= image.y + image.height + margin.
  ▸ No line of B has constraintX or effectiveWidth set.
  ▸ A's flow contribution = image.height (block reserves full
    flow width).
```

### Behind

```
Setup: paragraph A contains only a behind image (h=200,
       xAlign: "left"). Paragraph B follows A with text.

Assertions:
  ▸ A and the visible image are on the same page.
  ▸ B's first line y >= image.y + image.height + margin (behind
    block takes its slot).
  ▸ B's lines have no constraintX or effectiveWidth set.
  ▸ Renderer paint order: image is drawn before B's text.
```

### Front

Identical to behind, except the renderer paint order reverses:
image is drawn after B's text.

### Inline-anchored split

```
Setup: paragraph P contains "BEFORE text" + image + "AFTER text".
       Image is non-inline (e.g. top-bottom, h=150).

Assertions:
  ▸ Layout produces three flow blocks for P, in document order:
      - fragment with "BEFORE" text
      - anchored-object block for the image
      - fragment with "AFTER" text
  ▸ For top-bottom mode: the three stack vertically (each begins
    at the previous one's bottom + collapsed margin).
  ▸ For square modes: text-after's first line shares the image's
    flow_y and is constrained by the image's wrap policy.
  ▸ The PM document is unchanged — the source paragraph remains
    one node.
```

### Multi-image stacking

```
Setup: two top-bottom anchored objects (h=200 each) with
       paragraphs between them, placed near a page boundary so
       the second cannot fit on the first's page.

Assertions:
  ▸ Each object's anchor docPos lands on the same paginated
    page as the object itself (anchor follows displacement).
  ▸ The second object's globalY >= first object's globalY +
    first.height + margin (anchored-object block spacing applied).
  ▸ Universal contract holds across all blocks.
  ▸ For square-mode multi-image: see `01-placement-and-wrap-
    policies.md` § Stacking semantics — square images do not
    cross-stack vertically; if their wrap zones horizontally
    overlap, lines resolve against whichever zone they hit
    first.
```

### Universal contract across mixed modes

```
Setup: a doc that mixes square (with various xAlign values),
       top-bottom, behind, front, and inline modes in arbitrary
       order.

Assertion: the universal contract holds for every anchored
object in the document.

Behind and front do not impose wrap constraints. They still
participate in normal flow — their block occupies vertical
space and pushes following content via the standard pagination
cursor advance. They are included in the universal contract
through their flow contribution (the slot they occupy), not
through wrap behavior.
```

## Geometry invariants

Hold on every `DocumentLayout`, regardless of input shape:

1. **Monotonic block Y within each page.**
   `page.blocks[i].y >= page.blocks[i-1].y` for all i > 0.

2. **Vertical overlap between flow blocks is permitted only by
   the square-wrap rule.**
   Two flow blocks may overlap vertically only when:
   - one is a square-mode anchored-object block, and
   - the other is a content fragment whose lines are constrained
     to the non-overlapping horizontal region defined by the
     wrap zone (`constraintX` and `effectiveWidth` set such that
     the line lies entirely outside the anchored-object block's
     horizontal footprint).

   Any other vertical overlap is a bug — including two
   square-mode anchored-object blocks overlapping each other,
   two content fragments overlapping each other, or a
   constrained line whose horizontal extent crosses into the
   wrap zone.

3. **Anchored-object blocks are within page content area.**
   `block.y >= contentTop && block.y + block.height <=
   contentBottom`, except for the documented oversized-object
   edge case (`object.height > pageContentHeight`).

4. **Constraint metadata round-trip.**
   For every line whose Y range overlaps a wrap zone on the same
   page, the line carries `constraintX` and `effectiveWidth` such
   that `block.x + constraintX + line.width <= zone.x` (for
   right-wrap on a square-left object) or analogous for
   square-right.

5. **Wrap zones do not overlap their associated object.**
   For a `square-left` object, `zone.right = object.right +
   FLOAT_MARGIN`; constrained lines start at `zone.right`. For
   `square-right`, `zone.left = object.left - FLOAT_MARGIN`;
   constrained lines end at `zone.left`.

## Solver invariants

Hold across iterations of Stage 3:

1. **Flow-anchor monotonicity.**
   Within a single solver run, every flow's `globalY` is
   non-decreasing across iterations. Every flow-anchored object's
   internal `objectGlobalY` is non-decreasing across iterations.
   Neither value ever moves backward. **This guarantees convergence
   and prevents oscillation.**

   This is not a cross-run persistence rule. A fresh layout after
   an edit may place the same docPos at a lower `globalY` if earlier
   content was deleted.

2. **Flow-anchor push monotonicity.**
   For every flow-anchored object O, the anchor's resolved
   `globalY` is non-decreasing across iterations and is always
   `>= its original Stage 2 position`. The anchor never moves
   backward within that solver run — neither relative to a prior
   iteration nor relative to its initial assignment. This guarantees:
   - no backward jumps
   - no unstable anchor movement
   - placement consistent with user expectations

   Future page-anchored objects are explicitly outside this invariant.
   Their placement is derived from a page barrier plus page-relative
   offset; if prior document content is deleted, that barrier may move
   backward between layout runs and the object's resolved `globalY`
   may move backward with it. F1 tests must assert per-run stability
   and page-relative preservation, not doc-flow anchor monotonicity.

3. **Wrap-zone locality.**
   A wrap zone only affects flows whose `globalY` range overlaps
   the zone's vertical extent. Flows entirely outside the zone
   must remain unconstrained (no `constraintX` /
   `effectiveWidth` set). This catches:
   - ghost constraints (lines narrowed by a zone they don't
     intersect)
   - stale constraint metadata after the solver moved a flow
     out of a zone

4. **Termination.**
   The solver returns `status: "stable"` or `status:
   "exhausted"`. Exhaustion is logged and surfaced; tests with
   real-doc inputs (see "What to fuzz" below) must converge to
   `stable`.

5. **Anchor / object same page (wrap modes only).**
   At convergence, for every anchored object O with mode in
   `{square-left, square-right, top-bottom}`:
   `O.anchorPage === O.page`.
   This is the page-level expression of the universal contract.

6. **Idempotence.**
   Running the pipeline twice on the same input produces
   identical layout (same hash). No accumulated state across
   runs.

## Pagination-contract invariants

Hold on every paginated layout:

1. **Cross-page advance fires when needed.**
   No flow placed at page-local Y where its `globalY` would
   require a later page. Specifically: for every placed block,
   `block.globalY >= currentPageBottomGlobal` was false at
   placement time.

2. **In-page push honoured.**
   When the solver pushed a flow's `globalY` in the page
   interior (e.g. stacking realignment), pagination's
   `targetY >= pageLocalGlobalY` for that flow.

3. **First-on-page exception is tied to solver intent.**
   The exception applies only when the flow's `globalY` maps
   naturally to the page start (`pageLocalGlobalY` at or near
   `contentTop`, within one line-height tolerance). If the
   solver has pushed the flow into the interior of the page,
   pagination must honour the solver's position even for the
   first block on that page — `pageLocalGlobalY` wins, not
   `contentTop`. Releasing a solver-pushed flow back to
   `contentTop` would silently violate the solver's intent and
   re-open the class of "anchor on different page from object"
   bugs.

## Required failing-baseline tests

When implementing Stage 3, write these tests **first**, expect
them to fail, then build the solver to make them pass. They
form the executable spec.

| # | Test | Pins |
|---|---|---|
| 1 | `square` `xAlign: "left"` standalone near page bottom | universal contract, anchor co-located, wider-side wrap (right) |
| 2 | `square` `xAlign: "right"` standalone near page bottom | mirror of 1 (wider-side wrap on left) |
| 3 | `square` `xAlign: "center"` with long text | both-side availability + wider-side tie-break |
| 4 | `square` `xAlign: "custom"` with arbitrary x | clamping, wider-side wrap, anchor co-located |
| 5 | `top-bottom` standalone near page bottom | block spacing + same page |
| 6 | `behind`: anchor and image on same page, layout unaffected by paint order | per-mode behind |
| 7 | `front`: same as 6 with paint reversed | per-mode front |
| 8 | inline-anchored `top-bottom` splits paragraph into three flow blocks | Rule 2, top-bottom |
| 9 | inline-anchored `square` does NOT split paragraph | Rule 2 narrowing |
| 10 | multi-image stacking — each follows its own anchor, no detachment | stacking + universal |
| 11 | universal contract across mixed modes in one doc | the bug-killer |
| 12 | drag horizontally → setNodeAttrs(`xAlign:"custom"`, `x`) only; no moveNode | drag mechanics, anchor co-location |
| 13 | drag vertically → moveNode only; no setNodeAttrs | drag mechanics |
| 14 | drag diagonally → both in one transaction; layout sees one consistent state | drag mechanics atomicity |
| 15 | legacy `wrappingMode: "square-left"` normalizes to `wrapMode: "square", xAlign: "left"` on read | attribute compatibility |

Once these pass, the model and pipeline are verified at the
contract level.

## What to fuzz, and what NOT to fuzz

### Useful fuzz

Random documents whose **shape resembles real user input**:

- Mostly text paragraphs, with anchored objects at realistic
  density (~10% of paragraphs, not 60%).
- Wrap mode chosen with realistic distribution (mostly inline +
  top-bottom, occasionally square modes, rarely behind/front).
- Image sizes within the content area's reasonable bounds (not
  uniformly random over `[50, 550]`).
- `floatOffset` either zero or small (single-digit pixels), not
  uniformly distributed over `[-100, 100]`.

This kind of fuzz catches real bugs without over-driving the
design.

### Not-useful fuzz

Random documents with extreme synthetic parameters:

- Density >40% anchored objects per paragraph.
- Uniform-random image sizes including ones taller than any
  page.
- Uniform-random `floatOffset` values up to ±100 px.
- Mode mix that ignores realistic distribution.

These find synthetic edge cases that are not user bugs. A failure
here is **not** evidence of a layout problem — it is evidence
that the fuzz is generating input the design correctly does not
optimize for. Document the limit; do not bend the design.

(See `feedback_fuzz_overfit_risk.md` in memory for the history
of why this distinction matters.)

## Test categories

| Category | What it verifies | When it runs |
|---|---|---|
| **Contract** | per-mode + universal invariants | every CI run |
| **Geometry** | no-overlap, monotonic, in-bounds | every CI run |
| **Solver** | monotonicity, termination, idempotence | every CI run |
| **Pagination** | cross-page advance, in-page snap, first-on-page | every CI run |
| **Visual** | drag UX, paint layer order, render correctness | manual + screenshot diff |
| **Realistic fuzz** | random docs with real-shape distribution | nightly |
| **Synthetic fuzz** | random docs with extreme parameters | excluded — see above |

## What this contract does NOT cover

These exist but are out of scope here:

- Pixel-perfect rendering correctness (covered by visual /
  screenshot tests).
- Performance / iteration counts (covered by perf benchmarks).
- Cursor / selection / IME behavior near anchored objects
  (covered by input + character-map tests).
- Export round-trip (covered by export test suites — separate
  responsibility).

This doc covers **layout-level** correctness only. If a layout
is contract-correct but renders blurry or types weirdly, that's
a different doc's contract.

## References

- [`00-model.md`](./00-model.md) — definitions used by every
  invariant.
- [`01-placement-and-wrap-policies.md`](./01-placement-and-wrap-policies.md)
  — per-mode geometry that the per-mode tests verify.
- [`02-layout-pipeline.md`](./02-layout-pipeline.md) — the
  pipeline whose outputs these invariants check.
