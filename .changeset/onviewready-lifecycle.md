---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/core`: split the extension lifecycle into engine + view phases.

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
  onEditorReady?(editor: IBaseEditor) { /* engine setup */ },
  onViewReady?(editor: IEditor)       { /* view setup  */ },
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
