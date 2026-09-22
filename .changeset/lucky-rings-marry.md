---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
"@scrivr/plugins": patch
---

The PDF exporter ships no node handlers of its own.

`paragraph`, `heading`, `bulletList`, `orderedList`, `listItem`, `codeBlock`,
`horizontalRule` and `image` were drawn by code inside `@scrivr/export-pdf`,
so the package that knows nothing about a node decided what it looks like.
Each now lives on the extension that defines it, and the exporter's defaults
are gone — it owns traversal, placement, page order and asset embedding, and
nothing else.

This is what makes a kit honest. An editor built without `Image` no longer
gets an image drawn by a default the exporter kept for itself; the node warns
by name and is skipped, the same answer every other lane gives.

`PdfNodeContext` and `PdfNodeHandler` now live in `@scrivr/core`, beside the
`PdfMarkHandler` that was already there. An extension can type everything it
contributes to a PDF without depending on the exporter, which is what the two
structural `PdfContextLike` copies in core and plugins existed to work around —
both are deleted, along with the runtime guards that re-checked by hand what
the compiler can now state. Each handler asks for exactly what it
dereferences: a table row takes `draw` and `blocks`, a header band takes
`layout` and `blocks`, a token takes `draw` and `font`.

No handler changed what it draws, so the op-log baselines are untouched.
