---
"@scrivr/core": patch
"@scrivr/docx": patch
"@scrivr/ai": patch
"@scrivr/export": patch
"@scrivr/export-markdown": patch
"@scrivr/export-pdf": patch
"@scrivr/export-semantic": patch
"@scrivr/plugins": patch
"@scrivr/react": patch
---

**Sourced Blocks**

A new end-to-end system for embedding, tracking, and updating content blocks (such as clauses or definitions) that originate from an external library or provider.

- **`SourcedBlock` Extension (`@scrivr/core`)** — A generic node wrapper that retains source metadata (`instanceId`, `kind`, `resourceId`, `versionId`, and `baseHash`). It leverages a new `insertSourcedBlock` command to seamlessly request and insert content from registered `SourceProvider` implementations.
- **Divergence Detection (`@scrivr/core`)** — A built-in plugin hashes block content and compares it against the `baseHash` to detect if the local content has drifted from the source. Diverged blocks are visually indicated using a new `divergedGutter` theme property.
- **Node Actions (`@scrivr/core`)** — Includes built-in Node Actions for Sourced Blocks, providing "Update to Latest", "Discard Local Edits" and "Detach from Library" capabilities based on user permissions.
- **`layout` node spec declaration (`@scrivr/core`)** — Nodes now declare how they participate in layout, independent of what they mean in the document tree: `{ kind: "block" }` (the default — the node occupies its own box) or `{ kind: "transparent" }` (the node stays in the tree but contributes no box; its children lay out into the enclosing flow). Previously layout participation was inferred from the node's name — lists and tables expanded, everything else was assumed to be a text block — so a structural node like `sourcedBlock` laid out as a single empty line and never painted its content. The painter for a `block` node still comes from `addLayoutHandlers()`; folding the strategy into this declaration, and turning the text-block fallback into an error for undeclared nodes, is the next step.
- **`addPasteTransforms()` (`@scrivr/core`)** — New extension seam for rewriting pasted content before it enters the document, applied by `PasteTransformer` to every clipboard flavour. This is the engine's equivalent of ProseMirror's `transformPasted` view prop, which never fires because Scrivr has no `EditorView`. Sourced blocks use it to re-mint `instanceId` so a pasted block is a second instance rather than a duplicate identity.
- **DOCX Interoperability (`@scrivr/docx`)** — Sourced Blocks seamlessly round-trip through MS Word using `<w:sdt>` (Structured Document Tag) content controls. Source metadata is encoded in the `w:tag` attribute, meaning blocks retain their provenance even after being edited in Word. Provenance that would exceed the 255-character OOXML limit for `w:tag` is dropped with an export diagnostic rather than producing a file Word rejects.
- **Semantic Mapping (`@scrivr/core`)** — Ensures Sourced Blocks preserve their boundaries and metadata when processed for semantic analysis.
