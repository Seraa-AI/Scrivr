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
both are deleted, along with the runtime guards that re-checked their shape by
hand. Each handler now asks for exactly what it dereferences: a table row takes
`draw` and `blocks`, a header band takes `layout` and `blocks`, a token takes
`draw` and `font`.

**If you wrote your own PDF node handler**, note that it is now handed
`PdfNodeContext` rather than `PdfContext`: `doc`, `page`, `fonts` and `images`
are no longer on the type. Paint through `ctx.draw.*` and render children
through `ctx.blocks()`. Raw pdf-lib access remains available to lifecycle hooks
(`onBeforeExport` / `onAfterExport`), which still receive the full
`PdfContext`, as do chrome handlers — the chrome lane has not moved yet.

One caveat on that guarantee: the contribution registry itself is still
untyped inside core and plugins, because `FormatHandlers` is empty there. The
handler *bodies* are checked where they are written; wiring one into the wrong
lane is not caught until the conformance fixture in Phase 5.

No handler changed what it draws, so the op-log baselines are untouched.
