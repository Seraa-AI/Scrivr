---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/core`:
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
