---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` + `@scrivr/export-pdf` — PDF export of large documents no longer
truncates.

Large documents stream their layout: first paint lays out an initial chunk and
idle callbacks complete the rest. `exportToPdf` read `editor.layout.pages`
before the stream finished (and in a server/node context the idle callbacks may
never fire), so the exported PDF contained only the first chunk's pages.

`@scrivr/core` adds `IEditor.ensureFullLayout()`, which cancels pending idle
layout work and runs the full pipeline synchronously with no block cutoff.
`exportToPdf` now calls it before reading the layout and throws a clear error if
the layout is still partial (e.g. an older core without the method).

Tests: `Editor.ensureFullLayout` synchronously completes a streamed 160-block
layout; `buildPdf`/`exportToPdf` cover the paged-layout path.

Other packages: lockstep version bump, no behavior change.
