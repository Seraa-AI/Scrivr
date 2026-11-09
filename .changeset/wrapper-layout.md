---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

A wrapper node shapes the blocks it wraps, and its extension paints the marker
it hangs. Lists now lay out and paint through this from `List`, so a task
list, legal numbering or a custom bullet is an extension, not an engine change.
Lists look and export exactly as before.

- **`NodeLayout`'s `transparent` kind takes `wrap: WrapperLayout`.** `enter`
  hands a scope down; `place` is called for each block laid out inside, at any
  depth, and returns its `indent`, an optional `marker` (`BlockMarker`) and an
  optional `styleKey`. Indents add up; the innermost marker and style win. A
  table row inside a wrapper takes its indent through `place`.
- **`addMarkerPainters()`** returns `{ [key]: { canvas, pdf } }`, side by side
  so a marker never ships on one surface only. Canvas and PDF draw from the
  same anchor, `markerAnchorOf(block)` (`PlacedMarker`).
- **`List`'s `markerColor` option** colours bullets and numbers on canvas and
  in PDF; null (the default) takes the theme's text colour, which is what
  `listMarker` defaulted to on both surfaces.
- **`PdfDrawSurface` gains `ellipse(op: PdfEllipseOp)`**, which a marker painter
  needs for a disc or ring.
- New: `WrapperLayout`, `WrapPlacement`, `WrapScope`, `BlockMarker`,
  `LaidMarker`, `MarkerFace`, `MarkerPainter`, `PlacedMarker`, `MarkerLine`,
  `markerAnchorOf`, `PdfEllipseOp`; `LayoutBlock.marker`;
  `BlockLayoutOptions.marker`; `BlockRegistry.registerMarkerPainter` and
  `markerPainter`; `IBaseEditor.getMarkerPainters()`.

**Breaking:**

- Removed `LayoutBlock.listMarker`, `listMarkerX` and `listMarkerFace`; read
  `LayoutBlock.marker` (`data` holds a list's bullet or number).
- Removed `listMarkerOf`, `ListMarker`, `ListMarkerFont`, `bulletShape`,
  `bulletBox`, `BulletShape` and `BulletBox` from `@scrivr/core`; use
  `markerAnchorOf`, `PlacedMarker` and `MarkerFace`.
- Removed `BlockLayoutOptions.firstLineOffset`, `firstLineOffsetAt` and
  `keepAnchorLine`; pass `marker: { offset, offsetAt }`, whose presence keeps
  an anchor-only block's line.
- Removed the `listMarker` theme token from `EditorTheme` and `ResolvedTheme`;
  configure `List`'s `markerColor` instead.
- A custom `PdfDrawSurface` must implement `ellipse`.
