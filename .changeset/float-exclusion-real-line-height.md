---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` — anchored floats no longer paint over text at their top edge.

The line-space exclusion probe in `LineBreaker` sampled each prospective line
with a 1px height (`lineY..lineY+1`). A line whose top sat just above a float's
exclusion zone but whose body extended into it was therefore read as
non-overlapping and laid out full-width, so text — or a heading directly above
the float — painted under the float's top edge.

The four probes now pass the line's real height (the starting word's font
metrics, or an inline object's height), and the `BlockLayout` first-line-indent
wrapper forwards that height instead of replacing it with 1. Every line that
actually overlaps a float now wraps out of its column.

Two regression tests cover it: a square float whose zone top falls mid-line,
and a top-bottom float reserving its full vertical band — both overlap at the
old 1px probe and are clean now.

Known limitation (unchanged): a float still desyncs from its anchor across an
explicit page break or a paragraph that splits across a page boundary; that's a
separate Stage 3/Stage 4 placement issue tracked for a later fix.

Other packages: lockstep version bump, no behavior change.
