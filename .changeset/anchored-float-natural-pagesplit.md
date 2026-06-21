---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` — an anchored object no longer paints over a preceding paragraph
that splits across a natural page boundary.

Root cause (the natural-split sibling of the explicit-page-break fix): Stage 4
paginates at the line level — a line that would cross a page bottom moves whole
to the next page, leaving an unused sub-line gap. Stage 2's continuous
`globalY` ignored those gaps, so an anchored object whose anchor sits after a
paragraph that splits was placed from a coordinate that ran ahead of where
Stage 4 actually puts the surrounding lines — the float landed a page early /
too high and overlapped the paragraph's tail.

Fix: `assignGlobalY` and `restampGlobalYFrom` now advance through each flow with
a shared `advanceFlowGlobalY` helper that models the page-bottom gaps, reusing
the same `fitLinesInCapacity` primitive `paginateFlow` uses so the line-fit
decision can't diverge. With `globalY` reflecting true paginated positions,
Stage 3's page derivation, anchor-push, and exclusion zones agree with Stage 4
for every wrap mode — the model invariant ("no content after an anchored object
renders on an earlier page than the object") now holds for natural splits too.

Regression test: a top-bottom float after a paragraph that splits 4 + 1 at a
non-line-aligned page boundary stays below the tail (fails before, passes now).
Full core suite green (1173 tests) — no pagination/streaming/cache regressions.
The demo's "Top and bottom" intro is restored to its full multi-line form,
which now paginates correctly.

Other packages: lockstep version bump, no behavior change.
