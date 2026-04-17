---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/export": patch
"@scrivr/plugins": patch
---

Add `EditorSurface` + `SurfaceRegistry` + `addSurfaceOwner()` extension lane for multi-surface document editing. Plugins can now register plugin-owned edit regions (headers, footnote bodies, comment threads) that own their own `EditorState` and participate in a full activate/commit/deactivate lifecycle. Body (flow doc) remains the default active surface — `activeId === null` — and `editor.state` always returns flow state regardless of activation. Zero user-visible change. Enables the upcoming HeaderFooter plugin to ship fully editable in-place rather than paint-only.

Dependent packages bumped to pick up the new `@scrivr/core` surface API exports.
