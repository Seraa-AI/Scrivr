# @scrivr/core

## 1.0.9

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

- 972dab2: Double-click the page margin to create a header/footer (Word/Docs UX). Previously, a fresh doc with `doc.attrs.headerFooter === null` had a dead margin area — clicks did nothing and the user had to call `setEnabled(true)` from custom UI or pre-seed a policy to even reach the bands.

  **@scrivr/core**

  - `TileManager`'s `onPageClick` hit test now falls back to `pageConfig.margins.top` / `pageConfig.margins.bottom` when band heights are zero, so the margin strip is always hit-testable. When a real policy is loaded and bands are rendered, the resolved band bounds still win (no regression on documents that already use the chrome bands).

  **@scrivr/plugins**

  - `tableIntegrityPlugin`'s sibling concern in the HeaderFooter extension: the `chromeClick` listener now bootstraps a policy on double-click instead of bailing when `policy` is null/disabled. Single clicks remain a no-op. Force-enables a lingering disabled policy and creates an empty default slot when `differentFirstPage` is set but the first-page slot wasn't seeded.
  - `ensurePolicy()` is now exported from `HeaderFooterController.ts` so the chrome-click handler can reuse the same bootstrap path that the controller's `setEnabled(true)` uses.
  - `addPageChrome.measure()` now reserves a default ghost band (empty paragraph slot) on every page when no policy exists, so the margin strip is visually present before the user clicks. The first margin double-click upgrades the ghost into a real on-doc policy.

  **@scrivr/react / @scrivr/export-pdf / @scrivr/export-markdown**

  - Lockstep version bump only — no API changes.

  **Out of scope (follow-ups):**

  - Hover-state placeholder ("Click to add header" hint text) — Word/Docs do this on hover only. Worth a separate PR once the activation flow is in.
  - Manual playground verification: temporarily comment out `DemoContent` in `apps/docs/src/playground/Playground.tsx` so the policy isn't pre-seeded, then double-click the top margin — header band should appear and gain focus. Body clicks deactivate. Restore `DemoContent` before merging.

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

- 0dec8aa: Tables Phase 2 — `TableMap` + document-validity normalization. Editing operations and the upcoming Phase 3 row/column commands have a stable grid view of any table, and structurally invalid tables produced by paste, collab merges, or buggy authoring are silently repaired before the next render. Tables remain opt-in via `StarterKit.configure({ table: true })`.

  **@scrivr/core**

  - New `TableMap` (`packages/core/src/table/TableMap.ts`):
    - `width` / `height` / `map: number[]` (row-major flat array of cell offsets, `-1` for empty slots).
    - `positionAt(row, col)`, `findCell(cellOffset): Rect`, `cellsInRect(rect)`, `rowSpanAt(cellOffset)`.
    - vMerge chains walked once at build time; `rowSpanAt` is O(1). Broken chains (continue with no preceding restart) are defensively treated as fresh placements so queries still resolve.
    - Identity-cached via `WeakMap<Node, TableMap>` (`getTableMap(node)`); structural changes produce a new ProseMirror Node, which invalidates the cache for free.
  - New `normalizeTables(state): Transaction | null` and `tableIntegrityPlugin()` (`packages/core/src/table/normalize.ts`):
    - Rule 1: clamp `cell.attrs.gridSpan < 1` to 1.
    - Rule 2: `vMerge: "continue"` with no preceding `restart` / `continue` at that column → reset to `"none"`.
    - Rule 3: `table.attrs.grid` shorter than the widest row → extend with default 100px columns.
    - Rule 4: rows narrower than `table.grid` → pad with empty `tableCell > paragraph` cells.
    - Fixed-point loop capped at `MAX_ITERATIONS = 8`; emits a console warning if the cap is hit. Selection-only transactions skip normalization (cheap path).
    - Plugin attaches via the Table extension's `addProseMirrorPlugins()`. Wired through `StarterKit` only when `table: true`.
  - `Table` extension now contributes `addProseMirrorPlugins()` returning `[tableIntegrityPlugin()]`.
  - 36 new tests: 19 covering `TableMap` (rectangular / horizontal merge / vertical merge / combined / cache identity / broken chain), 12 covering `normalizeTables` + `tableIntegrityPlugin` wiring, 5 covering `<table>` / `<tr>` / `<td>` / `<th>` / `<tbody>` parse via the schema's `parseDOM`.

  **Known follow-up:** `appendTransaction` only fires on transactions, so a malformed initial doc loaded via `EditorOptions.content` does not get normalized until the first edit. Phase 5 (`tableEditingGuards`) will likely co-locate an initial-doc normalization pass in `BaseEditor` to close that gap.

  **@scrivr/react / @scrivr/plugins / @scrivr/export-pdf / @scrivr/export-markdown**

  - Lockstep version bump only — no API changes.

## 1.0.8

### Patch Changes

- bc1652d: Two new ways to seed initial editor content: a `DefaultContent` extension that takes either markdown or JSON, and a widened `content` constructor option that accepts strings (markdown) alongside the existing JSON object. Both surfaces share a single parser implementation; the constructor option overrides any extension contribution. Server users typically reach for `new ServerEditor({ content: "# md" })`, kit-builders compose `DefaultContent.configure({ markdown })` into an extensions list — either path lands the same document.

  **@scrivr/core**

  - New `DefaultContent` extension at `extensions/built-in/DefaultContent.ts`. Takes `{ markdown?: string } | { json?: object }` (mutually exclusive — throws on both or neither). Use via `DefaultContent.configure({ markdown: "# Hello" })` or `DefaultContent.configure({ json: docJson })`.
  - `BaseEditorOptions.content`, `EditorOptions.content`, and `ServerEditorOptions.content` widened from `Record<string, unknown>` to `string | Record<string, unknown>`. Strings are parsed as markdown via the merged extension token map; objects keep the existing JSON path. Passing `content` on the constructor overrides any `DefaultContent` (or other `addInitialDoc`) contribution from the extensions list.
  - `addInitialDoc` lifecycle now runs _after_ every extension has fully resolved (previously it ran inside each extension's `resolve()`, before others were known). The hook's `this` context is the new `InitialDocContext` — `ExtensionContext` plus a `parseMarkdown(text)` helper that uses the merged token map. This is what lets the extension seed from markdown without an editor instance. Existing extensions that only used `this.schema` keep working unchanged.
  - New `parseMarkdownToDoc(schema, tokens, text)` helper in `model/parseMarkdown.ts` — the shared core used by `BaseEditor.parseMarkdown`, the constructor `content` option, and `InitialDocContext.parseMarkdown`. `BaseEditor.parseMarkdown` is now a one-line wrapper.
  - New `InitialDocContext` type exported from `extensions/index.ts` for consumers writing custom content-seeding extensions.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- 40be274: Tables ship behind an opt-in flag. Phase 1's placeholder render is intentionally not in default `StarterKit` while the layout/render/export pipeline is filled in (Phases 2–4 of `docs/tables.md`). Apps consuming the released packages get unchanged behavior; tables are silent until explicitly enabled.

  **Breaking-ish for early adopters:**

  ```ts
  // Before — default-on:
  new Editor({ extensions: [StarterKit] });

  // After — opt-in:
  new Editor({ extensions: [StarterKit.configure({ table: true })] });
  ```

  **@scrivr/core**

  - `StarterKitOptions.table` flips from `false?` (default-on, opt-out) to `true?` (default-off, opt-in). All five `if (opts.table !== false)` gates in `StarterKit` flip to `if (opts.table === true)` (nodes, commands, layout handlers, toolbar items, markdown serializer rules).
  - `Table` extension and its types (`CellSubBlock`, `LayoutBlockKind === "tableRow"`) remain exported. Power users can continue composing `Table` directly without StarterKit:

    ```ts
    new Editor({ extensions: [StarterKit, Table] });
    ```

  - 3 new regression tests in `Table.test.ts` lock in the contract:
    - default `StarterKit` does not include `table` / `tableRow` / `tableCell` / `tableHeader` in the schema,
    - default `StarterKit` does not expose `insertTable` / `deleteTable` commands,
    - `StarterKit.configure({ table: true })` registers the full schema.

  **@scrivr/react / @scrivr/plugins / @scrivr/export-pdf / @scrivr/export-markdown**

  - Lockstep version bump only — no API changes.

- dad19d0: Tables Phase 1 — schema + insert/delete + placeholder render. Tables can now be inserted, removed, serialised to JSON, and survive page boundaries with a one-bordered-box-per-row placeholder. Real cell layout, cell text rendering, and PDF parity land in Phase 4 (see `docs/tables.md`).

  **@scrivr/core**

  - New `Table` extension with four Word-shaped node specs: `table` (`grid: number[]`, `layout: "fixed"`, `isolating`), `tableRow` (`repeatHeader`, `allowBreakAcrossPages`), `tableCell` and `tableHeader` (`gridSpan`, `vMerge`, `hMerge`, `hAlign`, `vAlign`, `background`, `margins`, `borders`, all `isolating`).
  - New commands `insertTable({ rows, cols })` and `deleteTable()`. Insert places the table after the current top-level block with uniform 100px columns, an empty paragraph in each cell, and parks the cursor in the first cell. Delete walks up to the surrounding `table` ancestor.
  - New `LayoutBlock.cells?: CellSubBlock[]` field and `CellSubBlock` interface (Phase 1: always `[]`; Phase 4 fills it).
  - New `layoutTableRow()` in `BlockLayout.ts` — stub that returns a fixed-height (32px) `kind: "tableRow"` block per row.
  - New `TableLayoutEngine` re-export module (placeholder for Phase 4's full engine) and `TableRowStrategy` placeholder renderer that paints a single 1px gray bordered rectangle per row.
  - `PageLayout.collectLayoutItems()` now expands `table` nodes into one `LayoutItem` per row. Pagination treats `tableRow` as atomic alongside `leaf` blocks: whole rows move to the next page on overflow, and a row taller than the content area clips on the next page (Word's `cantSplit` policy).
  - `StarterKit` accepts `table?: false` and registers Table by default.
  - New `insertTable` toolbar item (▦ icon) inserts a 3×3 table.
  - New markdown serializer rules for `table` / `tableRow` / `tableCell` / `tableHeader`. Phase 1 emits GFM-style pipe tables: first row becomes the header, cells flatten to pipe-escaped single-line text. Block content, marks, and merged cells collapse to plain text (full markdown serializer with merged-cell skip lands in Phase 8). Without this, `getMarkdown()` would throw on any document containing an inserted table since StarterKit enables Table by default.
  - Regression test: `new Editor({ content: { ...table... } })` hydrates the table into the proper `tableHeader` / `tableCell` / `tableRow` / `table` structure. Locks in compatibility with `EditorOptions.content` (added by the DefaultContent extension PR) and confirms the schema round-trips through the constructor's content path.

  **@scrivr/react / @scrivr/plugins / @scrivr/export-pdf / @scrivr/export-markdown**

  - Lockstep version bump only — no API changes. PDF export ignores tables for now (canvas placeholder only); Phase 4 adds the PDF table handler in lockstep with real cell rendering, per the parity rule.

- bf33e14: Theming: 12 canvas tokens + per-extension theme + PDF override path. Tailwind dark mode (or any CSS-variable-driven theme system) can drive both DOM chrome and canvas paint from a single source of truth. PDF export defaults to a print-ready palette that ignores the canvas theme; callers opt into themed PDF via `exportPdf({ theme })`.

  **Note:** This bumps `MarkDecorator`, `InlineStrategy.render`, `OverlayRenderHandler`, `BlockRenderContext`, and `PageChromePaintContext` signatures with new theme/effective-color parameters. Third-party extensions that hook these will pick up TypeScript errors and need to update their signatures (most can ignore the new args; underline/strikethrough-style decorators read `effectiveTextColor`).

  **@scrivr/core**

  - New `EditorTheme` (input — accepts CSS color strings including `var(--token)` references) and `ResolvedTheme` (output — literal colors only, what render contexts consume). Both exported from `@scrivr/core`. 12 tokens cover cross-cutting paint surfaces: pageBg, pageShadow, defaultText, link, cursor, selectionFill, imagePlaceholderBg/Border/Text, listMarker, hrColor, resizeHandle.
  - New constants: `defaultEditorTheme` (matches every hardcoded color used today — zero visual regression for apps that don't pass `theme`) and `defaultPdfTheme` (print-ready palette: white bg, black text, blue link, light placeholders).
  - New `EditorOptions.theme` and `EditorOptions.themeRoot`. `themeRoot` defaults to the mounted container, falling back to `document.documentElement` for unmounted instances. `var(--token)` strings resolve against `themeRoot` via a hidden `<div>` probe + `getComputedStyle` (the browser handles every CSS color form for free — `var()`, `var()` with fallback, `color-mix()`, `oklch()`, `calc()`).
  - New `editor.setTheme(partial)` API. Partial merge with explicit semantics: `null` resets a token to its default, `undefined` leaves the token alone, any other value overrides. Calling with `{}` is a pure refresh (re-resolves and bumps `renderGeneration`).
  - New `editor.getTheme()` and `editor.getResolvedTheme()` accessors.
  - Auto-installed `MutationObserver` on `themeRoot` (watching `class`, `style`, `data-theme`) when any theme value contains `var(`. rAF-coalesced — burst mutations produce one re-resolve per frame. Toggling the Tailwind `dark` class triggers a single canvas repaint without explicit calls.
  - Theme threaded into every paint surface today: `canvas.ts` clearCanvas (pageBg), `TextBlockStrategy` default text fill (defaultText), `Underline`/`Strikethrough` decorations (theme.defaultText — color marks do NOT bleed into decoration color, matching Word/Docs convention), `Link` decorator (theme.link), `Image` placeholders (3 tokens), `HorizontalRule` (hrColor), `ListItemStrategy` markers (listMarker), `ResizeController` handles (resizeHandle), `OverlayRenderer` cursor + selection (cursor, selectionFill), `TileManager` page wrapper (pageBg + pageShadow).
  - `BlockRenderContext`, `PageChromePaintContext`, `MarkDecorator.decoratePre`/`decoratePost`/`decorateFill`, `InlineStrategy.render`, and `OverlayRenderHandler` now carry/receive a resolved theme (and `effectiveTextColor` for mark decorators) so third-party extensions get dark mode automatically without forking the paint contract.
  - `CodeBlock` extension now accepts a `theme: { bg, border }` option for per-extension palette overrides. Other built-ins read from the cross-cutting `ResolvedTheme` directly.
  - `ServerEditor` accepts `theme` and exposes `getTheme()` + `getResolvedTheme()`. Server-side any `var(...)` entries are dropped (warned at construct via `console.warn`) and the rest are merged over `defaultEditorTheme`. PDF callers can pass `editor.getResolvedTheme()` directly into `exportPdf({ theme })` without re-specifying colors.
  - Probe element lifecycle is leak-free across construct → mount → unmount → remount → destroy. The probe is disposed when `_themeRoot` switches (constructor's documentElement → mount's container) and again on destroy. The MutationObserver-driven rAF refresh is tracked + cancelled on unmount/destroy so stray callbacks can't recreate a probe on a torn-down editor.
  - Header/footer surfaces inherit the body's resolved theme via `PageChromePaintContext.theme` — they never store a copy, so `setTheme()` on the body propagates without surface-side refresh.
  - `TileManager` paged-mode page wrapper now reads `pageShadow` and `pageBg` from the active resolved theme on every paint. User-supplied `pageStyle.boxShadow` / `pageStyle.background` overrides still win.

  **@scrivr/export-pdf**

  - New `PdfExportOptions.theme` — `Partial<ResolvedTheme>` (literal CSS colors only). Shallow-merged over `defaultPdfTheme`. PDF default is independent of `editor.theme` so a dark canvas still produces a print-ready PDF unless the caller explicitly opts in.
  - The PDF per-page loop now paints `theme.pageBg` as the first draw call so themed exports actually have the requested background color (pdf-lib's default white was previously visible regardless of theme).
  - `editor.commands.exportPdf({ theme, filename })` accepts the same theme override at the command level. Type-safe via the augmented `Commands` interface.
  - New `parseCssColor` helper supports `#hex`, `#rgb`, `rgb(...)`, and `rgba(...)` formats — used internally to parse theme tokens into pdf-lib `rgb()` colors.
  - `PdfContext.theme` field carries the resolved theme to every PDF handler. Built-in handlers (paragraph/heading/image/hr/codeblock/listItem/underline/strikethrough/link) read from `ctx.theme`; extension-contributed PDF handlers via `addExports().pdf` get the same context shape.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning. Plugins' header-footer chrome paint reads `paintCtx.theme` to render header/footer body content with the same theme as the page body — surface theme parity with no surface-side state.

## 1.0.7

### Patch Changes

- b9d64c1: Anchored-object yOffset deferred fixes — closes the items left open by the prior yOffset PR. Core gets the architecture work; export-pdf gets paint-order parity; react/plugins/export-markdown bump in lockstep with no code changes.

  **@scrivr/core**

  - **Phase 5 V2 — FlowBlock rip-out for top-bottom.** The `partKind: "anchored-object"` synthetic FlowBlock split (with its `before / image / after` paragraph fragmentation in `buildBlockFlow`) is gone. Top-bottom now contributes a `side: "full"` rect via `addFullWidthRect` and reflows flows through the same `reflowFlowsAgainstExclusions` path as square. One path, one question. Removes `topBottomImageInfo`, the four `anchoredObject*` fields on `FlowBlock`, and the top-bottom `yOffset` suppression hack in `PointerController` that Phase 5 V1 needed.
  - **`zIndex` attribute on image nodes** (default `0`). Two new helpers — `compareAnchoredObjectPaintOrder` (asc by zIndex, then docPos) and `compareAnchoredObjectHitOrder` (paint order reversed) — drive painting in `PageRenderer`/`export-pdf` and hit-testing in `PointerController`. Schema attr round-trips through PM as a normal number.
  - **Cross-page exact-position drop.** `PointerController.commitAnchoredDrag` now resolves the destination `yOffset` against the new anchor's globalY instead of resetting to `0`. The image lands at the cursor position rather than snapping to the new anchor's natural row. Closes the deferred TODO from the prior PR.
  - **Same-page re-anchor with threshold.** `resolveSamePageReanchor` re-parents an image to the closest paragraph when the committed yOffset would shrink dramatically (past `RE_ANCHOR_THRESHOLD_PX = 24`). Without this the offset accumulates across many drags.
  - **Inline image drag overlay.** Inline images now show the same translucent ghost + caret marker as anchored drags, with `disabled = true` styling for in-gap drops. Mirrors the anchored-drag overlay state contract.
  - **`pageStartGlobal` / `pageLocalYToGlobal` lifted to `PageMetrics`** (`pageStartGlobalForMetrics`, `pageLocalYToGlobalForMetrics`, `PageFlowMetrics` type). One implementation, called from both `PageLayout` and `PointerController`.
  - **`pageRectsDigest` invalidates pagination cache** when anchored-object placements change between layout runs. The runFlowPipeline path now drops `previousLayout` for pagination if the digest mismatches.
  - **Magic-number constants extracted.** `DRAG_THRESHOLD_PX`, `AXIS_STILL_THRESHOLD_PX`, `RE_ANCHOR_THRESHOLD_PX` are file-level `const`s in PointerController.
  - **Tests.** New tests for: zIndex paint/hit order helpers (3), pageRectsDigest invalidation (2), same-page re-anchor (2), cross-page yOffset (1). Existing top-bottom tests updated to the unified-rect shape.

  **@scrivr/export-pdf**

  - Paints anchored objects in `compareAnchoredObjectPaintOrder` to match the canvas renderer. Without this, zIndex would silently differ between PDF and on-screen output.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- dc23d63: Default anchored-image margin (wrap-zone breathing room) bumped from `8px` to `12px` to match Word's `~0.13"` Square / Tight wrap default. The previous 8px default left text appearing flush against the image's visible pixels — 12px is closer to Word and visually clearly separates text from the image at typical reading sizes. Documents with an explicit `margin` attr are unaffected.

  **@scrivr/core**

  - `ANCHORED_OBJECT_MARGIN` constant: `8` → `12`.
  - Image schema default in `Image.ts` extension and `model/schema.ts`: `8` → `12`.
  - One affected test updated (`square-left: constrained lines …` — text now starts at `image.right + 12 = 212` instead of `208`).

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- a958911: New opt-in debug overlay that visualises anchored-object placement state on the canvas. Useful when "the image looks wrong" — paints the exclusion area, the page-edge clamp boundary, and the paint-order metadata that normally lives only in `LayoutPage.anchoredObjects[]`.

  **@scrivr/core**

  - New `AnchoredObjectDebugOverlay.ts` — `installAnchoredObjectDebugOverlay(editor)` registers an overlay render handler that, when `editor.debug.anchoredObjects` is true, paints on every visible page:
    - **Wrap-zone fill** (translucent blue) at the margin-inflated exclusion rect. Square wrap inflates on all four sides; top-bottom inflates top/bottom only and spans the full content width. Behind/front contribute no exclusion and so render no fill.
    - **Clamp outline** (red, 2px) around the painted rect when `placement.clamped` is true.
    - **wrapMode + zIndex label** pinned to the painted rect's bottom-right corner.
  - `DragDebugConfig.anchoredObjects?: boolean` — new config slot, gated by `editor.debug.anchoredObjects`.
  - The overlay is always installed (zero cost when the flag is off); flip the flag at runtime via `editor.debug.anchoredObjects = true; editor.redraw()`.
  - **Tests.** 7 new cases covering: handler registration, no-op when flag is off, paint invocation when flag is on (square + top-bottom + behind/front variants), clamp outline, and per-page filtering.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- 4d76706: Anchored-object drag UX hardening + critical drag fix. Core gets the behavior changes; export-pdf gets a type rename to match; react/plugins/export-markdown bump in lockstep with no code changes.

  **@scrivr/core**

  - **Square-right images now draggable.** Fixed `resolveXAlign` legacy shadow bug — `wrappingMode: "square-right"` was overriding explicit `xAlign: "custom"` set by drag commits, so right-flushed images stayed pinned regardless of drop target. Explicit non-default `xAlign` now always wins.
  - **Drag UX hardening.** Edge-band resize handles (12px) so inner image body is reachable for body drag instead of the 8-handle grid stealing every click. Clamp-no-move guard skips no-op PM transactions when drag clamps to source X. Inter-page gap drops are flagged invalid: ghost goes disabled, no transaction dispatched. Cross-page drag onto a virtualized destination falls back to layout-page block scan instead of silently collapsing to docPos 0.
  - **Single source of truth for image rects.** New `editor.getNodeRect(docPos)` reads `layout.anchoredObjects` first (Stage 3 authoritative), falls back to `charMap` for inline images. Resize handles + selection rendering now derive from the same coordinates as body drag.
  - **Drag debug overlay.** New `DragDebugOverlay` paints solver vs charMap rects (green vs yellow) and the page-gap zone (red strip) when `editor.debug = { drag: true }`. `dragDebugLog` emits structured `[drag]` events at down/move/commit/clampedNoMove/gapDrop.
  - **Phase 1b cache invalidation for square wrap zones.** New `flow.overlapsWrapZone` flag stamped during `reflowFlowsAgainstSquareObject`; `paginateFlow` now skips cached-tail reuse when an upstream wrap zone changed. Closes a silent layout-staleness gap when image attrs flip between runs.
  - **wrap-side spec hint.** `docs/anchored-objects/04-edit-ux.md` now documents the v1 wider-side wrap behavior with a tooltip spec for the future Square wrap-mode picker.

  **@scrivr/export-pdf**

  - Renamed `floats` → `anchoredObjects`, `FloatLayout` → `AnchoredObjectPlacement`, and collapsed `mode: "square-left" | "square-right"` to `wrapMode: "square"` to match the core API. Anchor field renamed `anchorBlockY` → `anchorGlobalY`. Internal helper `drawPdfFloat` → `drawPdfAnchoredObject`. No behavior change — pure rename to track the core type surface.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, to keep all `@scrivr/*` packages on the same version.

- 85a8aea: Float-image bug fixes, new `PageBreak` extension, and stricter `ToolbarItemSpec` typing.

  **@scrivr/core**

  - **Anchor-only paragraph is never a flow citizen.** Four layers were leaking the orphan empty paragraph that appeared after dragging a float out of its host paragraph; each is now closed:

    - `BlockLayout.ts` — anchor-only paragraphs now bypass `LineBreaker` entirely. `layoutBlock` synthesises a single hidden anchor line directly via `createHiddenAnchorLine`, so the zero-height invariant is preserved even when the paragraph overlaps its own exclusion zone (top-bottom wrap with `skipToY` was the failing case).
    - `PageLayout.ts` — square and top-bottom exclusion rects now clamp `[zoneTop, zoneBottom]` to the float's own page so a float anchored near the bottom of page N can't leak exclusion onto page N+1. Flows track `wrapZonePage`, and `rebreakWrappedLinesWithoutExclusions` re-breaks lines at full width when a wrapped flow's continuation lands on a page with no overlapping float.
    - `Editor.ts` — `moveAndUpdateNode` / `moveNode` now compute a `moveDeleteRange` that swallows the parent textblock when an inline image is the sole child. The drag transaction deletes the husk in the same tx and re-maps `targetPos` through the resulting mapping. Word-style: dragging a float out never leaves an orphan paragraph behind.
    - `SelectionController.ts` — `moveLeft` / `moveRight` consolidated into `_moveHorizontally`. If the next position would land on a non-inline image, a `NodeSelection` is made on the image; if `extend=true`, the navigation skips past the hidden anchor; positions with no `CharacterMap` entry are walked through. The cursor cannot park in a zero-height anchor line.

  - **New `PageBreak` extension.** Layout already supported `pageBreak` (`paginateFlow` branches on `flow.isPageBreak` at PageLayout.ts:1183, `collectLayoutItems` detects `node.type.name === "pageBreak"`), but the active StarterKit schema didn't register the node. The new extension closes that gap:

    - `addNodes` — `pageBreak` as a non-selectable atom block, with `<div class="scrivr-page-break">` round-trip.
    - `addCommands` — `insertPageBreak()` inserts after the current top-level block.
    - `addKeymap` — `Mod-Enter` (Word/Docs convention).
    - `addToolbarItems` — `↵` button in the `insert` group.
    - Wired into `StarterKit` (`addNodes`, `addCommands`, `addKeymap`, `addToolbarItems`) gated on a new `pageBreak?: false` option.

  - **Stricter `ToolbarItemSpec.command` typing.** `command` is now `keyof SafeFlatCommands` instead of `string`, so toolbar items are validated against contributed `Commands<ReturnType>` augmentations. Filled the pre-existing gaps the new type surfaced:

    - `FontFamily.ts` — added `setBlockFontFamily` and `unsetBlockFontFamily` to the Commands augmentation (toolbar was using these untyped).
    - `Heading.ts` — Commands augmentation switched to a mapped type `[K in 1|2|3|4|5|6 as setHeading${K}]: () => ReturnType` so the toolbar's template literal narrows; `HeadingLevel = 1|...|6` exported and `HeadingOptions.levels` narrowed to `HeadingLevel[]`. `StarterKitOptions.heading.levels` updated to match.
    - `Indent.ts` — added the missing Commands augmentation for `increaseIndent` / `decreaseIndent`.

  - **Public re-exports for `CodeBlock`, `HorizontalRule`, `PageBreak`.** These extensions had `declare module "@scrivr/core"` augmentations but weren't re-exported from `extensions/index.ts`, so the augmentations never reached consumers' type graph (consumer apps saw `setHeading1`/`setLink`/`toggleBold` but not `toggleCodeBlock`/`insertHorizontalRule`/`insertPageBreak`). Adding the exports propagates the augmentations and unblocks typed `editor.commands.*` calls in consumer apps.

  - **Tests.** 12 new cases:
    - `BlockLayout.test.ts` — anchor-only paragraph stays zero-height when overlapping its own exclusion zone.
    - `PageLayout.test.ts` — anchor-only paragraph contributes no vertical gap before following text; floats at page bottom don't leak exclusion onto the next page.
    - `Editor.test.ts` — drag deletes the orphan parent paragraph; `moveRight` selects a non-inline image instead of landing in its hidden anchor; `Shift+moveRight` skips a hidden anchor when extending selection.
    - `PageBreak.test.ts` — node registration, atom/selectable flags, command exposure, keymap binding, schema integration, JSON round-trip.

  **apps/docs**

  - Demo content polished: tightened the welcome and Layout Engine paragraphs (less marketing-y, no redundant phrasing).
  - New "Floating Images" section that exercises every wrap mode with text actually wrapping around it: square (left, with surrounding flow), top-and-bottom (full-width, text above and below, plus a contrast-with-square closing line), behind (right, `yOffset: 40`), in-front (left, `yOffset: 30`).
  - A page-break drops the behind/in-front demos onto their own page.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- 10ea56e: Anchored images can now extend horizontally into the left or right page margins (Word-aligned). Vertical clamp remains at content bounds — top/bottom margins are reserved for headers and footers, so images cannot extend into them. This narrows a divergence from Word's behaviour; Google Docs allows broader margin overflow including footer/off-page drops, which we explicitly do not adopt.

  **@scrivr/core**

  - **`resolveImageX` accepts `pageWidth` and applies a different clamp per `xAlign`.** Named alignments (`left` / `center` / `right`) still snap to content bounds — the typography convention and Word's default "Margin" horizontal anchor. `xAlign: "custom"` (the user-positioned result of a drag) clamps to page bounds: `[0, pageWidth - imageWidth]`. The image can therefore hang into the left or right margin but cannot escape the page.
  - **`PointerController.resolveDragTargetX` clamps the dragged image to page bounds** instead of content bounds, so live drag feedback matches the new commit behaviour.
  - **Vertical `yOffset` clamp is unchanged** — painted top stays in `[pageStart, pageStart + contentHeight - height]`. Top/bottom margins are reserved for headers/footers.
  - **Tests.** Two new `resolveImageX` cases cover left-margin and right-margin overflow; two existing custom-clamp cases updated to assert page-edge clamping. The "Step 3 — clamp-no-move" drag test is reframed around the page-left edge instead of the content-left edge.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- 12e8476: Add an explicit `kind: "text" | "leaf" | "tableRow"` discriminator to `LayoutBlock` and migrate every consumer that previously branched on `lines.length === 0`. Foundation-only change: the `tableRow` variant is reserved for the upcoming Table extension and is not produced by any code path yet — paragraph, heading, list, listItem, image, hr, and pageBreak rendering are unchanged.

  **@scrivr/core**

  - New `LayoutBlockKind` type exported from `BlockLayout.ts`. `LayoutBlock.kind` is now a required field with documented invariants:
    - `"text"` — block has rendered lines (paragraph, heading, list_item, codeBlock; anchor-only paragraphs still qualify because they hold a hidden anchor line).
    - `"leaf"` — block has no inline content (image, horizontalRule, pageBreak, and the inline-atom sub-blocks dispatched by the PDF exporter); `lines` is `[]`.
    - `"tableRow"` — reserved; not constructed yet.
  - `layoutBlock` returns `kind: "text"` for textblocks; `layoutLeafBlock` returns `kind: "leaf"`. The split-path partBlocks in `paginateFlow` are tagged `"text"`.
  - `MeasureCacheEntry` and `FlowBlock` mirror `kind` so the pagination loop and exclusion-reflow pass route on the discriminator without re-probing line counts. Page-break flow markers carry `kind: "leaf"`.
  - Migrated consumers: `paginateFlow`'s leaf-overflow branch and split-path guard, `reflowFlowsAgainstExclusions`, `isAnchorOnlyFlowEntry`, `LayoutCoordinator._indexLayout` and `ensurePagePopulated`, and `populateCharMap` in `BlockLayout.ts`. Each now switches on `block.kind === "leaf"` (or its inverse) rather than `block.lines.length === 0`.
  - All 829 core tests, 15 export-pdf tests, and 311 plugins tests stay green; full typecheck and build are clean across all 12 packages.

  **@scrivr/export-pdf**

  - The inline-atom dispatch in `context.ts` constructs its synthetic atom block with `kind: "leaf"` and drops the prior `as LayoutBlock` cast in favour of a typed annotation. PDF rendering output is unchanged.
  - Test fixtures in `buildPdf.test.ts` carry the new field (`kind: "text"` for `paragraphBlock`, `kind: "leaf"` for `hrBlock`).

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- 3e5ec8f: Closes the double-click rapid-drag race condition: while a drag is in flight, a second `mousedown` is now ignored. Without this guard, an accidental double-click during drag could fire two PM transactions from a single user gesture, or resolve text selection at a stale point.

  **@scrivr/core**

  - `PointerController.handleMouseDown` returns early when any drag is active (`isDragging`, `resizeDrag`, `anchoredDrag`, or `inlineImageDrag`). The guard releases on `mouseup` so a fresh gesture can start cleanly. Equivalent to `setPointerCapture` + `pointerdown` ignore — we use mouse events so the guard is explicit.
  - **Tests.** Three new cases in `PointerController.dragUX.test.ts § Step 9 — pointer capture during drag`: anchored-drag re-entry, resize-drag re-entry, and post-mouseup re-acquisition.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- 9be941a: Segment-based wrap exclusions. Square-wrap text now flows through every available segment around an anchored object instead of picking one side. Core gets the layout refactor and a latent-bug fix; react gets a UI consolidation; export-pdf gets the renderer-side equivalent. Plugins and export-markdown bump in lockstep with no code changes.

  **@scrivr/core**

  - **Multi-segment line layout.** `LineBreaker` swapped its single-rect `ConstraintProvider` for a true `LineSpaceProvider` returning `AvailableSegment[]`. A visual line can now span multiple segments — text on both sides of a square-wrap image is filled left-to-right within one line. Lines carry `{ positioned, segments? }` instead of the old `{ constraintX, effectiveWidth }`.
  - **`ExclusionManager` is the single source of rect math.** `PageLayout.reflowFlowsAgainstSquareObject` now populates an `ExclusionManager` and queries `getAvailableSegments`, replacing the inlined subtraction helper that had drifted from the manager implementation.
  - **Schema: `wrapText` attr removed.** The per-image `largest | left | right` wrap-side override is moot now that both sides are usable simultaneously. Existing documents with `wrapText: "left"` etc. parse fine and silently lose the override (no migration needed — visual outcome is just both-sides wrap from now on).
  - **Latent bug fix in `blockHasAnchoredObject`.** The cache-invalidation predicate was reading legacy `wrappingMode` only. Combined with the new ImageMenu writing `{ wrapMode, wrappingMode: "inline" }`, anchored images set via the new menu were misclassified as inline. Now reads through `normalizeImageAttrs` so canonical and legacy attrs both resolve.
  - **Tests:** `ExclusionManager.test.ts` covers `getAvailableSegments` and `getNextFreeY`. `PageLayout.test.ts` asserts that segmented lines preserve word order across the exclusion hole (no drops or duplicates).

  **@scrivr/export-pdf**

  - Renderer skips alignment / justify offsets when `line.positioned`, since segmented lines carry final absolute span x values. Removed an `as`-cast that had been working around a stale type import.

  **@scrivr/react**

  - `ImageMenu` collapses `square-left` + `square-right` buttons into a single `square` toggle — the wrap-side preference is no longer meaningful with segment-based exclusions. `resolveWrappingMode` shims legacy persisted values.

  **@scrivr/plugins**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, to keep all `@scrivr/*` packages on the same version.

- 331160e: Delete the legacy `table` / `tableRow` / `tableCell` node specs from `schema.ts`. They predated the Table extension plan, used an incompatible `columnWidths` attr, and lacked `isolating` / `parseDOM`. The forthcoming Table extension (Phase 1 step 4+ of `docs/tables.md`) will be the single source of truth for table schema.

  **@scrivr/core**

  - Removed the `table`, `tableRow`, `tableCell` node specs from `model/schema.ts`. No code path produces or consumes these nodes today — verified by grep across the monorepo.
  - Updated `model/schema.test.ts` to drop the table nodes from the required-types list and remove the `columnWidths` attr assertion.
  - Documentation (`CLAUDE.md`, `packages/core/README.md`) updated to reflect the trimmed node list.
  - Regression sweep per `docs/tables.md` Phase 1 step 3: paragraph/heading/list/listItem/image/hr/pageBreak rendering unchanged. All 842 core tests, 15 export-pdf tests, 311 plugins tests, 12 export-markdown tests green; full typecheck clean across all 12 packages.

  **@scrivr/export-pdf**, **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- 0d419b7: yOffset Phase 1: structural placement attribute for anchored images. Default `0` is a no-op — pre-Phase-1 documents render identically. Spec: `docs/anchored-objects/06-yoffset-redesign.md`.

  **@scrivr/core**

  - **New image attr `yOffset` (default `0`).** Vertical placement delta from the anchor flow's globalY. `imageRect.y = anchorFlow.globalY + yOffset` is now the single source of truth for paint, exclusion rects, hit-test, and PDF — every consumer reads from `placement.x/y/width/height/page`, no recomputation from anchor flow Y.
  - **`AnchoredObjectPlacement` gains `globalY` and optional `clamped`.** `globalY` is the painted top in continuous global-Y coordinates (= `anchorGlobalY + yOffset`, post-clamp). `clamped: true` is set when the user-set `yOffset` was clamped to keep the image on its anchor's page — Phase 2's drag overlay will read this for the boundary indicator. `anchorGlobalY` keeps its meaning (anchor flow's globalY); the Phase 2 drag snapshot reads it.
  - **Page-edge clamp (V1).** `image.page === anchor.page` is a hard invariant. A `yOffset` that would paint the image off the anchor's page is clamped silently in layout (Phase 2's drag overlay surfaces stickiness visually).
  - **Square-stacking math now uses painted bottoms.** `PageLayout` previously stacked the next square image against the prior placement's _anchor flow_ bottom; under non-zero `yOffset` that re-creates the "moves visually but wraps old location" bug class. Switched to `placed.globalY + height + margin`. Identical behavior when all `yOffset` values are 0.
  - **Square exclusion rect uses painted Y.** `reflowFlowsAgainstSquareObject` is fed the painted `globalY`/`localY`, so text wraps the image's actual position rather than its anchor flow row.
  - **Legacy `floatOffset.y` migrates to `yOffset` on read.** A non-zero `yOffset` is authoritative; the schema-default `0` falls back to `floatOffset.y` so legacy documents keep their vertical placement. New code should write `yOffset` directly.
  - **Tests.** `AnchoredObjects.test.ts` covers the `yOffset` migration table (default, explicit, legacy fallback, malformed `floatOffset` shapes). `PageLayout.test.ts` asserts `yOffset=0` is a no-op, `yOffset=40` shifts paint together with anchor preserved, legacy `floatOffset.y` produces the same painted position as new `yOffset`, page-edge clamp sets `clamped` and pulls overflow back onto the page (positive and negative), and square-stacking respects painted bottoms.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, to keep all `@scrivr/*` packages on the same version. PDF export already reads `placement.x/y/width/height/page`, so it picks up `yOffset` for free through the layout layer.

- 0d419b7: yOffset Phase 2: drag commits `yOffset`, anchor stays put. Anchored images can now be dragged anywhere on their page without parenting to a different paragraph. Spec: `docs/anchored-objects/06-yoffset-redesign.md` § Phase 2.

  **@scrivr/core**

  - **`PointerController` drag rewrite.** At pointerdown we snapshot the anchor flow's globalY, the image's painted globalY, and the current `yOffset` from `placement.anchorGlobalY` / `placement.globalY` (Phase 1 fields). The snapshot is frozen for the gesture's lifetime — drag math never reads live layout, so vertical drag no longer feeds back into the anchor position.
  - **Same-page drag → `setNodeAttrs({ xAlign, x, yOffset })`.** Pure attr update; the image's docPos doesn't change. The user-visible behavior is the one the redesign was about: "drag an image anywhere on its page and it stays put — the anchor doesn't drift to another paragraph because the cursor passed over one."
  - **Cross-page drag → `moveAndUpdateNode({ ..., yOffset: 0 })`.** Anchor relocates to a paragraph on the new page in one transaction; `yOffset` resets so the image lands at the new anchor's natural position. (Preserving exact visual position across the page break — adjusted yOffset against new anchor's globalY — needs a `pageStartGlobal` helper not yet exposed to PointerController; deferred to a follow-up.)
  - **Y_THRESHOLD = 3px on same-page commits.** Mirrors the existing horizontal threshold. A "pure horizontal" drag with natural mouse jitter (≤3px Y wobble) doesn't write a spurious `yOffset`.
  - **Tests updated.** `PointerController.test.ts` and `PointerController.dragUX.test.ts` switched from the old commit matrix (moveAndUpdateNode for diagonal, moveNode for vertical) to the new one (setNodeAttrs same-page, moveAndUpdateNode cross-page). Pure-horizontal tests now use `dy=0` to assert that `yOffset` is omitted when there's no vertical intent.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning. Drag UX is core-side; React just mounts the renderer.

- 349da18: yOffset Phase 3: anchored-image height stops contributing to paragraph height. An image-only paragraph now reserves one default-font line of vertical space instead of inflating to the image's full height. Spec: `docs/anchored-objects/06-yoffset-redesign.md` § Phase 3.

  **@scrivr/core**

  - **`BlockLayout`'s empty-node fallback widens from "renderable" to "non-zero".** Previously the ZWS injection only fired when no spans existed (or only `kind: "break"` spans). Now it also fires when every span is a zero-size object sentinel — i.e. a paragraph whose only content is one or more anchored images.
  - **Sentinel preserved alongside ZWS.** When zero-size object sentinels are present, the ZWS is **appended** rather than substituted, so `getAnchoredObjectAnchors` still finds the image's docPos via `flow.lines[].spans[]`. Empty / break-only paragraphs keep the old substitute-with-ZWS behavior — no behavior change for those.
  - **Result.** Image-only paragraph now has `block.height ≈ MOCK_LINE_HEIGHT` (default font line) rather than `block.height = imageHeight`. Inline images are untouched (their non-zero size keeps `hasNonZeroContent` true). Phase 1 invariant _"`paragraph.height === text.height` (no image contribution)"_ is now true for the empty-anchor case too.
  - **Tests.** `BlockLayout.test.ts` adds four Phase 3 tests: (1) image-only paragraph collapses to default font line, (2) sentinel is preserved on the line, (3) text + non-inline image keeps text line height, (4) inline image still inflates as before.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- aef1835: yOffset Phase 4: square reflow shares one `ExclusionManager` per page. Multi-image-on-same-flow now wraps against the union of all rects rather than the last one. Spec: `docs/anchored-objects/06-yoffset-redesign.md` § Phase 4.

  **@scrivr/core**

  - **`resolveAnchoredObjects` owns a `Map<pageNumber, ExclusionManager>`.** When a square anchor is processed, the rect is added to the page's shared manager _before_ the reflow call. Subsequent square anchors on the same page accumulate into the same manager, so flows that overlap multiple images see the union of all rects via `getAvailableSegments`.
  - **`reflowFlowsAgainstSquareObject` → `reflowFlowsAgainstSquareExclusions`.** The function no longer creates its own `ExclusionManager` or calls `addRect`. It receives the shared manager and a `{ pageNumber, zoneTop, zoneBottom, contentX, contentWidth }` zone for early-exit bounds. The `lineSpaceProvider` queries the manager directly so each line sees every rect added so far on the page.
  - **Latent bug fix.** Two square images in the same paragraph (or in adjacent paragraphs with overlapping wrap zones) used to corrupt subsequent text wrap: the second reflow's single-rect query returned segments around image B only, overwriting the first call's result and silently positioning text underneath image A. The shared manager fixes this by construction. Tracked as `todo_anchor_stacked_reflow.md`.
  - **Iteration semantics preserved for the common case.** Sequential anchors in document order — the realistic workload — re-iterate downstream flows against the current manager state, so adding a rect always reflows everything below it. Pathological out-of-document-order overlaps (anchor A late in the doc with a yOffset that places its rect above anchor B earlier in the doc) are not handled by this iteration; that's a Phase 4 follow-up if it appears in real documents.
  - **Cache invalidation deferred.** Spec calls for a `pageRectsDigest` to widen the per-flow `overlapsWrapZone` cache key; this PR keeps the existing flag (set when a flow's Y intersects the current zone) and accepts that flow caching can stale when an image rect moves under yOffset. Will land in a follow-up.
  - **Tests.** New `PageLayout.test.ts` test: two square images (`xAlign: "left"` and `xAlign: "right"`) on the same page with a long text paragraph below — text spans are asserted to fall entirely between the two rects' painted edges, not beneath either image.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- 2189983: yOffset Phase 5 (minimal): top-bottom anchored objects contribute a `side: "full"` rect to the page's shared `ExclusionManager`. Architectural unification — all wrap modes now feed one manager. Spec: `docs/anchored-objects/06-yoffset-redesign.md` § Phase 5.

  **@scrivr/core**

  - **`ExclusionManager.addFullWidthRect(...)` helper.** Closes the spec's correctness gap on `side: "full"` rects: a manually-set `addRect` with `side: "full"` but `x` / `right` narrower than the queried content area silently leaves side segments, which makes `getAvailableSegments` drop the `skipToY` (segments.length ≠ 0 → skipToY suppressed in the return). The helper takes `{ page, y, bottom, contentX, contentWidth, docPos }` and forces the rect to span the content bounds — the failure mode is unreachable.
  - **Top-bottom rects flow into the page-level manager.** In `resolveAnchoredObjects`, when `wrapMode === "top-bottom"`, the placement now also contributes a full-width rect via `addFullWidthRect`. Square reflows on the same page therefore see top-bottom bands as real exclusions through the same manager that drives square wrap — Phase 4's per-page `ExclusionManager` now holds rects for _every_ anchored wrap mode.
  - **Scope choice — minimal V1.** The spec also calls for ripping out the `partKind: "anchored-object"` `FlowBlock` splitting in `buildBlockFlow` so top-bottom and square share the layout-pipeline path entirely. That rewrite forces test rewrites (8+ existing tests assert the image lives as its own layout block separated from "before" / "after" text fragments). Deferred to Phase 5 V2; the current FlowBlock splitting still positions the image vertically for the no-overlap-with-square common case. The user-visible win — top-bottom and square interacting cleanly through one manager — lands now; the structural rip-out is a separate change.
  - **Tests.** New `ExclusionManager.test.ts` tests: (1) `addFullWidthRect` produces `skipToY` for overlapping queries, (2) demonstrates the failure mode the helper prevents (manual `addRect` with mismatched bounds suppresses `skipToY`).

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

## 1.0.6

### Patch Changes

- 39e008c: Add public `applyTransaction` to Editor, move command augmentations to per-extension files, remove phantom yjs/y-prosemirror deps from core
- 36a7776: **@scrivr/react** — Add `readOnly` option to `useScrivrEditor` hook. Reset `letterSpacing`, `wordSpacing`, `textTransform` on the `<Scrivr>` container to prevent host app CSS from causing cursor drift.

  **@scrivr/core** — New `Indent` extension with block indent (`Mod-]`/`Mod-[`, 0-8 levels at 24px each) and first-line indent (`textIndent` attr in px). Both inherited on Enter split, parsed from paste, serialized to DOM. Expose `getMarkdownParserTokens()` and `parseMarkdown(text)` on `BaseEditor` for server-side markdown parsing.

- 88016a6: Add LICENSE file and README to all packages. Add missing `license` field to export-pdf, export-markdown, and export-docx package.json files.
- ddd1448: Allow mouse selection (click, drag, double/triple-click) in readOnly mode so users can select and copy text. Block programmatic command dispatch (`editor.commands.*`) in readOnly to prevent extensions from bypassing InputBridge.

## 1.0.5

### Patch Changes

- bf50408: Add `addPageChrome()` extension lane and the iterative chrome aggregator loop. Extensions can now contribute a `PageChromeContribution` (headers, footers, footnote bands, margin notes) that reserves per-page vertical space and paints on top of the content canvas. Zero shipping contributors yet — this lays the groundwork for the HeaderFooter plugin.

  Internal refactor: `paginateFlow` now takes an options bag and returns per-page `metrics[]` directly; `runFlowPipeline` was extracted from `_runPipelineBody` so the aggregator can iterate measurement + pagination without re-running float/fragment passes. `DocumentLayout._chromePayloads` always populated (possibly empty) to seed the next run's contributor state.

  Also fixes `computePageMetrics` returning a bogus `footerTop` in pageless mode (subtracted `margins.bottom` even though pageless has no footer band).

- f6950b5: Add token authentication and connection lifecycle callbacks to the Collaboration plugin and collab server.

  **@scrivr/plugins** — `Collaboration.configure()` now accepts `token` (string or async function) forwarded to HocuspocusProvider for WebSocket auth, plus optional `onConnect`/`onDisconnect` callbacks for connection lifecycle visibility.

- 0f6d00a: Fix cross-page selection highlight and cursor fallback for float-only pages
- 81970d5: Refactor monolithic `buildPdf()` into a 7-phase handler dispatch pipeline. Extensions can now contribute PDF node/mark/chrome handlers via `addExports()`.

  - `@scrivr/core`: add `ExtensionManager.getExportContributions()` and `BaseEditor.getExportContributions()` on `IBaseEditor`; fix missing `text` + `hardBreak` markdown serializer rules in Document extension
  - `@scrivr/export-pdf`: extract `PdfContext`, `PdfDrawHelpers`, `PdfFontRegistry`, and default node/mark handlers into dedicated modules; fill `PdfHandlers` with real typed interfaces (`PdfNodeHandler`, `PdfMarkHandler`, `PdfChromeHandler`)
  - `@scrivr/export-markdown`: fill `MarkdownHandlers` with `MarkdownNodeHandler` and `MarkdownMarkHandler`; widen `exportToMarkdown()` to accept `BaseEditor`; add 12 tests

- ff7390f: Split `@scrivr/export` into `@scrivr/export-pdf` (pdf-lib) and `@scrivr/export-markdown` (prosemirror-markdown) so each format carries only its own deps. The original `@scrivr/export` becomes a compat shim that re-exports from both — existing consumers keep working.

  Add `addExports()` extension lane to `@scrivr/core` with the `FormatHandlers` augmentation pattern. Format packages declare their handler shape via module augmentation; extensions contribute format-tagged handlers via `addExports()`. Handler interfaces are placeholders until the M2 export dispatch refactor fills them.

  Dependent packages bumped to pick up the new export extensibility types.

- a198d0f: Add HeaderFooter extension with configurable headers and footers, live inline editing, token substitution, and PDF export parity.

  **@scrivr/plugins** — New `HeaderFooter` extension: doc-level `headerFooter` policy, per-page slot resolution (`differentFirstPage`, `differentOddEven` reserved), `pageNumber`/`totalPages`/`date` inline atom tokens with dynamic `measure()`, headless `HeaderFooterController` for building settings UI, surface-based live editing with undo/redo history, restricted schema (no tables/page breaks), and PDF chrome + token export handlers.

  **@scrivr/core** — Surface-aware command routing (`_getActiveState`/`_dispatchToActive`), `chromeClick` event, `PageChromePaintContext` gains `measurer`/`markDecorators`/`blockRegistry`/`inlineRegistry`, `ChromeContribution` gains `replacesTopMargin`/`replacesBottomMargin`/`topBandStart`/`bottomBandStart`, `EditorSurface` accepts plugins, `IEditor` exposes `surfaces`/`invalidateLayout`/`getPageScreenPosition`, `InlineStrategy` type exported from layout index, and `addCommands` signature widened to support typed command parameters.

  **@scrivr/export-pdf** — Chrome payload image scanning for `embedImages`, WinAnsi sanitizer expanded to cover smart quotes and em/en dashes.

  **@scrivr/react** — New `HeaderFooterRibbon` component (Google Docs-style ribbon bar with "Different first page" toggle, margin controls, token insert buttons, and remove header/footer actions).

- 8ccf3ea: Add `EditorSurface` + `SurfaceRegistry` + `addSurfaceOwner()` extension lane for multi-surface document editing. Plugins can now register plugin-owned edit regions (headers, footnote bodies, comment threads) that own their own `EditorState` and participate in a full activate/commit/deactivate lifecycle. Body (flow doc) remains the default active surface — `activeId === null` — and `editor.state` always returns flow state regardless of activation. Zero user-visible change. Enables the upcoming HeaderFooter plugin to ship fully editable in-place rather than paint-only.

  Dependent packages bumped to pick up the new `@scrivr/core` surface API exports.

## 1.0.4

### Patch Changes

- c963158: Add standalone `getSchema()` function for building a ProseMirror schema from extensions without instantiating an Editor. Standardize all node/mark type names to camelCase (`tableRow`, `hardBreak`, `fontSize`, `fontFamily`, `trackedInsert`, `trackedDelete`, etc.) for a consistent naming convention across the schema.
- 5752be2: Image interaction and popover UX fixes.

  **Images**

  - Click adjacent to an inline image now places the cursor instead of force-selecting the image. Selection only fires when the click is physically inside the image's visual rect (new `CharacterMap.objectRectAtPoint`).
  - Toggling an end-of-document image to wrap (`square-left` / `square-right`) or break (`top-bottom`) no longer makes it disappear. Pass 2 float placement now materialises any overflow page it assigns so the float has a tile to render on.
  - Break-mode images honour `attrs.width`. Resize handles and the `ImageMenu` W/H inputs actually change the rendered size — the exclusion zone still spans the full content width so text can't wrap beside the image.
  - Resize drag ghost now grows in the drag direction. New `computeGhostRect` pins the edge opposite the dragged handle so dragging a left/top handle visually expands leftward/upward instead of from the original top-left.
  - Resize drag ghost updates on every mousemove. Overlay paint used to short-circuit until the next cursor-blink tick, so break-mode handles never appeared to move at all until mouseup; the overlay now has a `pendingResizeDirty` check.

  **Popovers (ImageMenu, LinkPopover, BubbleMenu, FloatingMenu, SlashMenu, TrackChangesPopover, AiSuggestionPopover)**

  - Popovers follow their anchor on scroll and resize instead of freezing. New `viewport` editor event emitted by `TileManager` on scroll / resize; menu controllers listen via the shared `subscribeViewUpdates` helper.
  - Popovers hide when their anchor scrolls above or below the visible content area, so `position: fixed` popovers no longer render over app chrome (top toolbars, headers). New `editor.getScrollContainerRect()` + `setScrollContainerLookup()`; menus call the shared `isAnchorInsideContainer` helper.

## 1.0.3

### Patch Changes

- 914daad: ### Editing UX improvements

  - Double-click to select word, triple-click to select paragraph, with word-granularity drag extension
  - Platform-specific keyboard shortcuts: Option/Ctrl+Arrow word navigation, Cmd/Home/End line start/end, Cmd+Up/Down doc start/end, Option/Ctrl+Backspace/Delete word delete — all with Shift variants for extending selection

  ### Crisp rendering

  - Pixel-snap all overlay rectangles (selection, tracked changes) to the device pixel grid — eliminates antialiasing seams between adjacent rects
  - DPR change detection via matchMedia + Visual Viewport API — canvases repaint at correct resolution on browser zoom, display switch, and pinch-to-zoom

  ### Architecture

  - **New:** `SelectionController` — extracted from Editor, owns all cursor movement, word/line navigation, and selection logic. Accessed via `editor.selection`
  - **New:** `PointerController` — extracted from TileManager, owns all mouse interaction (hit testing, click counting, drag tracking)
  - **Breaking:** `editor.moveCursorTo()` and other navigation methods removed from Editor — use `editor.selection.moveCursorTo()` instead
  - **Breaking:** `ViewManager` deleted (was deprecated, replaced by TileManager). Remove any `ViewManager` imports

## 1.0.2

### Patch Changes

- 1d7dde7: Add CommonJS output to all packages so CJS consumers can `require()` the library

## 1.0.1

### Patch Changes

- 4b0e9c0: Add README.md to all packages with installation instructions, API overview, and usage examples. Fix root README to reference the correct hook name (`useScrivrEditor`) and renderer (`TileManager`).
- f4442e8: feat(core): addDocAttrs() extension lane for doc-level attributes

  Extensions can now contribute attributes to the `doc` node via a new `addDocAttrs()` Phase 1 hook:

  ```ts
  const HeaderFooter = Extension.create({
    name: "headerFooter",
    addDocAttrs() {
      return { headerFooter: { default: null } };
    },
  });
  ```

  `ExtensionManager.buildSchema` merges contributions from every extension into the doc node spec. Two extensions contributing the same attr name is a collision and throws at schema-build time with an error naming both owners — extensions are expected to namespace their attr names to avoid collisions in practice.

  Once declared, attrs are writable via ProseMirror's built-in `tr.setDocAttribute(name, value)`, which routes through `DocAttrStep` (jsonID `"docAttr"`, shipped in `prosemirror-transform` since 1.8.0). `@scrivr/core` now re-exports `DocAttrStep` as a convenience — extensions don't need to import from `prosemirror-transform` directly.

  This is the foundation for PR 4's HeaderFooter extension and future footnotes / comments / page-settings extensions that need document-level metadata participating in undo/redo, history snapshots, and collaboration round-trips.

- 3dcb134: refactor(layout): per-page PageMetrics, runMiniPipeline, recursion guard

  Internal refactor to `@scrivr/core`'s layout engine. Zero behavior change — all 566 tests pass unchanged.

  ### New primitives

  - `PageMetrics` — per-page geometry bundle (contentTop, contentBottom, contentHeight, contentWidth, header/footer heights). Replaces raw `margins.top` / `pageHeight - margins.bottom` arithmetic throughout the pipeline.
  - `computePageMetrics` — pure function deriving PageMetrics from PageConfig + chrome reservations.
  - `ChromeContribution` / `ResolvedChrome` — types for future chrome contributors (headers, footers, footnotes).
  - `fitLinesInCapacity` — shared line-fitting primitive extracted from paginateFlow's split loop.
  - `runMiniPipeline` — measurement-only pipeline for mini-documents (headers, footers, footnote bodies). Safe to call from chrome contributor hooks without triggering recursive pagination.
  - Recursion guard on `runPipeline` that throws with a readable error pointing at `runMiniPipeline`.

  ### Refactored hot paths

  - `paginateFlow` reads all vertical positions through `metricsFor(pageNumber)` instead of raw margin arithmetic (10 call sites).
  - `applyFloatLayout` uses `metricsForPage` helper across 9 call sites (float placement, exclusion re-layout, overflow cascade).
  - `DocumentLayout` gains optional `metrics[]`, `runId`, `convergence`, `iterationCount` fields.
  - `MeasureCacheEntry` gains `placedRunId` / `placedContentTop` for the early-termination guard to detect chrome configuration changes between runs.
  - `EMPTY_RESOLVED_CHROME` is `Object.freeze`d to prevent accidental mutation.

  ### Test coverage

  566 tests passing (555 pre-existing + 11 new covering PageMetrics, fitLinesInCapacity, runMiniPipeline, and the recursion guard).

## 1.0.0

### Minor Changes

- 7ba7cb5: Add ClearFormatting extension — `Mod-\` removes all inline marks, converts headings/code blocks to paragraphs, resets alignment and font family, and flattens lists back to plain paragraphs. Matches Google Docs behaviour. Exposed as `editor.commands.clearFormatting()` and registered in StarterKit.
