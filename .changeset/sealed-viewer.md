---
"@scrivr/core": patch
"@scrivr/plugins": patch
---

A sealed viewer for signing. `new Editor({ sealed: true })` (and `ServerEditor`) loads the content, then refuses every change. The editor emits `pagesInView` (the pages on screen, the page count, and whether layout is complete) and `press` (every primary press as a page point, read-only and sealed included). New `ReadingProgress` turns the pages on screen into reading evidence: pages entered and left, furthest page, and whether the reader reached the end. New `FieldCompletion` paints a sealed field manifest over the page. When the viewer presses a field they may complete, it asks the host for the value through `onFieldRequest`. Values never enter the document; `setFieldValue` shows one completed elsewhere.
