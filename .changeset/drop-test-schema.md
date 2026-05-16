---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/core`: drop the static `model/schema.ts` `export const schema`
and the `model/state.ts` (`createEditorState`, `createEditorStateFromJSON`)
factories. Both were drifting out of sync with what the production editor
actually builds — `Editor` and `ServerEditor` construct their schema
dynamically from extensions (`StarterKit` adds `paragraph.dataTracked`,
`paragraph.nodeId`, etc.; `TrackChanges` from `@scrivr/plugins` adds
`trackedInsert` / `trackedDelete` marks) and the static schema couldn't
keep up.

Migration story:

- The `schema` runtime value, `NodeTypeName` type, `MarkTypeName` type,
  `createEditorState`, `createEditorStateFromJSON`, and the
  `model/schema.ts` + `model/state.ts` modules themselves are removed from
  the package. The `EditorState` type re-export now comes from
  `prosemirror-state` directly.
- `model/commands.ts` had ~110 LOC of schema-using helpers (`toggleBold`,
  `toggleItalic`, `toggleUnderline`, `toggleStrikethrough`, `setFontSize`,
  `setFontFamily`, `setColor`, `applyUndo`, `applyRedo`, `splitBlock`,
  `applyToggleMark`) that were never imported in production — each
  extension already exposes its equivalent via `addCommands()` (Bold,
  Italic, FontSize, History, …). All removed. The surviving exports
  (`insertText`, `deleteSelection`, `deleteBackward`, `deleteForward`)
  power `InputBridge` / `PasteTransformer` / `BaseEditing` and don't
  reference any schema.
- Test consumers of the static schema now build it locally per file via
  `buildStarterKitContext()` (existing helper) or `getSchema([StarterKit])`
  — same StarterKit-built source the runtime editor uses. The describes
  that need `schema` directly (e.g. for `align`-specific attrs) declare
  their own `const { schema } = buildStarterKitContext()` at the describe
  top.

`@scrivr/plugins`:

- ai-suggestion test fixture: the `AiTestEditor` (introduced in PR #81)
  now extends `ServerEditor` and wires the production `StarterKit` +
  `TrackChanges` extensions through it. The custom `nodeSpecs` /
  `markSpecs` / `TestSchemaExtension` blob is gone — the test driver runs
  on the same schema and plugins that production runs on.
- `TrackChanges.onEditorReady` widens `editor: IEditor` to
  `editor: IBaseEditor` and uses a `hasOverlayApi(editor)` type-predicate
  guard to no-op overlay registration on headless editors. Browser-path
  behaviour is unchanged. Mirrors the existing guards in
  `HeaderFooterController` / `HeaderFooter` and the
  `subscribeToAiSuggestions` guard from PR #81. One of the seven
  extensions documented in `todo_extension_oneditorready_guard.md`.

No runtime behaviour change in the browser path. Test surfaces reduced
by 25 tests (8 from `state.test.ts`, 5 from dropped commands describes,
12 from `schema.test.ts`) — coverage of the removed code is replaced by
the production extensions' own tests.

Other packages: no runtime / API change — bumps included for lockstep
versioning.
