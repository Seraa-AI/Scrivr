---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` — `ensureFullLayout()` no longer inherits a truncated tail (fixes
PDF export still dropping the end of large documents, the residual from 1.0.12).

It seeded the re-layout with the partial layout, so pagination's
early-termination copied that partial's downstream pages — which end at the
streamed block cutoff (the tail was never laid out). A mid-document cache miss
(e.g. a `tableRow`, whose measurement bypasses the cache) followed by cached
paragraphs was enough to trigger the copy, producing a "complete" layout that
was actually cut off at the partial boundary. It also forced `layoutIsPartial =
false`, so `exportToPdf`'s partial-layout guard could never fire.

`ensureFullLayout` now lays out from scratch (no `previousLayout`), making the
early-termination guard unsatisfiable, and reads `isPartial` back instead of
forcing it false (restoring the export guard as a real backstop). The
`measureCache` still speeds per-block measurement.

Regression test: a 300-paragraph doc with a mid-document table lays out all
blocks after `ensureFullLayout` (truncated to the 100-block partial before).

Other packages: lockstep version bump, no behavior change.
