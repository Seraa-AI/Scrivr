# TODOs

Captured from `/plan-eng-review` of `docs/anchored-objects/` on the
`anchored-objects-refactor` branch (2026-05-01). Each entry is sized for
follow-up work, not this PR.

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
`(node, constraintProvider geometry)` so unchanged constraints don't
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

**What.** Verify `measureCache` is keyed on availableWidth/constraintX such
that a paragraph laid out unconstrained at width 600 doesn't return the
wrong cache hit when re-laid-out constrained at effective width 350.

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
