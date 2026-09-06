---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

**An extension can style its own mark in a PDF**

`PdfExports.marks` was typed and documented as *"per-mark inline styling"* and
read by nobody: the collection loop never looked at it, and the painter was
handed an empty table it never consulted. An extension could ship a mark styler,
it compiled, and it drew nothing. Meanwhile the five built-in marks were
hard-coded inside the painter by name, so an extension's mark could never be
drawn at all.

- **`@scrivr/export-pdf`** — contributed mark stylers are collected and
  consulted. A mark an extension owns now paints.
- **`@scrivr/core`** — `underline`, `strikethrough`, `link`, `highlight` and
  `color` moved onto their own extensions as `addExports().pdf.marks`. The
  painter still owns every number: where an underline sits, how thick it is, how
  tall a highlight is. A styler says what it contributes, never where it lands.
- **`@scrivr/core`** — which mark wins a span's text fill is a named rule in the
  painter (`color` over `link`) rather than a priority a styler picks, so two
  extensions cannot escalate against each other. An unrecognised source can
  supply a fill but never take one.
- **`@scrivr/export-pdf`** — `PdfSpanStyle` and `PdfMarkHandler` are removed.
  They were never connected to anything, so nothing implemented them;
  `PdfMarkContribution` and `PdfMarkStyler` replace them.

No rendering changes: the operation-log baseline is unchanged.
