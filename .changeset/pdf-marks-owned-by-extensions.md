---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

Each mark declares how it looks in a PDF, on the extension that defines it.

Colour, link, underline, strikethrough and highlight were rendered by name in
the exporter. A kit that dropped one of those extensions still carried its
rendering; a kit that added a mark of its own got nothing. Each now has a `pdf`
lane beside its `docx` one.

The contract (`PdfSpanStyle`, `PdfMarkHandler`) moved to `@scrivr/core` so an
extension can describe its mark without depending on `@scrivr/export-pdf`, and
so a handler that names the type gets its shape checked. Nothing in the
contract names pdf-lib. Both types remain importable from either package, and
their shape differs from the one `@scrivr/export-pdf` published previously —
colours are CSS strings now.

**Highlights change colour.** `Highlight` configures `rgba(255, 220, 0, 0.4)`
and the canvas painted it, while the exporter hardcoded a different yellow. The
extension now supplies one colour to both, and an alpha in a highlight colour
becomes its opacity instead of being flattened and then dimmed again.
