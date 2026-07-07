---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/export-semantic": patch
"@scrivr/docx": patch
---

Substrate for node-level incremental re-embedding (freshness engine).

`@scrivr/export-semantic` — new change-detection helpers so a consumer can
re-embed only what changed between document versions instead of the whole doc:

- `unitEmbeddingInput(unit)` — the canonical string to embed (`breadcrumb + text`),
  one source of truth for both embedding and hashing.
- `unitContentHash(unit)` — deterministic hash of that input. Identical hash ⇒
  the vector is unchanged ⇒ skip re-embed. Formatting-only edits (bold, color,
  alignment) don't change it; a text or breadcrumb change does.
- `diffSemanticUnits(prev, next)` — matches units by stable anchor id and returns
  `{ added, removed, changed, unchanged }`. Editing one paragraph marks exactly
  one unit changed.

`@scrivr/core` — collab-safe stable ids. `UniqueId` now stamps a `nodeId` only on
LOCAL edits; a remote Yjs apply (tagged `COLLAB_SYNC_META` by the collaboration
binding) is skipped, so a block's id is assigned once by its author and synced
rather than re-stamped with a divergent uuid on every receiving client. Also
exports `fnv1aHex`, the shared hash used by the document fingerprint and the
per-unit content hash.

`@scrivr/plugins` — the Yjs binding marks remote applies with `COLLAB_SYNC_META`.
