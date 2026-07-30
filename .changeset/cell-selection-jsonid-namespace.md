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

**`@scrivr/core`:** namespace the `CellSelection` JSON id to `"scrivr:cell"`.

prosemirror-state keeps one process-wide registry of selection JSON ids, and
`CellSelection` claimed the bare `"cell"` — the same id prosemirror-tables (which
Tiptap ships) uses. An app running Tiptap alongside Scrivr threw `Duplicate use
of selection JSON ID cell` at import time, whichever loaded second.

`CellSelection` now registers under `"scrivr:cell"`, which cannot collide with
theirs, and its `toJSON` emits the same namespaced id from a shared constant so
the two can't drift. The registration is also guarded so a duplicate
`@scrivr/core` copy in a consumer's bundle no longer crashes on import.

**Behavior change:** a persisted selection serialized before this release
carries `"type": "cell"`. On load it no longer resolves to a `CellSelection` —
`Selection.fromJSON` degrades it to a caret near the stored position (the doc
itself is unaffected). Selections are rarely persisted, so most apps see nothing;
apps that do store editor state and want the old selection back should rewrite
`"cell"` → `"scrivr:cell"` in the saved `selection.type` before loading.

The other packages carry a version-only bump (lockstep group).
