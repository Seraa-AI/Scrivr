---
"@scrivr/core": patch
"@scrivr/ai": patch
"@scrivr/docx": patch
"@scrivr/export": patch
"@scrivr/export-markdown": patch
"@scrivr/export-pdf": patch
"@scrivr/export-semantic": patch
"@scrivr/plugins": patch
"@scrivr/react": patch
---

**`@scrivr/core/pm` — one ProseMirror instance for the whole stack**

`@scrivr/core` now publishes a `./pm` subpath that re-exports the ProseMirror surface Scrivr is
built on: `prosemirror-model`, `-state`, `-transform`, `-commands`, `-keymap`, `-history`,
`-inputrules`, `-schema-list`, `-markdown`.

Extensions and downstream packages import from `@scrivr/core/pm` instead of the `prosemirror-*`
packages directly, so they run against the same instance as the engine — the `instanceof` checks
on `Node`, `Slice`, `Selection` and `Plugin` that the engine relies on can no longer be broken by
a duplicate copy of `prosemirror-model` in the dependency tree. `prosemirror-view` is
deliberately absent: there is no `EditorView` in Scrivr, so view-only hooks never run.

- **`@scrivr/core`** — new `./pm` entry point (ESM + CJS + types). No change to the main barrel.
- **`@scrivr/ai`, `@scrivr/docx`, `@scrivr/export-pdf`, `@scrivr/export-semantic`,
  `@scrivr/plugins`** — source imports moved to `@scrivr/core/pm`; direct `prosemirror-*`
  dependencies and peer ranges dropped. `@scrivr/ai` no longer declares any peer dependencies;
  `@scrivr/plugins` keeps `prosemirror-model`/`-state` peers only because `y-prosemirror` requires
  them, not for its own code.
- **`@scrivr/export-markdown`** — dropped an unused `prosemirror-markdown` dependency.
- **`@scrivr/export`, `@scrivr/react`** — version alignment only.
