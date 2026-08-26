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
- **Node Actions (`@scrivr/core`)** — Includes built-in Node Actions for Sourced Blocks, providing "Update to Latest", "Discard Local Edits", "Detach from Library", and "Compare with Source" capabilities based on user permissions.
- **DOCX Interoperability (`@scrivr/docx`)** — Sourced Blocks seamlessly round-trip through MS Word using `<w:sdt>` (Structured Document Tag) content controls. Source metadata is safely encoded in the `w:tag` attribute, meaning blocks retain their provenance even after being edited in Word.
- **Semantic Mapping (`@scrivr/core`)** — Ensures Sourced Blocks preserve their boundaries and metadata when processed for semantic analysis.
