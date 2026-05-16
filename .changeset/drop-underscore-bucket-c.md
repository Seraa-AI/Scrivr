---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/core` + `@scrivr/plugins`: drop the `_`-prefix on the remaining
underscore-tagged members — interface methods, cross-class internal API,
and layout shape fields. Completes the underscore sweep started in the
previous release.

**Breaking** (BUT pre-1.0 / beta, no external consumers known beyond the
in-repo plugins which migrate in this same PR):

- `IBaseEditor._applyTransaction(tr)` → `IBaseEditor.applyTransaction(tr)`.
  The previous public `applyTransaction(tr)` wrapper that just delegated to
  `_applyTransaction` is removed — there's now a single canonical method.
  Plugins (`YBinding`, `AiToolkit`, `ai-suggestion`, `header-footer`) and
  app code that called `editor._applyTransaction(tr)` should call
  `editor.applyTransaction(tr)` — same behaviour, no underscore.
- `SurfaceRegistry._setOwnerMediator()` → `setOwnerMediator()`. Still
  `@internal` — only called by `Editor` during construction.
- `EditorSurface._committing` → `committing`. Still `@internal` — set by
  `SurfaceRegistry` during commit lifecycle, checked by
  `EditorSurface.dispatch()` to refuse re-entrant dispatch.
- `DocumentLayout._chromePayloads` → `chromePayloads`. Layout shape field
  read by `TileManager` + written by `PageLayout` + `runMiniPipeline`.
- Module-scope helpers in `PageLayout` (`_runPipelineDepth`,
  `_runPipelineBody`) and `OverlayRenderer` (`_activeDpr`,
  `_setActiveDpr`) lose their underscores.
- `Paragraph` extension's module-local `_split` const renamed to
  `splitParagraph`.

Unused-parameter underscores (`_pageNumber`, `_charMap`, `_event`, …) stay
— that's TS/ESLint convention, not the same pattern.

No runtime behaviour change. 1,260 / 1,260 tests pass.
