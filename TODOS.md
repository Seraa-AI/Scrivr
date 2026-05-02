# TODOs

Captured from `/plan-eng-review` of `docs/anchored-objects/` on the
`anchored-objects-refactor` branch (2026-05-01). Each entry is sized for
follow-up work, not this PR.

## Recently completed

- **#19 (Cache invalidation tests for D19)** — covered by the new
  `runPipeline — float image wrapping > Phase 1b does not copy a cached tail
  after a changed square zone overlaps it` test in `PageLayout.test.ts`,
  alongside the `flow.overlapsWrapZone` invalidation in `paginateFlow`.

## 1. Stale-mark legacy layout pipeline docs

**What.** Add a banner at the top of each of these docs noting they describe
the prior CSS-float pipeline and are superseded by `docs/anchored-objects/`:

- `docs/layout-pipeline-architecture.md`
- `docs/layout-engine-architecture.md`
- `docs/layout-fragment-architecture.md`
- `docs/multi-surface-architecture.md`
- `docs/pagelayout-decoupling-plan.md`

**Why.** Multiple docs claim authority over the layout pipeline. Readers will
trip on the older ones during onboarding. Stale-marking is cheaper than
deleting and preserves the historical context.

**Pros.** Low effort, removes a real source of confusion.
**Cons.** Six files touched in one PR. Some docs may have content worth
preserving in the new spec — would need a quick read-through before banner.

**Context.** The user explicitly confirmed during plan review that these
docs assume the CSS-float pipeline being abandoned and are out of scope for
the current PR.

**Depends on.** None. Can land any time.

## 2. Test backfill — baseline tests + invariants from `docs/anchored-objects/03-test-contract.md`

**What.** Add 14 of the 15 failing-baseline tests (test #11 universal
contract lands in the current PR) plus 14 invariant tests:

- 6 solver invariants (monotonicity, anchor monotonicity, wrap-zone locality,
  termination + status, anchor/object same page, idempotence)
- 3 pagination-contract invariants
- 5 geometry invariants
- 1 edit-stability invariant from `04 § 8`

**Why.** Coverage is currently ~14% against 03's test contract. The contract
explicitly says "write these tests first, expect them to fail" — current code
ships without them. The TDD memory feedback (`feedback_tdd_approach.md`) says
tests come first.

**Pros.** Hardens every invariant in the spec. Memory's 9 open float bugs are
made impossible by construction once green.
**Cons.** ~600-1000 LOC of test code. Test helpers (`renderToLayout`,
`findFirstAnchoredObject`, `walkAllBlocksByDocPos`) are the real cost.

**Context.** User wants to defer until "more has been settled" — once 4A's
solver loop refactor lands and the architecture stops moving, this is the
hardening pass.

**Depends on.** 4A solver loop refactor merged; spec docs settled per
sections 1A, 2A, 5A, 6A, CQ-2A, CQ-4A.

## 3. Vocabulary quick-reference card in `00-model.md`

**What.** Add a one-page reference card at the top of 00 listing all 13
vocabulary terms plus the additional types introduced in 02 and 03
(`AnchoredObjectInput`, `WrapZone`, `FlowClearance`, `solverPushed`,
`pageBoundaryDrift`).

**Why.** Reading 02 requires holding all of them in head simultaneously.

**Pros.** Cheap (one section). Improves doc readability.
**Cons.** Adds another section to keep in sync with the rest of 00.

**Depends on.** None.

## 4. Constraint metadata invariant rewrite — `03 § Geometry invariants § 4`

**What.** Rewrite invariant #4 ("Constraint metadata round-trip") to cover
all four `xAlign` values (left, right, center, custom) instead of only
square-left and square-right.

**Why.** Current phrasing implies left/right are the only cases. Reader
could think custom or center don't carry constraint metadata.

**Depends on.** None.

## 5. `resolveX` DRY — single definition in `01`, cross-ref from `02`

**What.** `01 § Resolved horizontal X` defines the function once. `02 § Wrap
zones` and `02 § Stage 3 inputs` link rather than re-state. Consolidate.

**Why.** Three near-identical definitions of the same expression. If 01
changes, 02 must track.

**Depends on.** None.

## 6. Reflow caching for constrained re-runs

**What.** `reflowFlowsAgainstSquareObject` calls `layoutBlock` per
overlapping flow, per iteration. Cache constrained line metrics keyed on
`(node, line-space segment geometry)` so unchanged exclusions don't
re-measure.

**Why.** Once 4A's loop lands, reflow runs N×iteration times. For
square-image-heavy pages this is the dominant cost.

**Pros.** Linear-to-constant on the steady state.
**Cons.** Cache invalidation is real work; key design needs care.

**Depends on.** 4A merged.

## 7. `array.slice + spread` → in-place updates in `resolveAnchoredObjects`

**What.** Replace `flows = [...flows.slice(0, i), { ...flows[i]!, globalY:
... }, ...flows.slice(i + 1)]` (PageLayout.ts:460-464, 491-495, 507-511)
with in-place mutation or a builder that batches updates.

**Why.** O(n) per push × N iterations × M anchors = O(n × N × M). With the
fixed-point loop landing, this multiplies.

**Pros.** Removes a real perf cliff for long docs with many anchors.
**Cons.** Mutation breaks the "pure transform per stage" mental model the
spec leans on. Either confine mutation inside the function (return a fresh
array at the end) or document the exception.

**Depends on.** 4A merged.

## 8. Measure cache invalidation for constrained reflow path

**What.** Verify `measureCache` is keyed on available segment geometry so
that a paragraph laid out unconstrained at width 600 doesn't return the
wrong cache hit when re-laid-out inside segmented line space.

**Why.** Bug class: text wraps wrong on second iteration because cached
measurements for unconstrained width are reused.

**Pros.** Quick verification (read cache key).
**Cons.** If the cache IS wrong, the fix is non-trivial.

**Depends on.** 4A merged.

## 9. Early-termination guard on solver loop

**What.** Beyond N=8 iterations, detect oscillation (same flow's globalY
toggling between two values across iterations) and bail with `status:
"exhausted"` early.

**Why.** Memory's `todo_float_hardening.md` flags this as a known hardening
gap. With monotonicity invariant from 03, oscillation should be impossible
— but real code may have bugs that break monotonicity, and an early-
termination guard surfaces them.

**Depends on.** 4A merged.

## 10. Migration tool — `scripts/migrate-anchored-attrs.ts`

**What.** Per CQ-4A's sunset rule: ship a one-shot migration command that
reads legacy `wrappingMode` / `square-left` / `square-right` /
`floatOffset` attrs and writes the new `wrapMode` / `xAlign` / `x` attrs,
clearing the legacy ones.

**Why.** Sunset rule (CQ-4A) commits to removing the read-time
normalization layer. Migration tool is the clean cut.

**Pros.** Lets the codebase stop carrying compat shims after sunset.
**Cons.** Anyone with documents persisted before this PR needs to run the
tool.

**Depends on.** None — can land any time before sunset.

## 11. Runtime deprecation warning for `floatOffset` reads

**What.** When `floatOffset` is read off an image node (in any code path),
emit a one-time `console.warn` per session: "floatOffset is retired — see
docs/anchored-objects/04-edit-ux.md."

**Why.** Per 1A, layout no longer reads `floatOffset`. External code that
still writes it sees silent no-ops. A deprecation warning surfaces the
issue.

**Pros.** Catches external callers; no behavior change.
**Cons.** Console noise if the warning fires often. Use a one-shot guard
keyed on a global flag.

**Depends on.** 1A applied to spec.

## 12. `solverPushed` flag unit tests pinning each push branch

**What.** Three unit tests, one per push branch in `resolveAnchoredObjects`
(barrier overflow, square stacking, post-stacking re-check). Each
constructs a minimal doc that triggers exactly that push branch and
asserts `flow.solverPushed === true`.

**Why.** Per 6A, pagination's first-on-page detection depends on the flag.
If a push branch forgets to set the flag, anchor lands on wrong page —
silent failure not caught by the universal contract test (which asserts
ordering, not flag state).

**Pros.** Catches a silent-failure mode at the unit level.
**Cons.** Three small tests; tightly coupled to internals.

**Depends on.** 4A merged with 6A applied.

---

# CEO Review additions (2026-05-01, HOLD SCOPE)

## 13. PointerController pointer capture during drag (D9)

**What.** PointerController calls `setPointerCapture(pointerId)` on dragstart
and ignores subsequent `pointerdown` until release. Closes the double-click
rapid-drag race condition.

**Why.** Spec's "one atomic transaction" rule for drag depends on no
mid-drag races. Without pointer capture, two transactions can fire.

**Effort.** Human ~1 hr / CC ~10 min. ~5 LOC + test.
**Priority.** P2.
**Depends on.** None — orthogonal to solver work.

## 14. Layout perf benchmark (D11)

**What.** New file `packages/core/src/layout/PageLayout.bench.ts` using
vitest's bench API. Cases: empty doc, 10-anchor doc, 100-anchor doc,
1000-paragraph pure-text doc. Asserts each case under target ms threshold.

**Why.** No layout perf regression detector exists. 4A's loop is the first
non-trivial iteration cost in the layout path; future regressions ship
silently without a bench.

**Effort.** Human ~3 hr / CC ~20 min. ~50 LOC.
**Priority.** P2.
**Depends on.** 4A merged so the bench has the loop to measure.

## 15. floatOffset deprecation strategy (D13 + codex 15)

**What.** Decide migration path for legacy `floatOffset.{x,y}` reads.
Current plan: runtime warning on every read. Codex 15 says this punishes
legacy docs that still render compatibly. Better: warn only on explicit
external/API access (e.g., a `migrateFloatOffsetWarning` opt-in), or
silent-deprecate and rely on CHANGELOG + migration tool.

**Why.** Layout no longer reads floatOffset. Legacy docs persist on disk.
Deprecation strategy needs a separate decision; not load-bearing for the
solver PR.

**Effort.** Human ~half day decision + ~1 hr code / CC ~30 min.
**Priority.** P3.
**Depends on.** TODO #10 (migration tool) for the per-doc migration path.

## 16. behind/front Word-aligned spec correction tests (D20)

**What.** Tests pinning Word-aligned behind/front semantics: no flow
contribution, no wrap zone, no Rule 2 split, painted at
`(anchor.flow_y, resolveX(...))`. Asserts text flows past the image as
if it weren't there.

**Why.** Spec corrected in this PR (D20) but the test contract for the
new behavior isn't part of Test-11A's scope. Without specific tests,
behind/front behavior could regress silently.

**Effort.** Human ~2 hr / CC ~15 min. ~40 LOC.
**Priority.** P1.
**Depends on.** D20 spec edits + behind/front code path simplified
(drop split logic).

## 17. Stage3Continuation for incremental streaming (D18 long-term)

**What.** Define `Stage3Continuation { placements, activeWrapZones,
flowGlobalYSeed, solverPushedBoundaryState, barrierProviderState }`.
Allows true incremental Stage 3 across `maxBlocks` chunks. Current PR
defers Stage 3 to a background pass after Stage 1/2 chunked completion.

**Why.** Long docs with anchored objects currently layout in full when
streaming would be desired. Incremental Stage 3 unlocks streaming-with-images.

**Effort.** Human ~1-2 days / CC ~3 hr. ~150 LOC.
**Priority.** P3 (defer until streaming-with-anchored-objects has a real user need).
**Depends on.** 4A merged.

## 18. Solver invariant tests (codex 9: monotonicity proof)

**What.** Add tests for solver invariants from
`docs/anchored-objects/03-test-contract.md` § Solver invariants:
monotonicity, anchor monotonicity, wrap-zone locality, idempotence.
Per-iteration assertion that anchor.globalY is non-decreasing across
iterations.

**Why.** Spec asserts monotonicity as a guarantee but no test proves it.
Without tests, future code changes can break the invariant silently.

**Effort.** Human ~half day / CC ~1 hr. ~120 LOC across 4 tests.
**Priority.** P2.
**Depends on.** 4A merged.

## 19. Cache invalidation tests for D19

**What.** Tests for the targeted cache invalidation: a cached layout where
a square image's `xAlign` changes must re-paginate downstream flows
overlapping the wrap zone. Pin the cache-invalidation rule.

**Why.** D19 fixes a silent correctness gap. Without tests, the
invalidation rule can degrade.

**Effort.** Human ~1 hr / CC ~15 min. ~30 LOC across 2 tests.
**Priority.** P1.
**Depends on.** D19 implemented in 4A.

## 20. Anchored-object debug overlay renderer

**What.** Opt-in overlay (e.g., `editor.config({ debug: { anchoredObjects:
true } })`) that paints wrap zones, anchor positions, and solver-pushed
markers on top of the canvas. Powerful for debugging wrap-zone issues.

**Why.** D12's debug API surfaces state via JS; the overlay surfaces it
visually. When debugging "why does this look weird," visual is faster
than JS introspection.

**Effort.** Human ~half day / CC ~1 hr. ~80 LOC overlay renderer.
**Priority.** P3.
**Depends on.** D12 landed.

## 21. Production layout time metric

**What.** Editor emits `layout:complete` event with `{ duration_ms,
anchoredObjectCount, iterationCount, reflowCount }` after every
`runPipeline`. Consumers wire to their observability stack.

**Why.** D11's bench catches regressions in CI; this catches regressions
in real user docs. Sole-maintainer + traction context: production data
is the only way to find perf cliffs in real-world docs.

**Effort.** Human ~1 hr / CC ~15 min. ~10 LOC.
**Priority.** P3.
**Depends on.** None.

## 22. Run /plan-design-review on anchored-object UX

**What.** Before implementation work on the mode-toggle / alignment
toolbar / drag preview UI lands, run `/plan-design-review` on
`docs/anchored-objects/04-edit-ux.md`. Catches AI slop / generic UI
patterns.

**Why.** v1 ships 5 wrap modes + 4 alignments + drag UX. Without a
design pass, the toolbar/menu UX risks feeling generic.

**Effort.** ~30 min review session.
**Priority.** P2 (before toolbar implementation).
**Depends on.** None.

## 23. DESIGN.md for Scrivr

**What.** Run `/design-consultation` to produce a `DESIGN.md` capturing
the editor's design system: typography, color, spacing, motion, brand
voice. Currently no DESIGN.md exists.

**Why.** v1 anchored-objects ships as part of a broader editor that
gains traction. Without a design source-of-truth, every new feature
risks reinventing visual language.

**Effort.** Human ~half day / CC ~30 min consultation + writeup.
**Priority.** P3 (not gating any current PR).
**Depends on.** None.

## 24. Strengthened Test-11A maintenance (D21)

**What.** Test-11A asserts 5 invariants in this PR (ordering, visited
count, uniqueness, exactly-one-placement-per-anchor, anchor-same-page).
Maintain as the layout's primary correctness gate. When new wrap modes
or split rules are added, extend Test-11A's setup but never weaken its
assertions.

**Why.** Test-11A is the bug-killer test. Weakening it = re-opening the
v2 bug class. This is documentation, not work, but worth tracking.

**Effort.** N/A — convention rule.
**Priority.** P1.
**Depends on.** Test-11A landed in this PR.

## 25. Stale-mark legacy CSS-float docs (was TODO #1)

(See TODO #1 above. Same item; promoted to actively-recommended in this
CEO review since older docs assume the CSS-float pipeline being abandoned.)
