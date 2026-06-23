---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/plugins` — `getAiToolkit()` now works on a headless `ServerEditor`.

The toolkit was registered in the extension's `onViewReady` hook and the registry
plus `getAiToolkit()` were keyed on the browser-only `IEditor`, so `ServerEditor`
(an `IBaseEditor`) neither received a toolkit instance nor type-checked at the
call site — `getBlocks()` and the rest of the read/stream/suggestion API were
unreachable server-side. Every `AiToolkitAPI` method only touches `IBaseEditor`
surface (`getState` / `applyTransaction` / `getMarkdown` / `schema`), so the API
is now created in `onEditorReady` (fires in both `Editor` and `ServerEditor`) and
the registry + accessor are typed to `IBaseEditor`. Only the overlay-painting
sub-extensions (GhostText / AiCaret / AiSuggestion) remain wired in `onViewReady`.
