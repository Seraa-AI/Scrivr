---
"@scrivr/core": patch
---

Index page geometry instead of recomputing it per block. Page starts are now
held in a prefix sum (`createPageGeometry`), so locating the page for a flow
position is a binary search rather than a scan whose every step ran another
scan. Editing a large document no longer slows down as the page count grows:
on a 250-page document a caret move drops from ~1017ms to ~6ms and typing from
~1008ms to ~15ms, keeping interaction inside a single frame.

A finished layout now carries `pageStarts` alongside `metrics`, so hit-testing
and pointer geometry read a page's origin instead of summing the pages before
it on every event.

Breaking, though only for direct users of the layout internals:

- `paginateFlow` takes a `PageGeometry` in place of a bare `metricsFor` callback.
- `pageStartGlobalForMetrics` and `pageLocalYToGlobalForMetrics` are removed.
  Both walked the pages before the one asked about. Read `layout.pageStarts`
  for a finished layout, or use `PageGeometry` during a layout run.
