---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/export-semantic": patch
"@scrivr/docx": patch
---

`@scrivr/plugins`

- Track-changes engine: `mergeTrackedMarks` now fuses adjacent **formatting**
  marks (bold/highlight/color/…), not only tracked insert/delete text. A run of
  the same mark with the same author, operation and status collapses to one
  tracking id — the grouping typed text already got, now for formatting. Marks
  with different own attrs (e.g. two colors) never merge. `trackTransaction`
  invokes the merge after `AddMarkStep`/`RemoveMarkStep` at both boundaries.

  Fixes a live-editing bug: bolding two adjacent words (or applying a mark in
  several steps over a run) previously produced one tracked change per segment
  instead of a single reviewable change.
