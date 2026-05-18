# @scrivr/export-docx

## 0.0.5

### Patch Changes

- dd3f3d6: `@scrivr/plugins`: drop the hand-rolled `TestAiEditor` `IEditor` stub. The
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

- 0a17632: `@scrivr/core`: drop the static `model/schema.ts` `export const schema`
  and the `model/state.ts` (`createEditorState`, `createEditorStateFromJSON`)
  factories. Both were drifting out of sync with what the production editor
  actually builds — `Editor` and `ServerEditor` construct their schema
  dynamically from extensions (`StarterKit` adds `paragraph.dataTracked`,
  `paragraph.nodeId`, etc.; `TrackChanges` from `@scrivr/plugins` adds
  `trackedInsert` / `trackedDelete` marks) and the static schema couldn't
  keep up.

  **Stability note (beta `0.x`):** the removed surfaces below were technically
  reachable through `@scrivr/core` but were never part of the documented public
  API — `Editor` / `ServerEditor` / `StarterKit` (the documented entry points)
  do not consume them, and they had drifted out of sync with the runtime
  schema. They are removed as internal cleanup. Per the project's beta
  versioning rule (`feedback_changeset_patch_only`) the lockstep bump stays
  `patch`; any external consumer reaching past the documented surface should
  migrate as described below.

  Migration story:

  - The `schema` runtime value, `NodeTypeName` type, `MarkTypeName` type,
    `createEditorState`, `createEditorStateFromJSON`, and the
    `model/schema.ts` + `model/state.ts` modules themselves are removed from
    the package. The `EditorState` type re-export now comes from
    `prosemirror-state` directly. Build a live schema with
    `getSchema([StarterKit, …])` (or `buildStarterKitContext()` in tests) —
    that's what the production editor uses.
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

- ebd52d1: `@scrivr/core` + `@scrivr/plugins`: drop the `_`-prefix on the remaining
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

- d85d4af: `@scrivr/core`: drop the `_`-prefix convention on internal class members and
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

- d508775: **⚠️ Visual behaviour change for `@scrivr/react` menu components — see migration note below.**

  Make the React menu and popover components headless-friendly by removing baked-in visual inline styles, adding stable `data-*` state and part selectors, exposing per-part class name props for consumer styling, shipping an optional `@scrivr/react/styles.css` reference stylesheet that can be overridden by app CSS or Tailwind utilities, and exporting hooks for consumers who want to render fully custom UI.

  **Migration:** the previous inline styles are gone. Consumers who relied on the default look must either (a) import `@scrivr/react/styles.css`, or (b) provide their own styles via the new per-part class name props / `data-*` selectors. This bump is **patch** in keeping with Scrivr's beta-only patch policy (`feedback_changeset_patch_only`); semver discipline begins at the future deliberate 1.0 → 2.0 graduation, not here.

- 0a17632: `@scrivr/core`: split the extension lifecycle into engine + view phases.

  **Before:** every extension declared `onEditorReady(editor: IBaseEditor)`
  and either cast to `IEditor` (the documented workaround) or accepted
  `IEditor` directly (silently overriding the parameter type). The result
  was that view-only extensions (Image / TrackChanges / CollaborationCursor
  / AiCaret / GhostText / AiSuggestion / HeaderFooter / PdfExport / etc.)
  would crash at runtime when loaded into `ServerEditor` because the hook
  fired headlessly and reached for `addOverlayRenderHandler` / `redraw` /
  `selection` / `surfaces`.

  **Now:** two hooks, two phases:

  ```ts
  Extension.create({
    onEditorReady?(editor: IBaseEditor) {
      /* engine setup */
    },
    onViewReady?(editor: IEditor) {
      /* view setup  */
    },
  });
  ```

  - `onEditorReady` fires in **both** `Editor` and `ServerEditor` after the
    document engine is ready. Parameter is `IBaseEditor`; only engine APIs
    are reachable. Use for: collaboration document binding, plugin-state
    bootstrap, subscribers, export/markdown setup.
  - `onViewReady` fires **only in browser `Editor`**, after layout / input
    bridge / surfaces / overlay layer are initialised. Parameter is
    `IEditor`; full view surface is reachable. Use for: overlay handlers,
    redraw triggers, selection wiring, layout reads, `setReady`.

  Cleanup fns from both hooks collect in one `runtimeCleanup` array on
  `BaseEditor` and fire on `destroy()` in registration order.

  **Extensions migrated to `onViewReady`** (paint/view-only work that was
  crashing on `ServerEditor` and now simply doesn't run there):

  - `@scrivr/core`: `Image` (redraw on image load), `StarterKit`
    (aggregates Image's view-only setup).
  - `@scrivr/plugins`: `TrackChanges`, `CollaborationCursor`,
    `Collaboration`, `AiCaret`, `GhostText`, `AiSuggestion`, `AiToolkit`,
    `HeaderFooter`.
  - `@scrivr/export-pdf`: `PdfExport`.

  `HeaderFooter`'s and `TrackChanges`'s ad-hoc `isViewEditor` runtime
  guards are removed — the engine guarantees the hook only fires when the
  view is real.

  **Closes** `todo_extension_oneditorready_guard.md` (was tracking the 7
  extensions that crashed on `ServerEditor`; all migrated).

  **New tests:** `packages/core/src/extensions/lifecycle.test.ts` — 6 tests
  prove the contract:

  1. `ServerEditor` calls `onEditorReady` but not `onViewReady`.
  2. `Editor` calls both, in order (`editor` then `view`).
  3. Cleanup from both hooks runs on `destroy()`.
  4. `ServerEditor` only runs `onEditorReady` cleanup on `destroy()`.
  5. A view-only extension that uses `addOverlayRenderHandler` inside
     `onViewReady` loads in `ServerEditor` without crash (no guard, no
     cast — the hook never fires there).
  6. A mixed extension runs engine setup on server and view setup only in
     browser.

  **Plugin authors going forward:** if your extension touches `editor.layout`,
  `editor.addOverlayRenderHandler`, `editor.redraw`, `editor.selection`,
  `editor.surfaces`, or `editor.setReady`, put that work in `onViewReady`.
  If it only touches `editor.getState`, `editor.applyTransaction`,
  `editor.subscribe`, etc., keep it in `onEditorReady`.

  `onEditorReady` and `onViewReady` are both optional — declare neither,
  either, or both per your extension's needs.

  No runtime behaviour change in the browser path. Headless `ServerEditor`
  now loads every built-in / plugin extension without runtime errors;
  view-only setup is silently skipped.

  1,241 / 1,241 tests pass (1,235 baseline + 6 new lifecycle tests).

- 020e362: `@scrivr/core`:

  - New public type `TextMeasurerLike` — the four-method contract
    (`measureWidth`, `getFontMetrics`, `measureRun`, `invalidate`) that the
    layout pipeline consumes. Re-exported from the package entry. Layout +
    rendering signatures (`BlockLayoutOptions.measurer`,
    `BlockRenderContext.measurer`, `LayoutCoordinatorOptions.measurer`,
    `PageChromeMeasureInput.measurer`, `RenderPageOptions.measurer`,
    `MiniPipelineOptions.measurer`, `InlineStrategy.measure`, etc.) widen
    from concrete `TextMeasurer` to `TextMeasurerLike`. Backwards
    compatible — real `TextMeasurer` still satisfies the interface.
  - New `EditorOptions.textMeasurer?: TextMeasurerLike` injection point.
    Production code leaves it undefined and gets the existing DOM-canvas
    default; tests and custom runtimes pass a real `@napi-rs/canvas` or
    other backend.
  - New `TextMeasurerOptions.context?: TextMeasureContext` injection point
    on the `TextMeasurer` constructor. Same purpose: tests inject a real
    Skia ctx so widths and metrics come from a real backend.

  `@scrivr/plugins`:

  - `YBinding`'s constructor `editor` parameter widens from `IEditor` to
    `IBaseEditor`. The binding only uses base-editor APIs (`getState`,
    `subscribe`, `_applyTransaction`), so the narrower interface covers
    both browser `Editor` and headless `ServerEditor`. Backwards
    compatible — existing `IEditor` callers still satisfy `IBaseEditor`.
  - `tokenStrategies` (header-footer) re-types its measurer parameters as
    `TextMeasurerLike` instead of concrete `TextMeasurer`. No runtime
    change.

  Other packages: no runtime / API change — bumps included for lockstep
  versioning.

- Updated dependencies [dd3f3d6]
- Updated dependencies [0a17632]
- Updated dependencies [ebd52d1]
- Updated dependencies [d85d4af]
- Updated dependencies [d508775]
- Updated dependencies [972dab2]
- Updated dependencies [0a17632]
- Updated dependencies [020e362]
- Updated dependencies [0dec8aa]
  - @scrivr/core@1.0.9

## 0.0.4

### Patch Changes

- Updated dependencies [bc1652d]
- Updated dependencies [40be274]
- Updated dependencies [dad19d0]
- Updated dependencies [bf33e14]
  - @scrivr/core@1.0.8

## 0.0.3

### Patch Changes

- Updated dependencies [b9d64c1]
- Updated dependencies [dc23d63]
- Updated dependencies [a958911]
- Updated dependencies [4d76706]
- Updated dependencies [85a8aea]
- Updated dependencies [10ea56e]
- Updated dependencies [12e8476]
- Updated dependencies [3e5ec8f]
- Updated dependencies [9be941a]
- Updated dependencies [331160e]
- Updated dependencies [0d419b7]
- Updated dependencies [0d419b7]
- Updated dependencies [349da18]
- Updated dependencies [aef1835]
- Updated dependencies [2189983]
  - @scrivr/core@1.0.7

## 0.0.2

### Patch Changes

- Updated dependencies [39e008c]
- Updated dependencies [36a7776]
- Updated dependencies [88016a6]
- Updated dependencies [ddd1448]
  - @scrivr/core@1.0.6

## 0.0.1

### Patch Changes

- 0f6d00a: Fix cross-page selection highlight and cursor fallback for float-only pages
- Updated dependencies [bf50408]
- Updated dependencies [f6950b5]
- Updated dependencies [0f6d00a]
- Updated dependencies [81970d5]
- Updated dependencies [ff7390f]
- Updated dependencies [a198d0f]
- Updated dependencies [8ccf3ea]
  - @scrivr/core@1.0.5
