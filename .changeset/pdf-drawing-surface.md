---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

**Core owns the PDF drawing contract**

Phase 1 of the format-lane migration. An extension that wants to draw itself
into a PDF has had one option: receive `@scrivr/export-pdf`'s context and work
in pdf-lib's vocabulary. Because core cannot import pdf-lib, the two extensions
that tried each hand-rolled a `PdfContextLike` — copying pdf-lib's colour shape
and coordinate system by hand, differently from one another, with nothing to
tell them when they drifted.

- **`@scrivr/core`** — `PdfDrawSurface` and `PdfHandlerContext` describe drawing
  in the vocabulary the rest of the editor already speaks: layout pixels
  top-down, `Rgb` colours from `model/cssColor`, and opaque handles for fonts
  and images. `@scrivr/export-pdf` implements it over pdf-lib and keeps the unit
  conversion, the axis flip and the backend objects on its side.
- **`@scrivr/core`** — the surface can draw a nested block through the export's
  own dispatch, so a handler that owns a container renders its children without
  deciding what they look like.
- **`@scrivr/export-pdf`** — `createPdfDrawSurface` implements the contract over
  pdf-lib, and the package re-exports core's types so a handler names them
  without importing two packages. `PdfSpanStyle` and `PdfMarkHandler` are
  deprecated: they were never connected, and `PdfMarkContribution` replaces
  them.

No handler has moved yet and no rendering changes.
