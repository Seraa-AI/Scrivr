---
"@scrivr/ai": patch
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/export-semantic": patch
"@scrivr/docx": patch
---

Leaf-based rich semantic editing — an AI agent can now read a document with its
formatting and write inline edits back that land as tracked-change suggestions,
without churning the parts it didn't touch. The editable surface is the **leaf
textblock addressed by its stable `nodeId`**; structure (lists, tables) stays
read-only context. Replaces the earlier flattened-string merge that turned a
verbatim echo of a list into hundreds of spurious changes.

`@scrivr/ai`

- `getRichBlocks(editor)` — the read half: semantic units where container units
  (lists, tables) expose their editable leaves as nested `parts`, each a
  paragraph/heading/codeBlock addressed by `nodeId`. The agent sees the grouping;
  every leaf is individually editable.
- `applyRichEdit(editor, edit, { asSuggestion })` — the write half: resolves the
  target leaf by `nodeId`, auto-diffs against a per-leaf rich hash as a stale
  guard, and applies via the track-changes engine. When a whole **container**
  unit (list/table) is passed, its editable `parts` are diffed leaf-by-leaf and
  only the changed leaves are applied — the container is never sent to the
  leaf-only merge. Targets that no longer exist are reported via `notFound`; a
  rich edit resolving to a non-textblock is rejected, never flat-edited.
- **zod schemas are first-class public API.** `RichSemanticEditSchema` plus the
  reused primitives (`InlineSpanSchema`, `InlineMarkSchema`) let any consumer
  `safeParse` untrusted agent output into validated, typed edits before it can
  touch the document. The structural-edit union is specced for later phases.

`@scrivr/export-semantic`

- Container units now carry `parts: SemanticPart[]` — the editable leaves inside
  a list or table, each with `nodeId` / `type` / `breadcrumb` / `text` / `spans`
  / `attrs`. A unit has EITHER `spans` (it is a leaf) OR `parts` (it is a
  container). The flat `text` projection for embedding is unchanged; `parts` is
  the universal edit surface. Table `cells` geometry stays read-only.
- New `semanticPartRichHash(part)` — the formatting-aware hash for a single
  editable leaf, the freshness base for per-leaf auto-diff. `unitRichHash` now
  folds in a container's `parts`, so a formatting-only edit to a nested leaf is
  observable at the container level (previously invisible).

`@scrivr/plugins`

- Track-changes: `applyRichDiffAsSuggestion` now operates on a **single leaf
  textblock** — one text derivation over the leaf's real doc positions (no
  recursion into containers, no synthetic newline separators, no cross-package
  lockstep). Guards against non-textblock targets. Exported from the package's
  public API for `@scrivr/ai` to build on. `applyDiffAsSuggestion` imports
  `findNodeById` from `@scrivr/core` (canonical home).
- An **attrs-only** rich edit no longer clears the author's pending inline text
  suggestion — only an edit carrying `spans` supersedes prior inline intent — so
  changing a block attr (e.g. alignment) preserves an in-flight text suggestion.

`@scrivr/core`

- `spansToFragment(spans, schema, opts)` reconstructs a ProseMirror inline
  fragment from agent-emitted `InlineSpan[]`, with `sameMark` / `resolveInlineMark`
  — the primitive that turns validated agent spans into real inline content.
- `exports/semantic` gains the `SemanticPart` type and the `parts?` field on
  `SemanticUnit`.

The other packages carry a version-only bump (lockstep group).
