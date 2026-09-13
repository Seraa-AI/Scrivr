---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

Each mark now declares how it looks in a PDF, on the extension that defines it.

Colour, link, underline, strikethrough and highlight were rendered by name in
the exporter's shared context. A kit that dropped one of those extensions still
carried its rendering; a kit that added a mark of its own got nothing. Each is
now a `pdf` lane on its own extension, next to the `docx` lane already there.

The contract moved to `@scrivr/core` (`PdfSpanStyle`, `PdfMarkHandler`) so an
extension can describe its mark without depending on `@scrivr/export-pdf` — a
cycle — and so the shape is type-checked rather than accepted blindly. Nothing
in it names pdf-lib: a handler says what a mark means, and the renderer keeps
deciding where the ink goes. Both types are still importable from
`@scrivr/export-pdf`.

Fixes a highlight that differed between lanes. `Highlight` configures
`rgba(255, 220, 0, 0.4)` and the canvas paints it; the exporter hardcoded a
different yellow, so the same document highlighted differently depending on
where you looked. The extension now supplies its own colour to both, and an
alpha in the colour becomes the opacity instead of being flattened against
white and then dimmed a second time.
