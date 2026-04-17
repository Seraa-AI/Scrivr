---
"@scrivr/core": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
---

Split `@scrivr/export` into `@scrivr/export-pdf` (pdf-lib) and `@scrivr/export-markdown` (prosemirror-markdown) so each format carries only its own deps. The original `@scrivr/export` becomes a compat shim that re-exports from both — existing consumers keep working.

Add `addExports()` extension lane to `@scrivr/core` with the `FormatHandlers` augmentation pattern. Format packages declare their handler shape via module augmentation; extensions contribute format-tagged handlers via `addExports()`. Handler interfaces are placeholders until the M2 export dispatch refactor fills them.

Dependent packages bumped to pick up the new export extensibility types.
