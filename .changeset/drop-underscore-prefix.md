---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/core`: drop the `_`-prefix convention on internal class members and
rely on TypeScript visibility modifiers (`private` / `protected`) instead.
Touches `BaseEditor`, `Editor`, `ServerEditor`, `EditorSurface`,
`SurfaceRegistry`, `SelectionController`, `LayoutCoordinator`, `TileManager`,
`PointerController`, `InputBridge`, `CursorManager`.

Notable renames:

- `BaseEditor._state` → `BaseEditor.editorState` (root editor state, distinct
  from `EditorSurface`'s `editorState` and any layout `Flow*` concept).
- `BaseEditor._readOnly` → `readOnlyValue` (backing field for `get readOnly()`).
- `BaseEditor._applyState` / `_notifyListeners` / `_fireEditorReady` /
  `_dispatchToActive` / `_getActiveState` / `_buildCommands` → underscore
  dropped.
- `Editor._onChange` → `onChangeHandler`, `_onFocusChange` →
  `onFocusChangeHandler` (avoid shadowing the constructor option names).
- `Editor._viewDispatch` → `viewDispatch`, plus theme / debug / raf private
  fields stripped of their underscore.
- `LayoutCoordinator._cursorPage` → `cursorPageValue` (backing for the
  public `get cursorPage()`); everything else dropped the underscore.
- `EditorSurface._state` / `_isDirty` / `_listeners` → `editorState` / `dirty` /
  `listeners`.
- `SurfaceRegistry._activeId` / `_activeSurface` → `activeIdValue` /
  `activeSurfaceValue` (backing fields for the public getters); other
  private fields dropped the underscore.

Comment updates: "flow document" / "flow state" wording that was contrasting
the root editor against active surfaces is rewritten to "root editor
document" / "root editor state" so the same vocabulary doesn't blur with
layout's `Flow*` types (`FlowBlock`, `FlowConfig`).

**Public API is unchanged.** Interface members (`IBaseEditor._applyTransaction`,
`IBaseEditor._setOwnerMediator`-style cross-class API), layout shape fields
(`_chromePayloads`), and `EditorSurface._committing` remain `_`-prefixed —
those are intentional "internal-ish public" signals and migrate separately.

Other packages: no runtime / API change — bumps included for lockstep
versioning.
