---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/plugins`: drop the hand-rolled `TestAiEditor` `IEditor` stub. The
ai-suggestion test suites now drive a real headless `ServerEditor` (wrapped
in a thin `AiTestEditor` subclass that adds test sugar — `showSuggestion`,
`apply`, `reject`, `text`, `suggestionState`). The 110-LOC blob of
`as never` view stubs (canvas, layout, surfaces, full SelectionController)
is gone — the test driver is now a real editor with the actual minimal
schema + `aiSuggestionPlugin` + `trackChangesPlugin` + `history()` wired
through `ServerEditor`'s extension lifecycle.

To make this possible, three public function signatures widen from
`IEditor` to `IBaseEditor`:

- `showAiSuggestion(editor: IBaseEditor, …)`
- `applyAiSuggestion(editor: IBaseEditor, …)`
- `rejectAiSuggestion(editor: IBaseEditor, …)`

These functions only use `getState` + `applyTransaction` — both on
`IBaseEditor`. Backwards-compatible: any existing caller passing a
browser `Editor` still satisfies the broader requirement.

`subscribeToAiSuggestions` also widens to `IBaseEditor`. Its internal
`activate(blockId)` callback used to call `editor.selection.moveCursorTo`
unconditionally; it now uses a type-predicate guard (`hasSelectionApi`)
so view-bound editors keep moving the cursor while headless editors
skip the no-op-on-headless cursor move. No `as` cast — the guard returns
a TypeScript type predicate (`editor is IBaseEditor & Pick<IEditor,
"selection">`).

Other packages: no runtime / API change — bumps included for lockstep
versioning.
