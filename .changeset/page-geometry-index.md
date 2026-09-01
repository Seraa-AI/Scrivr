---
"@scrivr/core": patch
---

Index page geometry instead of recomputing it per block. Page starts are now
held in a prefix sum (`createPageGeometry`), so locating the page for a flow
position is a binary search rather than a scan whose every step ran another
scan. Editing a large document no longer slows down as the page count grows:
on a 250-page document a caret move drops from ~1017ms to ~6ms and typing from
~1008ms to ~15ms, keeping interaction inside a single frame.

`paginateFlow` now takes a `PageGeometry` in place of a bare `metricsFor`
callback. `pageStartGlobalForMetrics` still works and is unchanged, but is
documented as cold-path only.
