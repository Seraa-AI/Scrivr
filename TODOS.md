# TODOs

Originally captured from `/plan-eng-review` of `docs/anchored-objects/` on
2026-05-01. The architecture moved differently than that review anticipated
— the "4A solver loop refactor" never happened; the codebase went
rect-driven (per-page `ExclusionManager`, `LineSpace.segments[]`,
`yOffset` as paint truth) instead. Items below are pruned to what is
still load-bearing under the current model.

## Recently completed

- **yOffset redesign Phases 1–6** plus same-page re-anchor and cross-page
  exact-position drop polish — landed in PRs #58 and #59.
- **`zIndex` paint/hit-test ordering** — landed in #59.
- **Top-bottom FlowBlock rip-out (Phase 5 V2)** — landed in #59.
- **`pageRectsDigest` pagination cache invalidation** — landed in #59
  with tests.
- **Test-11A** universal contract test (5 invariants) — landed in #58.
- **Cache invalidation test for changed wrap zone** (originally #19) —
  covered by `Phase 1b does not copy a cached tail after a changed square
  zone overlaps it` plus the new `pageRectsDigest invalidation` suite.
- **Stale-mark legacy CSS-float docs** (originally #1 / #25) — landed in
  this PR.

## Open items

### Correctness & coverage

#### Behind/front Word-aligned tests (was #16, P1)

**What.** Tests pinning Word-aligned behind/front semantics: no flow
contribution, no wrap zone, no Rule 2 split, painted at
`(anchor.flow_y, resolveX(...))`. Asserts text flows past the image as if
it weren't there.

**Why.** Spec corrected during yOffset work but the test contract for the
new behaviour isn't part of Test-11A's scope. Without specific tests,
behind/front behaviour could regress silently.

**Effort.** ~2 hr / ~40 LOC.

#### Test-11A maintenance (was #24, P1)

**What.** Test-11A asserts 5 invariants (ordering, visited count,
uniqueness, exactly-one-placement-per-anchor, anchor-same-page). Maintain
as the layout's primary correctness gate. When new wrap modes or split
rules are added, extend Test-11A's setup but never weaken its assertions.

**Why.** Test-11A is the bug-killer test. Weakening it re-opens the v2
bug class.

**Effort.** Convention rule, not work.

#### Measure-cache key audit for segmented reflow (was #8)

**What.** Verify `measureCache` is keyed on available segment geometry so
a paragraph laid out unconstrained at width 600 doesn't return the wrong
cache hit when re-laid out inside segmented line space.

**Why.** Bug class: text wraps wrong on second iteration because cached
measurements for unconstrained width get reused. Verification is cheap;
the fix (if needed) is non-trivial.

**Effort.** Read-the-key first, then size.

### Performance

#### Layout perf benchmark (was #14, P2)

**What.** New file `packages/core/src/layout/PageLayout.bench.ts` using
vitest's bench API. Cases: empty doc, 10-anchor doc, 100-anchor doc,
1000-paragraph pure-text doc. Each case asserts under a target ms
threshold.

**Why.** No layout perf regression detector exists. Future regressions
ship silently. This is the cheap version of #21 (production metric).

**Effort.** ~3 hr / ~50 LOC.

#### Reflow caching for constrained re-runs (was #6)

**What.** `reflowFlowsAgainstExclusions` calls `layoutBlock` per
overlapping flow per anchor. Cache constrained line metrics keyed on
`(node, line-space segment geometry)` so unchanged exclusions don't
re-measure.

**Why.** Square-image-heavy pages currently dominate layout cost. The
hot path is well-defined now that the rect model is settled.

**Effort.** Medium — cache invalidation needs care.

### UX & input

#### PointerController pointer capture during drag (was #13, P2)

**What.** PointerController calls `setPointerCapture(pointerId)` on
dragstart and ignores subsequent `pointerdown` until release. Closes the
double-click rapid-drag race.

**Why.** Spec's "one atomic transaction" rule for drag depends on no
mid-drag races. Without pointer capture, two transactions can fire.

**Effort.** ~1 hr / ~5 LOC + test.

#### Run /plan-design-review on edit UX (was #22, P2)

**What.** Before implementation work on the mode-toggle / alignment
toolbar / drag preview UI lands, run `/plan-design-review` on
`docs/anchored-objects/04-edit-ux.md`. Catches AI slop / generic UI
patterns.

**Why.** v1 ships 5 wrap modes + 4 alignments + drag UX. Without a
design pass, the toolbar/menu UX risks feeling generic.

**Effort.** ~30 min review session.

#### DESIGN.md for Scrivr (was #23, P3)

**What.** Run `/design-consultation` to produce a `DESIGN.md` capturing
typography, colour, spacing, motion, brand voice.

**Why.** Without a design source-of-truth, every new feature reinvents
visual language.

**Effort.** ~half day / ~30 min consultation + writeup.

### Observability

#### Anchored-object debug overlay renderer (was #20, P3)

**What.** Opt-in overlay (e.g., `editor.config({ debug: { anchoredObjects:
true } })`) that paints wrap zones, anchor positions, and clamped/re-anchor
markers on top of the canvas.

**Why.** The debug API surfaces state via JS; the overlay surfaces it
visually. When debugging "why does this look weird," visual is faster
than JS introspection.

**Effort.** ~half day / ~80 LOC.

#### Production layout-time metric (was #21, P3)

**What.** Editor emits `layout:complete` event with
`{ duration_ms, anchoredObjectCount, reflowCount }` after every
`runPipeline`. Consumers wire to their observability stack.

**Why.** A bench (#14) catches regressions in CI; this catches them in
real user docs.

**Effort.** ~1 hr / ~10 LOC.

### Spec hygiene

#### Vocabulary quick-reference card in `00-model.md` (was #3)

**What.** One-page reference card at the top of 00 listing the vocabulary
terms.

**Why.** Reading 02 currently requires holding all of them in head
simultaneously.

**Effort.** Cheap — one section.

#### Constraint metadata invariant rewrite — `03 § Geometry invariants § 4` (was #4)

**What.** Rewrite invariant #4 ("Constraint metadata round-trip") to
cover all four `xAlign` values (left, right, center, custom).

**Why.** Current phrasing implies left/right are the only cases.

#### `resolveX` DRY — single definition in `01`, cross-ref from `02` (was #5)

**What.** `01 § Resolved horizontal X` defines the function once.
`02 § Wrap zones` and `02 § Stage 3 inputs` link rather than re-state.

**Why.** Three near-identical definitions; if 01 changes, 02 must track.

### Migration / deprecation (low priority)

#### Migration tool — `scripts/migrate-anchored-attrs.ts` (was #10)

**What.** One-shot command that reads legacy `wrappingMode` /
`square-left` / `square-right` / `floatOffset` attrs and writes the
canonical `wrapMode` / `xAlign` / `x` / `yOffset` attrs, clearing
the legacy ones.

**Why.** Lets the codebase eventually drop the read-time normalisation
shim in `normalizeImageAttrs`.

**Effort.** ~half day. Not gating anything.

## Subsumed by the rect-driven model (closed without action)

These items assumed the "4A solver loop" framing and don't apply to the
shipped architecture:

- ~~Stage3Continuation for incremental streaming~~ — no Stage 3 to
  continue under the rect-driven path.
- ~~Solver invariant tests (monotonicity proof)~~ — no iterative solver.
- ~~`solverPushed` flag unit tests pinning each push branch~~ — flag
  still exists but is not part of an iterative loop.
- ~~`array.slice + spread` → in-place updates in
  `resolveAnchoredObjects`~~ — the "fixed-point loop" multiplier never
  materialised; current cost is bounded.
- ~~Early-termination guard on solver loop~~ — no solver loop.
- ~~Runtime deprecation warning for `floatOffset` reads~~ —
  `normalizeImageAttrs` folds legacy `floatOffset.y` into `yOffset` on
  read; no silent no-op to warn about.
- ~~Test backfill against `03-test-contract.md`~~ — the test contract was
  written for the solver-loop model. The current rect-driven model is
  covered by Test-11A and the targeted tests added in #58 / #59. Any
  new test work should be written against the current code, not the
  retired contract.
