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

Consumers of the same prosemirror-state instance share its selection JSON id
registry, and `CellSelection` claimed the bare `"cell"` — the same id
prosemirror-tables (which Tiptap ships) uses. An app running Tiptap alongside
Scrivr threw `Duplicate use of selection JSON ID cell` at import time, whichever
loaded second.

`CellSelection` now registers under `"scrivr:cell"`, which cannot collide with
theirs, and its `toJSON` emits the same namespaced id from a shared constant so
the two can't drift. Duplicate Scrivr registrations still fail fast because two
different `CellSelection` classes sharing one JSON id are not runtime-compatible.

**Behavior change:** a persisted selection serialized before this release
carries `"type": "cell"` and is no longer supported. Passing it to
`Selection.fromJSON` throws because Scrivr no longer registers that id. The
document itself is unaffected, and applications normally persist document JSON
rather than transient editor selections.

The other packages carry a version-only bump (lockstep group).
