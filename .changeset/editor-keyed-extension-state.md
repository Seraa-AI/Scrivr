---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/docx": patch
"@scrivr/export-pdf": patch
"@scrivr/export-semantic": patch
---

Per-editor state belongs to the editor, not to a configured extension.

Six extensions kept per-editor state in a map keyed by their own options object.
Options identify a *configured extension*, and one of those can serve several
editors — configure once, mount twice is the ordinary split-view shape. So the
second editor overwrote the first's entry, a seeding hook reset it on every
construction, and teardown nulled it for everyone.

`Collaboration` stored its Y binding that way, read by undo, redo and three
keymap handlers: undo in one pane drove the other pane's history, building a
second pane left the first with no binding at all, and closing either pane
disarmed its sibling. The binding moves into `collaborationRegistry`, which was
already keyed by the editor and already documented as such.

`PdfExport`, `DocxExport`, `DocxImport` and `SemanticExport` each stored *the
editor itself* the same way — so `exportPdf` in one pane saved the other pane's
document, and `importDocxFromFile` **wrote** into it. All four now read
`this.editor()`, which resolves per editor, so the map, the `InstanceState`
type, the seeding plugin and the registration hook all delete. `PdfExport` needs an
editor with a layout pipeline, which is now a runtime check on what the export
actually calls — so any `IEditor` qualifies, not only the concrete browser
`Editor` the old view-only hook required.

`Image` held the same map with nothing reading it — its `onViewReady` already
returned the cleanup it needed. Removed.

`CollabState` gains a required `binding`, which a host names as
`CollabState["binding"]`. Teardown now deletes the editor's registry entry
instead of mutating a shared one.

Two behaviour changes worth knowing. These commands reach their editor through
`this.editor()`, which throws when an `ExtensionManager` was built without one,
where the old lookup returned `undefined` and the command returned `false` — no
production path builds an editorless manager, so this is latent rather than
something that happens today. And `exportPdf` now warns on the path it refuses,
the way `exportDocx` and `exportSemantic` already did, instead of returning
`false` silently.
